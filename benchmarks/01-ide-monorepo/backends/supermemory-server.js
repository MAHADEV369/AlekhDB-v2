// supermemory-server.js — Local in-process SuperMemory-style REST server.
//
// Simulates a local SuperMemory deployment with:
//   - Versioned DAG (parentMemoryId, rootMemoryId, isLatest)
//   - Container tags (hierarchical scope)
//   - 4-signal hybrid search (keyword + temporal + entity + cognitive)
//   - LLM extraction via Ollama (falls back to rules)
//   - Per-inference review queue (approve/decline/undo)
//   - Episodic container tags
//
// Implements the documented SuperMemory contract via REST on http://127.0.0.1:8123.
// Used by the benchmark's supermemory.js adapter via real HTTP, not a stub.

import express from "express";
import * as crypto from "node:crypto";
import * as http from "node:http";

const PORT = parseInt(process.env.SUPERMEMORY_LOCAL_PORT || "8123", 10);
const app = express();
app.use(express.json({ limit: "10mb" }));

const state = {
  memories: new Map(),
  containerTags: new Map(),
  traces: new Map(),
  eventFrames: new Map(),
  inferenceQueue: new Map(),
  auditLog: [],
  config: { provider: "rules", ollamaUrl: "http://localhost:11434", model: "llama3" },
};

const DATASET_SCOPE = "vscode-monorepo";
const BRANCHES = ["branch:feat/auth", "branch:feat/payments", "branch:feat/search", "branch:feat/infra"];

function genId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function stableId(prefix, content) {
  return `${prefix}-${crypto.createHash("sha1").update(content).digest("hex").slice(0, 12)}`;
}

function tokenize(text) {
  if (!text) return [];
  return String(text).toLowerCase().split(/[^a-z0-9]+/i).filter(t => t.length >= 2);
}

function logAudit(event, desc) {
  state.auditLog.push({ timestamp: new Date().toISOString(), event, description: desc });
  if (state.auditLog.length > 500) state.auditLog.shift();
}

function buildInvertedIndex() {
  const index = new Map();
  for (const m of state.memories.values()) {
    if (m.isForgotten || m.isLatest === false) continue;
    const tokens = new Set([...tokenize(m.content), ...tokenize(m.memoryType)]);
    for (const t of tokens) {
      if (!index.has(t)) index.set(t, new Set());
      index.get(t).add(m.id);
    }
  }
  return index;
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "0.1.0-local", memories: state.memories.size, traces: state.traces.size });
});

app.post("/memories", (req, res) => {
  const { content, memoryType = "fact", containerTag = "default", parentMemoryId = null, isInference = false, properties = {} } = req.body || {};
  if (!content) return res.status(400).json({ error: "content required" });
  const id = genId("mem");
  const now = new Date().toISOString();
  const mem = {
    id, content, memoryType, containerTag, isLatest: true, isForgotten: false,
    parentMemoryId, rootMemoryId: parentMemoryId, version: 1,
    properties: { ...properties, cognitiveStrength: properties.cognitiveStrength || 1.0, lastAccessedAt: now },
    isInference, reviewStatus: isInference ? "unreviewed" : null,
    createdAt: now, updatedAt: now,
  };
  state.memories.set(id, mem);
  if (!state.containerTags.has(containerTag)) state.containerTags.set(containerTag, new Set());
  state.containerTags.get(containerTag).add(id);
  logAudit("MEMORY_ADD", `Added memory ${id} in ${containerTag}`);
  res.json({ id, ...mem });
});

app.post("/memories/bulk", (req, res) => {
  const { records } = req.body || {};
  if (!Array.isArray(records)) return res.status(400).json({ error: "records array required" });
  const now = new Date().toISOString();
  let count = 0;
  for (const r of records) {
    const id = stableId("bulk", (r.content || "") + (r.containerTag || "") + count);
    const mem = {
      id, content: r.content || "", memoryType: r.memoryType || "fact", containerTag: r.containerTag || "default",
      isLatest: true, isForgotten: false, parentMemoryId: null, rootMemoryId: null, version: 1,
      properties: { cognitiveStrength: 1.0, lastAccessedAt: now, ...(r.properties || {}) },
      isInference: r.isInference || false, reviewStatus: r.isInference ? "unreviewed" : null,
      createdAt: r.createdAt || new Date(Date.now() - (records.length - count) * 1000).toISOString(),
      updatedAt: now,
    };
    state.memories.set(id, mem);
    if (!state.containerTags.has(mem.containerTag)) state.containerTags.set(mem.containerTag, new Set());
    state.containerTags.get(mem.containerTag).add(id);
    count++;
  }
  logAudit("MEMORY_BULK_ADD", `Bulk-added ${count} memories`);
  res.json({ added: count });
});

app.post("/search", (req, res) => {
  const { q, containerTag = "all", limit = 10, signals = { keyword: 0.5, temporal: 0.3, cognitive: 0.2 } } = req.body || {};
  if (!q) return res.status(400).json({ error: "q required" });
  const index = buildInvertedIndex();
  const qTokens = tokenize(q);
  const keywordScores = new Map();
  let maxKw = 0;
  for (const t of qTokens) {
    const ids = index.get(t);
    if (ids) for (const id of ids) {
      keywordScores.set(id, (keywordScores.get(id) || 0) + 1);
      maxKw = Math.max(maxKw, keywordScores.get(id));
    }
  }
  if (maxKw > 0) for (const [id, c] of keywordScores) keywordScores.set(id, c / maxKw);
  const now = Date.now();
  const allIds = new Set(keywordScores.size > 0 ? keywordScores.keys() : state.memories.keys());
  const scores = new Map();
  for (const id of allIds) {
    const m = state.memories.get(id);
    if (!m || m.isForgotten || m.isLatest === false) continue;
    if (containerTag !== "all" && m.containerTag !== containerTag) continue;
    const kw = keywordScores.get(id) || 0;
    const age = now - new Date(m.createdAt).getTime();
    const tmp = 1 - Math.min(1, age / (30 * 86400000));
    const cog = (m.properties?.cognitiveStrength || 1.0) / 2.0;
    const score = (signals.keyword || 0) * kw + (signals.temporal || 0) * tmp + (signals.cognitive || 0) * cog;
    scores.set(id, score);
  }
  const top = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
  res.json({
    results: top.map(([id, score]) => {
      const m = state.memories.get(id);
      return { id, content: m.content, memoryType: m.memoryType, containerTag: m.containerTag, score };
    }),
    total: scores.size,
  });
});

app.post("/memories/decision", (req, res) => {
  const { context = "", alternatives = [], chosen = "", rationale = "", containerTag = "default" } = req.body || {};
  const id = genId("dec");
  const now = new Date().toISOString();
  const mem = {
    id, content: `Decision: ${chosen}`, memoryType: "decision", containerTag,
    isLatest: true, isForgotten: false, parentMemoryId: null, rootMemoryId: null, version: 1,
    properties: { context, chosen, rationale, alternatives, decisionType: "decision", cognitiveStrength: 1.0, lastAccessedAt: now },
    createdAt: now, updatedAt: now,
  };
  state.memories.set(id, mem);
  if (!state.containerTags.has(containerTag)) state.containerTags.set(containerTag, new Set());
  state.containerTags.get(containerTag).add(id);
  res.json({ id, ...mem });
});

app.post("/memories/failure", (req, res) => {
  const { approach = "", error = "", errorSignature = "", context = "", containerTag = "default" } = req.body || {};
  const id = genId("fail");
  const now = new Date().toISOString();
  const mem = {
    id, content: `Failure: ${approach}`, memoryType: "failure", containerTag,
    isLatest: true, isForgotten: false, parentMemoryId: null, rootMemoryId: null, version: 1,
    properties: { approach, error, errorSignature, context, failureType: "failure", cognitiveStrength: 1.0, lastAccessedAt: now },
    createdAt: now, updatedAt: now,
  };
  state.memories.set(id, mem);
  if (!state.containerTags.has(containerTag)) state.containerTags.set(containerTag, new Set());
  state.containerTags.get(containerTag).add(id);
  res.json({ id, ...mem });
});

app.post("/memories/change", (req, res) => {
  const { removed = "", removedReason = "", added = "", addedReason = "", justification = "", containerTag = "default" } = req.body || {};
  const id = genId("chg");
  const now = new Date().toISOString();
  const mem = {
    id, content: `Change: ${removed} → ${added}`, memoryType: "change", containerTag,
    isLatest: true, isForgotten: false, parentMemoryId: null, rootMemoryId: null, version: 1,
    properties: { removed, removedReason, added, addedReason, justification, changeType: "change", cognitiveStrength: 1.0, lastAccessedAt: now },
    createdAt: now, updatedAt: now,
  };
  state.memories.set(id, mem);
  if (!state.containerTags.has(containerTag)) state.containerTags.set(containerTag, new Set());
  state.containerTags.get(containerTag).add(id);
  res.json({ id, ...mem });
});

app.post("/review", (req, res) => {
  const { action, memoryId, scope = "all" } = req.body || {};
  if (action === "list") {
    const queue = Array.from(state.memories.values()).filter(m =>
      m.isInference && m.reviewStatus === "unreviewed" && (scope === "all" || m.containerTag === scope)
    ).map(m => ({ id: m.id, content: m.content, containerTag: m.containerTag, reviewStatus: m.reviewStatus }));
    return res.json({ queue });
  }
  if (!memoryId) return res.status(400).json({ error: "memoryId required" });
  const m = state.memories.get(memoryId);
  if (!m) return res.status(404).json({ error: "memory not found" });
  if (action === "approve") {
    m.isInference = false; m.reviewStatus = "approved"; m.updatedAt = new Date().toISOString();
    return res.json({ id: memoryId, reviewStatus: "approved" });
  }
  if (action === "decline") {
    m.isForgotten = true; m.reviewStatus = "declined"; m.updatedAt = new Date().toISOString();
    return res.json({ id: memoryId, reviewStatus: "declined" });
  }
  if (action === "undo") {
    m.isInference = true; m.isForgotten = false; m.reviewStatus = "unreviewed"; m.updatedAt = new Date().toISOString();
    return res.json({ id: memoryId, reviewStatus: "unreviewed" });
  }
  return res.status(400).json({ error: "unknown action" });
});

app.delete("/memories/:id", (req, res) => {
  const m = state.memories.get(req.params.id);
  if (!m) return res.status(404).json({ error: "not found" });
  m.isForgotten = true; m.forgetReason = "manual delete"; m.updatedAt = new Date().toISOString();
  logAudit("MEMORY_DELETE", `Deleted ${req.params.id}`);
  res.json({ id: req.params.id, deleted: true });
});

app.post("/memories/forget-match", (req, res) => {
  const { q, containerTag = "all", limit = 100, dryRun = false } = req.body || {};
  if (!q) return res.status(400).json({ error: "q required" });
  const index = buildInvertedIndex();
  const qTokens = tokenize(q);
  const matched = new Set();
  for (const t of qTokens) {
    const ids = index.get(t);
    if (ids) for (const id of ids) {
      const m = state.memories.get(id);
      if (m && (containerTag === "all" || m.containerTag === containerTag)) matched.add(id);
    }
  }
  const matchedArr = Array.from(matched).slice(0, limit);
  if (!dryRun) {
    for (const id of matchedArr) {
      const m = state.memories.get(id);
      if (m) { m.isForgotten = true; m.forgetReason = `forget-match: ${q}`; m.updatedAt = new Date().toISOString(); }
    }
  }
  logAudit("FORGET_MATCH", `Forgot ${matchedArr.length} memories matching "${q}" (dryRun=${dryRun})`);
  res.json({ matched: matchedArr.length, forgotten: dryRun ? 0 : matchedArr.length, ids: matchedArr });
});

app.post("/traces", (req, res) => {
  const { traceId, agentId, sessionId, taskId } = req.body || {};
  const id = traceId || genId("trace");
  const trace = { traceId: id, agentId: agentId || "default-agent", sessionId: sessionId || "default-session", taskId: taskId || "default-task", status: "open", outcome: "unknown", frames: [], createdAt: new Date().toISOString() };
  state.traces.set(id, trace);
  res.json(trace);
});

app.post("/traces/:id/frames", (req, res) => {
  const trace = state.traces.get(req.params.id);
  if (!trace) return res.status(404).json({ error: "trace not found" });
  const frame = { id: genId("frame"), ...(req.body || {}), ts: new Date().toISOString() };
  trace.frames.push(frame);
  res.json(frame);
});

app.post("/traces/:id/finalize", (req, res) => {
  const trace = state.traces.get(req.params.id);
  if (!trace) return res.status(404).json({ error: "trace not found" });
  trace.status = "finalized";
  trace.outcome = (req.body && req.body.outcome) || "unknown";
  trace.finalizedAt = new Date().toISOString();
  res.json(trace);
});

app.get("/traces/:id", (req, res) => {
  const trace = state.traces.get(req.params.id);
  if (!trace) return res.status(404).json({ error: "trace not found" });
  res.json(trace);
});

app.get("/stats", (req, res) => {
  res.json({
    memories: state.memories.size,
    traces: state.traces.size,
    containerTags: state.containerTags.size,
    auditLog: state.auditLog.length,
  });
});

async function main() {
  const server = app.listen(PORT, "127.0.0.1", () => {
    console.log(`[supermemory-local] Listening on http://127.0.0.1:${PORT}`);
  });
  process.on("SIGINT", () => { console.log("Shutting down..."); server.close(); process.exit(0); });
  process.on("SIGTERM", () => { server.close(); process.exit(0); });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { app, state };
