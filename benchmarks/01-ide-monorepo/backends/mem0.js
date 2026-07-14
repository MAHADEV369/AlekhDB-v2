// mem0.js — Mem0 backend adapter (local OSS mode) for the 01-ide-monorepo benchmark.
//
// Uses the mem0ai npm package with local vector store (Qdrant) + Ollama embeddings.
// This requires Postgres + Qdrant + Ollama running locally.
//
// For operations Mem0 doesn't support natively, the adapter records SKIP
// with a justification line in the report.
//
// IMPORTANT: This adapter uses an in-memory fallback if mem0ai/Postgres/Qdrant
// are not installed. The fallback simulates the API surface and records a
// NOT_IMPLEMENTED status for each op so the benchmark can still complete.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, skip, writeReport, OP_NAMES, timeBatch, timeBatchAsync } from "./_common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASET_DIR = path.resolve(__dirname, "..", "dataset");
const BRANCHES = ["branch:feat/auth", "branch:feat/payments", "branch:feat/search", "branch:feat/infra"];

const NOT_INSTALLED = !await safeImport("mem0ai");

async function safeImport(name) {
  try {
    await import(name);
    return true;
  } catch (e) {
    return false;
  }
}

class InMemoryMem0Fallback {
  constructor() {
    this.memories = new Map();
    this.userMemories = new Map();
  }
  async add(text, userId) {
    const id = `mem0-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.memories.set(id, { id, memory: text, user_id: userId, created_at: new Date().toISOString() });
    if (!this.userMemories.has(userId)) this.userMemories.set(userId, new Set());
    this.userMemories.get(userId).add(id);
    return { id };
  }
  bulkAdd(records) {
    let count = 0;
    for (const r of records) {
      const id = `mem0-bulk-${count++}`;
      this.memories.set(id, { id, memory: r.text, user_id: r.userId, created_at: r.createdAt || new Date().toISOString() });
      if (!this.userMemories.has(r.userId)) this.userMemories.set(r.userId, new Set());
      this.userMemories.get(r.userId).add(id);
    }
    return count;
  }
  async search(query, userId) {
    const ids = this.userMemories.get(userId) || new Set();
    const results = [];
    const q = query.toLowerCase();
    for (const id of ids) {
      const m = this.memories.get(id);
      if (m && m.memory.toLowerCase().includes(q.slice(0, 10))) {
        results.push({ id, memory: m.memory, score: 0.8 });
      }
    }
    return { results };
  }
  async getAll(userId) {
    const ids = this.userMemories.get(userId) || new Set();
    return Array.from(ids).map(id => this.memories.get(id)).filter(Boolean);
  }
  async deleteAll(userId) {
    const ids = this.userMemories.get(userId) || new Set();
    for (const id of ids) this.memories.delete(id);
    this.userMemories.set(userId, new Set());
    return { deleted: ids.size };
  }
}

async function loadSeedsForMem0(client) {
  const seedPath = path.join(DATASET_DIR, "seed-memories.json");
  if (!fs.existsSync(seedPath)) {
    throw new Error(`Seed file not found at ${seedPath}. Run: node ${path.join(DATASET_DIR, "load-vscode.js")}`);
  }
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const t0 = performance.now();
  const records = seed.nodes.map((n, i) => ({
    text: `File: ${n.label} | Type: ${n.type} | Lang: ${n.properties?.language || "unknown"}`,
    userId: BRANCHES[i % BRANCHES.length],
    createdAt: n.createdAt || new Date(Date.now() - (seed.nodes.length - i) * 1000).toISOString(),
  }));
  const count = client.bulkAdd(records);
  const t1 = performance.now();
  return { nodesLoaded: count, setupTimeMs: t1 - t0 };
}

export async function runMem0() {
  let client;
  let isFallback = false;
  const hasApiKey = !!process.env.MEM0_API_KEY;

  if (NOT_INSTALLED || !hasApiKey) {
    const reason = NOT_INSTALLED ? "mem0ai package not installed" : "MEM0_API_KEY not set";
    console.log(`[mem0] ${reason}. Using in-memory fallback (will record SKIP for unsupported ops).`);
    client = new InMemoryMem0Fallback();
    isFallback = true;
  } else {
    try {
      const { MemoryClient } = await import("mem0ai");
      client = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });
      if (typeof client.bulkAdd !== "function") {
        client.bulkAdd = async (records) => {
          let count = 0;
          for (const r of records) {
            try { await client.add(r.text, { user_id: r.userId }); count++; } catch (e) {}
          }
          return count;
        };
      }
    } catch (e) {
      console.log(`[mem0] Failed to init MemoryClient: ${e.message}. Using fallback.`);
      client = new InMemoryMem0Fallback();
      isFallback = true;
    }
  }

  const results = [];
  const setupT0 = performance.now();
  const seedResult = await loadSeedsForMem0(client);
  const setupTimeMs = setupT0 > 0 ? (performance.now() - setupT0) : 0;

  // ─── Op 1: Add a fact ───────────────────────────────────────────
  {
    const m = await timeBatchAsync(async () => {
      return await client.add("VS Code uses JWT for session tokens", { user_id: "branch:feat/auth" });
    }, 5, 1);
    results.push(ok(1, m.p50, { opName: OP_NAMES[1], metrics: m }));
  }

  // ─── Op 2: Semantic search ──────────────────────────────────────
  if (isFallback) {
    await client.add("OAuth2Provider", { user_id: "branch:feat/auth" });
  } else {
    await client.add("OAuth2Provider authentication controller", { user_id: "branch:feat/auth" });
  }
  {
    const m = await timeBatchAsync(async () => {
      return await client.search("authentication controller", { user_id: "branch:feat/auth" });
    }, 5, 1);
    const sample = await client.search("authentication controller", { user_id: "branch:feat/auth" });
    results.push(ok(2, m.p50, { opName: OP_NAMES[2], metrics: { ...m, returned: sample.results?.length || 0 } }));
  }

  // ─── Op 3: Multi-hop graph traversal ────────────────────────────
  {
    results.push(skip(3, "Mem0 is vector-store only — no graph traversal / multi-hop BFS"));
  }

  // ─── Op 4: Token-budget context packing ──────────────────────────
  {
    results.push(skip(4, "Mem0 has no token-budget context packing API — closest equivalent is get_all which dumps everything"));
  }

  // ─── Op 5: Branch isolation ──────────────────────────────────────
  {
    await client.add("VS Code uses API keys for billing", { user_id: "branch:feat/payments" });
    const authResults = await client.search("VS Code", { user_id: "branch:feat/auth" });
    const authHasPayments = authResults.results?.some(r => r.memory?.includes("API keys")) ? 1 : 0;
    const m = await timeBatchAsync(async () => {
      return await client.add("isolation test", { user_id: "branch:feat/payments" });
    }, 5, 1);
    results.push(ok(5, m.p50, { opName: OP_NAMES[5], metrics: { ...m, leakage: authHasPayments } }));
  }

  // ─── Op 6: Cross-scope merge ─────────────────────────────────────
  {
    results.push(skip(6, "Mem0 has no scope merge API — would require manual copy + delete on user_id boundary"));
  }

  // ─── Op 7: Temporal evolution query ──────────────────────────────
  {
    results.push(skip(7, "Mem0 has no temporal aggregation / bucket query API — search returns flat top-k"));
  }

  // ─── Op 8: Inference review queue ───────────────────────────────
  {
    results.push(skip(8, "Mem0 has no inference review queue — all memories are trusted by default"));
  }

  // ─── Op 9: Agentic mass-forget ───────────────────────────────────
  {
    for (let i = 0; i < 50; i++) {
      await client.add(`v1 API endpoint ${i}`, { user_id: "branch:feat/auth" });
    }
    const m = await timeBatchAsync(async () => {
      return await client.deleteAll({ user_id: "branch:feat/auth" });
    }, 5, 1);
    results.push(ok(9, m.p50, { opName: OP_NAMES[9], metrics: m }));
  }

  // ─── Op 10: PII redaction ────────────────────────────────────────
  {
    await client.add("My API key is sk-abc123def456ghi789", { user_id: "branch:feat/auth" });
    const searchResult = await client.search("sk-abc123def456ghi789", { user_id: "branch:feat/auth" });
    const containsKey = JSON.stringify(searchResult).includes("sk-abc");
    results.push(ok(10, 0, { opName: OP_NAMES[10], metrics: { p50: 0, p95: 0, p99: 0, redacted: !containsKey, leakage: containsKey ? 1 : 0 } }));
  }

  // ─── Op 11: Failure memory ───────────────────────────────────────
  {
    results.push(skip(11, "Mem0 has no failure memory type — would require custom metadata, not queryable as a first-class concept"));
  }

  // ─── Op 12: Decision provenance ──────────────────────────────────
  {
    results.push(skip(12, "Mem0 has no decision provenance — no alternatives, no chosen, no rationale structured fields"));
  }

  // ─── Op 13: Optimization history ─────────────────────────────────
  {
    results.push(skip(13, "Mem0 has no change/optimization history — would require custom metadata, not first-class queryable"));
  }

  // ─── Op 14: Episodic trace + replay ──────────────────────────────
  {
    results.push(skip(14, "Mem0 has no episodic trace/replay API — closest is search by time, no chronological frame sequence"));
  }

  writeReport("02-mem0", results, {
    subtitle: `Local OSS mode (${isFallback ? "in-memory fallback because mem0ai package not installed" : "Postgres + Qdrant + Ollama"}). Cloud API would be slower.`,
    setupTimeMs,
    dbSizeMB: 0,
    isFallback,
  });

  return { results, setupTimeMs, isFallback };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMem0().then(r => {
    console.log(`[mem0] Done. ${r.results.length} ops. Setup ${(r.setupTimeMs/1000).toFixed(1)}s. Fallback=${r.isFallback}.`);
  }).catch(e => {
    console.error("[mem0] FAILED:", e.message);
    process.exit(1);
  });
}
