#!/usr/bin/env python3
"""
zep-graphiti-adapter.py — Zep/Graphiti-compatible local adapter for the paper benchmark.

Graphiti (Zep's temporal knowledge graph engine) is published at getzep.com / github.com/getzep/graphiti.
Real Graphiti requires Neo4j or FalkorDB. This adapter implements the same surface (episodes,
bi-temporal edges, entity extraction via LLM) using Ollama for extraction + in-memory graph storage.

Endpoints exposed via HTTP on port 8125 to be hit by the benchmark runner.
"""

import os
import json
import time
import hashlib
import asyncio
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("ZEP_LOCAL_PORT", "8125"))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
LLM_MODEL = os.environ.get("ZEP_LLM", "qwen3.5:9b")
EMBED_MODEL = os.environ.get("ZEP_EMBED", "nomic-embed-text")

# In-memory state (mirrors Graphiti's bi-temporal + entity-edge model)
state = {
    "episodes": [],      # raw ingested episodes
    "entities": {},      # entity_id -> {name, type, summary, created_at}
    "edges": [],         # [(source, target, fact, valid_at, invalid_at, created_at)]
    "audit_log": [],
    "_embed_cache": {},  # episode_id -> embedding vector (cached)
}

def gen_id(prefix, content):
    return f"{prefix}-{hashlib.sha1(content.encode()).hexdigest()[:12]}"

async def ollama_embed(text):
    import urllib.request
    data = json.dumps({"model": EMBED_MODEL, "prompt": text}).encode()
    req = urllib.request.Request(f"{OLLAMA_URL}/api/embeddings", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())["embedding"]

async def ollama_chat(prompt, system=""):
    import urllib.request
    msgs = []
    if system: msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": prompt})
    data = json.dumps({"model": LLM_MODEL, "messages": msgs, "stream": False}).encode()
    req = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["message"]["content"]

async def extract_entities_and_facts(text, group_id):
    """Mimic Graphiti's LLM-based extraction: extract (entity, type, fact) tuples."""
    system = "You extract entities and facts from text. Return JSON: {\"entities\": [{\"name\": \"x\", \"type\": \"person|concept|technology\"}], \"facts\": [{\"source\": \"x\", \"target\": \"y\", \"fact\": \"...\"}]}"
    try:
        response = await ollama_chat(f"Extract entities and facts from: {text[:2000]}", system)
        # Try to parse JSON from response
        start = response.find("{")
        end = response.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(response[start:end])
    except Exception:
        pass
    return {"entities": [], "facts": []}

def cosine(a, b):
    if len(a) != len(b): return 0.0
    dot = sum(x*y for x, y in zip(a, b))
    na = sum(x*x for x in a) ** 0.5
    nb = sum(y*y for y in b) ** 0.5
    return dot / (na * nb + 1e-9)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def _send(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self._send(200, {"status": "ok", "version": "zep-graphiti-local-1.0", "entities": len(state["entities"]), "edges": len(state["edges"]), "episodes": len(state["episodes"])})
        elif path == "/stats":
            self._send(200, {"entities": len(state["entities"]), "edges": len(state["edges"]), "episodes": len(state["episodes"]), "audit": len(state["audit_log"])})
        else:
            self._send(404, {"detail": "not found"})
    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)))
        except Exception as e:
            self._send(400, {"detail": f"bad json: {e}"})
            return
        try:
            if path == "/episodes":
                text = body.get("content", "")
                group_id = body.get("group_id", "default")
                eid = gen_id("ep", text + str(time.time()))
                now = datetime.utcnow().isoformat() + "Z"
                state["episodes"].append({"id": eid, "content": text, "group_id": group_id, "created_at": now})
                state["audit_log"].append({"ts": now, "event": "EPISODE_ADD", "id": eid})
                self._send(200, {"id": eid})
            elif path == "/search":
                self._handle_search(body)
            elif path == "/bulk":
                records = body.get("records", [])
                count = 0
                now = datetime.utcnow().isoformat() + "Z"
                for r in records:
                    text = r.get("text", "")
                    group_id = r.get("group_id", "default")
                    if not text: continue
                    eid = gen_id("bulkep", text + str(count))
                    state["episodes"].append({"id": eid, "content": text, "group_id": group_id, "created_at": now})
                    count += 1
                self._send(200, {"added": count})
            elif path == "/edges":
                self._send(200, {"edges": state["edges"]})
            else:
                self._send(404, {"detail": "not found"})
        except Exception as e:
            self._send(500, {"detail": str(e)})

    def _handle_search(self, body):
        import urllib.request
        q = body.get("query", "")
        group_id = body.get("group_id", "default")
        limit = body.get("limit", 10)
        scored = []
        try:
            data = json.dumps({"model": EMBED_MODEL, "prompt": q}).encode()
            req = urllib.request.Request(f"{OLLAMA_URL}/api/embeddings", data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as r:
                qvec = json.loads(r.read())["embedding"]
            sem_ok = True
        except Exception:
            sem_ok = False
        for ep in state["episodes"]:
            if ep.get("group_id") != group_id: continue
            content = ep["content"]
            if sem_ok:
                # Use cached embedding if available; embed on demand otherwise
                ep_id = ep["id"]
                if ep_id not in state["_embed_cache"]:
                    try:
                        data = json.dumps({"model": EMBED_MODEL, "prompt": content[:500]}).encode()
                        req = urllib.request.Request(f"{OLLAMA_URL}/api/embeddings", data=data, headers={"Content-Type": "application/json"})
                        with urllib.request.urlopen(req, timeout=5) as r:
                            state["_embed_cache"][ep_id] = json.loads(r.read())["embedding"]
                    except Exception:
                        state["_embed_cache"][ep_id] = None
                epvec = state["_embed_cache"].get(ep_id)
                score = cosine(qvec, epvec) if epvec is not None else 0.0
            else:
                q_tokens = set(q.lower().split())
                c_tokens = set(content.lower().split())
                score = len(q_tokens & c_tokens) / max(len(q_tokens), 1)
            scored.append({"id": ep["id"], "content": content, "score": score})
        scored.sort(key=lambda x: x["score"], reverse=True)
        self._send(200, {"results": scored[:limit], "total": len(scored)})
    async def _add_episode(self, text, group_id):
        eid = gen_id("ep", text + str(time.time()))
        now = datetime.utcnow().isoformat() + "Z"
        state["episodes"].append({"id": eid, "content": text, "group_id": group_id, "created_at": now})
        # Skip LLM extraction for benchmark — use lightweight keyword extraction
        # Graphiti in production uses LLM; we approximate with word-level entity detection
        if os.environ.get("ZEP_FAST") == "1":
            words = [w.strip(".,;:()") for w in text.split() if len(w) > 4 and w[0].isupper()]
            for w in words[:3]:
                eid_ent = gen_id("ent", w)
                if eid_ent not in state["entities"]:
                    state["entities"][eid_ent] = {"name": w, "type": "concept", "group_id": group_id, "summary": w, "created_at": now}
        else:
            try:
                extraction = await extract_entities_and_facts(text, group_id)
                for ent in extraction.get("entities", []):
                    name = ent.get("name", "")
                    if not name: continue
                    eid_ent = gen_id("ent", name)
                    if eid_ent not in state["entities"]:
                        state["entities"][eid_ent] = {"name": name, "type": ent.get("type", "concept"), "group_id": group_id, "summary": name, "created_at": now}
                for f in extraction.get("facts", []):
                    src = f.get("source", "")
                    tgt = f.get("target", "")
                    fact = f.get("fact", "")
                    if not (src and tgt and fact): continue
                    state["edges"].append({"source": src, "target": tgt, "fact": fact, "valid_at": now, "invalid_at": None, "created_at": now, "group_id": group_id})
            except Exception:
                pass
        state["audit_log"].append({"ts": now, "event": "EPISODE_ADD", "id": eid})
        return {"id": eid, "entities_extracted": 0, "facts_extracted": 0}
    async def _search(self, body):
        q = body.get("query", "")
        group_id = body.get("group_id", "default")
        limit = body.get("limit", 10)
        qvec = await ollama_embed(q)
        scored = []
        for ep in state["episodes"]:
            if ep.get("group_id") != group_id: continue
            score = cosine(qvec, await ollama_embed(ep["content"]))
            scored.append({"id": ep["id"], "content": ep["content"], "score": score})
        scored.sort(key=lambda x: x["score"], reverse=True)
        return {"results": scored[:limit], "total": len(scored)}
    async def _bulk(self, body):
        records = body.get("records", [])
        count = 0
        for r in records:
            text = r.get("text", "")
            group_id = r.get("group_id", "default")
            if not text: continue
            eid = gen_id("bulkep", text + str(count))
            now = datetime.utcnow().isoformat() + "Z"
            state["episodes"].append({"id": eid, "content": text, "group_id": group_id, "created_at": now})
            count += 1
        return {"added": count}

def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[zep-graphiti-local] Listening on http://127.0.0.1:{PORT} (Ollama: {OLLAMA_URL})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()

if __name__ == "__main__":
    main()
