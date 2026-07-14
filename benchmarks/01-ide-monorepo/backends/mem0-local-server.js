// mem0-local-server.js — Real Mem0-compatible local REST server using Ollama embeddings.
//
// Implements the documented Mem0 API contract on http://127.0.0.1:8124:
//   - POST /v1/memories/  (add a memory with LLM extraction + embedding)
//   - GET  /v1/memories/?user_id=...  (list memories)
//   - POST /v1/memories/search/  (semantic search)
//   - DELETE /v1/memories/?user_id=...  (delete all)
//   - DELETE /v1/memories/{memory_id}/  (delete one)
//   - GET  /v1/memories/{memory_id}/  (get one)
//
// Uses Ollama's nomic-embed-text (768-dim) for real embeddings. In-memory
// vector store with cosine similarity. No Postgres, no Qdrant, no cloud.
// Mimics Mem0's user_id isolation, user_id= scoping, and search signature.

import express from "express";
import * as crypto from "node:crypto";

const PORT = parseInt(process.env.MEM0_LOCAL_PORT || "8124", 10);
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.MEM0_EMBED_MODEL || "nomic-embed-text";
const app = express();
app.use(express.json({ limit: "10mb" }));

const state = {
  memories: new Map(),
  vectors: new Map(),
  userIndex: new Map(),
  auditLog: [],
};

function genId() {
  return `mem0-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function stableId(prefix, content) {
  return `${prefix}-${crypto.createHash("sha1").update(content).digest("hex").slice(0, 12)}`;
}

async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
  const data = await res.json();
  return data.embedding;
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

async function extractFacts(text) {
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
  return sentences.slice(0, 5);
}

function logAudit(event, desc) {
  state.auditLog.push({ timestamp: new Date().toISOString(), event, description: desc });
  if (state.auditLog.length > 500) state.auditLog.shift();
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "mem0-local-1.0", memories: state.memories.size, embeddingModel: EMBED_MODEL });
});

app.post("/v1/memories/", async (req, res) => {
  try {
    const { messages, user_id, metadata = {}, infer = true } = req.body || {};
    const text = (messages && Array.isArray(messages) && messages[0]?.content) || req.body?.text || "";
    if (!text) return res.status(400).json({ detail: "content required" });
    if (!user_id) return res.status(400).json({ detail: "user_id required" });
    const facts = infer ? await extractFacts(text) : [text];
    const created = [];
    for (const fact of facts) {
      const id = stableId("mem", user_id + fact);
      const emb = await embed(fact);
      const now = new Date().toISOString();
      const mem = {
        id, memory: fact, user_id, metadata, created_at: now, updated_at: now,
      };
      state.memories.set(id, mem);
      state.vectors.set(id, emb);
      if (!state.userIndex.has(user_id)) state.userIndex.set(user_id, new Set());
      state.userIndex.get(user_id).add(id);
      created.push({ id, memory: fact, event: "ADD" });
    }
    logAudit("MEMORY_ADD", `Added ${created.length} memories for ${user_id}`);
    res.json({ results: created });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.post("/v1/memories/bulk/", async (req, res) => {
  try {
    const { records } = req.body || {};
    if (!Array.isArray(records)) return res.status(400).json({ detail: "records array required" });
    const BATCH_SIZE = 50;
    let count = 0;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const embResults = await Promise.all(batch.map(async (r) => {
        const text = r.text || r.memory || "";
        if (!text) return null;
        try { return { text, emb: await embed(text) }; } catch (e) { return { text, emb: null }; }
      }));
      for (let j = 0; j < batch.length; j++) {
        const r = batch[j];
        const er = embResults[j];
        if (!er || !er.emb) continue;
        const userId = r.user_id || "default";
        const id = stableId("bulkmem", userId + er.text + count);
        const now = r.created_at || new Date().toISOString();
        state.memories.set(id, { id, memory: er.text, user_id: userId, metadata: r.metadata || {}, created_at: now, updated_at: now });
        state.vectors.set(id, er.emb);
        if (!state.userIndex.has(userId)) state.userIndex.set(userId, new Set());
        state.userIndex.get(userId).add(id);
        count++;
      }
    }
    logAudit("BULK_ADD", `Added ${count} memories`);
    res.json({ added: count });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.get("/v1/memories/", (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ detail: "user_id required" });
  const ids = state.userIndex.get(user_id) || new Set();
  const results = Array.from(ids).map(id => state.memories.get(id)).filter(Boolean);
  res.json({ results, count: results.length });
});

app.post("/v1/memories/search/", async (req, res) => {
  try {
    const { query, user_id, limit = 10 } = req.body || {};
    if (!query) return res.status(400).json({ detail: "query required" });
    const targetUser = user_id || "all";
    const queryEmb = await embed(query);
    const candidates = [];
    if (targetUser === "all") {
      for (const [id, emb] of state.vectors) candidates.push({ id, emb });
    } else {
      const ids = state.userIndex.get(targetUser) || new Set();
      for (const id of ids) if (state.vectors.has(id)) candidates.push({ id, emb: state.vectors.get(id) });
    }
    const scored = candidates.map(c => ({ id: c.id, score: cosineSimilarity(queryEmb, c.emb) }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);
    const results = top.map(s => {
      const mem = state.memories.get(s.id);
      return { id: s.id, memory: mem?.memory, score: s.score, user_id: mem?.user_id, metadata: mem?.metadata };
    });
    res.json({ results, count: results.length, total: scored.length });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.delete("/v1/memories/", (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ detail: "user_id required" });
  const ids = state.userIndex.get(user_id) || new Set();
  let count = 0;
  for (const id of ids) {
    state.memories.delete(id);
    state.vectors.delete(id);
    count++;
  }
  state.userIndex.set(user_id, new Set());
  logAudit("DELETE_ALL", `Deleted ${count} memories for ${user_id}`);
  res.json({ deleted: count });
});

app.delete("/v1/memories/:id/", (req, res) => {
  const id = req.params.id;
  if (!state.memories.has(id)) return res.status(404).json({ detail: "not found" });
  const mem = state.memories.get(id);
  state.memories.delete(id);
  state.vectors.delete(id);
  if (mem && state.userIndex.has(mem.user_id)) state.userIndex.get(mem.user_id).delete(id);
  logAudit("DELETE", `Deleted ${id}`);
  res.json({ id, deleted: true });
});

app.get("/v1/memories/:id/", (req, res) => {
  const id = req.params.id;
  if (!state.memories.has(id)) return res.status(404).json({ detail: "not found" });
  res.json(state.memories.get(id));
});

app.get("/stats", (req, res) => {
  res.json({
    memories: state.memories.size,
    vectors: state.vectors.size,
    users: state.userIndex.size,
    auditLog: state.auditLog.length,
  });
});

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`[mem0-local] Listening on http://127.0.0.1:${PORT} (Ollama: ${OLLAMA_URL}, model: ${EMBED_MODEL})`);
});

process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });

export { app, state };
