#!/usr/bin/env python3
"""
letta-server.py — Letta-compatible local REST server.

Letta (formerly MemGPT) is a published memory system for agents. Its core memory
model is: recall memory (in-context, structured blocks) + archival memory
(vector-indexed long-term storage).

This adapter implements the Letta agent-memory surface via REST on port 8126:
   - POST /v1/agents/{agent_id}/memory/recall     (insert into in-context memory)
   - POST /v1/agents/{agent_id}/memory/archival   (insert into vector archival)
   - GET  /v1/agents/{agent_id}/memory/archival   (search archival via embeddings)
   - DELETE /v1/agents/{agent_id}/memory          (clear all)

Uses Ollama for embeddings. No Postgres, no Letta daemon, no cloud.
"""

import os
import json
import time
import hashlib
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = int(os.environ.get("LETTA_LOCAL_PORT", "8126"))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL = os.environ.get("LETTA_EMBED", "nomic-embed-text")

state = {
    "agents": {},           # agent_id -> {recall_blocks: [...], archival: [...]}
    "embed_cache": {},
    "audit": [],
}
state_lock = threading.Lock()

def gen_id(prefix, content):
    return f"{prefix}-{hashlib.sha1(content.encode()).hexdigest()[:12]}"

def ollama_embed(text):
    import urllib.request
    if text in state["embed_cache"]:
        return state["embed_cache"][text]
    data = json.dumps({"model": EMBED_MODEL, "prompt": text}).encode()
    req = urllib.request.Request(f"{OLLAMA_URL}/api/embeddings", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        vec = json.loads(r.read())["embedding"]
    state["embed_cache"][text] = vec
    return vec

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
    def _get_agent(self, agent_id):
        with state_lock:
            if agent_id not in state["agents"]:
                state["agents"][agent_id] = {"recall_blocks": [], "archival": []}
            return state["agents"][agent_id]
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self._send(200, {"status": "ok", "version": "letta-local-1.0", "agents": len(state["agents"])})
        elif path.startswith("/v1/agents/") and path.endswith("/memory/archival"):
            # /v1/agents/{id}/memory/archival
            parts = path.split("/")
            agent_id = parts[3]
            qs = urlparse(self.path).query
            params = dict(p.split("=") for p in qs.split("&") if "=" in p) if qs else {}
            query = params.get("query", "")
            limit = int(params.get("limit", "10"))
            self._handle_archival_search(agent_id, query, limit)
        else:
            self._send(404, {"detail": "not found"})
    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)))
        except Exception:
            self._send(400, {"detail": "bad json"})
            return
        try:
            if path.startswith("/v1/agents/") and path.endswith("/memory/recall"):
                agent_id = path.split("/")[3]
                self._handle_recall_insert(agent_id, body)
            elif path.startswith("/v1/agents/") and path.endswith("/memory/archival"):
                agent_id = path.split("/")[3]
                self._handle_archival_insert(agent_id, body)
            elif path == "/v1/bulk":
                self._handle_bulk(body)
            else:
                self._send(404, {"detail": "not found"})
        except Exception as e:
            self._send(500, {"detail": str(e)})
    def do_DELETE(self):
        path = urlparse(self.path).path
        parts = path.split("/")
        if len(parts) >= 4 and parts[3] == "memory" and "archival" in path:
            agent_id = parts[3] if "agents" in path else "default"
            try:
                agent_id = path.split("/")[3]
            except Exception:
                agent_id = "default"
            with state_lock:
                if agent_id in state["agents"]:
                    state["agents"][agent_id]["archival"] = []
                    state["agents"][agent_id]["recall_blocks"] = []
            self._send(200, {"deleted": True})
        else:
            self._send(404, {"detail": "not found"})
    def _handle_recall_insert(self, agent_id, body):
        agent = self._get_agent(agent_id)
        text = body.get("text", body.get("content", ""))
        if not text: return self._send(400, {"detail": "text required"})
        with state_lock:
            agent["recall_blocks"].append({"text": text, "created_at": datetime.utcnow().isoformat() + "Z"})
        self._send(200, {"ok": True})
    def _handle_archival_insert(self, agent_id, body):
        agent = self._get_agent(agent_id)
        text = body.get("text", body.get("content", ""))
        if not text: return self._send(400, {"detail": "text required"})
        try:
            emb = ollama_embed(text)
        except Exception:
            emb = None
        with state_lock:
            agent["archival"].append({"text": text, "embedding": emb, "created_at": datetime.utcnow().isoformat() + "Z"})
        self._send(200, {"ok": True})
    def _handle_archival_search(self, agent_id, query, limit):
        agent = self._get_agent(agent_id)
        if not query:
            with state_lock: results = list(agent["archival"])
        else:
            try:
                qvec = ollama_embed(query)
            except Exception:
                self._send(200, {"results": [], "total": 0})
                return
            scored = []
            for item in agent["archival"]:
                if not item.get("embedding"): continue
                scored.append({"text": item["text"], "score": cosine(qvec, item["embedding"])})
            scored.sort(key=lambda x: x["score"], reverse=True)
            results = scored[:limit]
        self._send(200, {"results": results, "total": len(results)})
    def _handle_bulk(self, body):
        records = body.get("records", [])
        bulk_groups = {}
        for r in records:
            aid = r.get("agent_id", "default")
            bulk_groups.setdefault(aid, []).append(r)
        count = 0
        for aid, recs in bulk_groups.items():
            agent = self._get_agent(aid)
            for r in recs:
                text = r.get("text", "")
                if not text: continue
                try:
                    emb = ollama_embed(text)
                except Exception:
                    emb = None
                with state_lock:
                    agent["archival"].append({"text": text, "embedding": emb, "created_at": datetime.utcnow().isoformat() + "Z"})
                count += 1
        self._send(200, {"added": count})

def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[letta-local] Listening on http://127.0.0.1:{PORT} (Ollama: {OLLAMA_URL})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()

if __name__ == "__main__":
    main()
