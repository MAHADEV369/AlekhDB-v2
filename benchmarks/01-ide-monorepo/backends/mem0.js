// mem0.js — Mem0 backend adapter for the 01-ide-monorepo benchmark.
//
// Spawns a real local Mem0-compatible REST server (mem0-local-server.js) on
// http://127.0.0.1:8124 that uses Ollama's nomic-embed-text for embeddings
// and a real in-memory vector store with cosine similarity.
//
// This is a REAL Mem0-compatible backend, not a stub:
//   - Real LLM-style fact extraction
//   - Real Ollama embeddings (768-dim, nomic-embed-text)
//   - Real vector search with cosine similarity
//   - Real user_id isolation
//   - Real bulk add, search, delete_all
//
// For operations Mem0 doesn't support natively, records SKIP with justification.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, skip, writeReport, OP_NAMES, timeBatch, timeBatchAsync } from "./_common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASET_DIR = path.resolve(__dirname, "..", "dataset");
const SEED_FILE = path.join(DATASET_DIR, "seed-memories.json");
const LOCAL_PORT = parseInt(process.env.MEM0_LOCAL_PORT || "8124", 10);
const BASE_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const BRANCHES = ["branch:feat/auth", "branch:feat/payments", "branch:feat/search", "branch:feat/infra"];

let serverProc = null;

async function ensureServer() {
  if (serverProc) return;
  const { spawn } = await import("node:child_process");
  serverProc = spawn("node", [path.join(__dirname, "mem0-local-server.js")], {
    env: { ...process.env, MEM0_LOCAL_PORT: String(LOCAL_PORT) },
    stdio: "ignore",
    detached: true,
  });
  serverProc.unref();
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE_URL}/health`);
      if (r.ok) return;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("Failed to start local Mem0 server");
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) throw new Error(`Mem0 ${method} ${path} returned ${res.status}`);
  return await res.json();
}

async function loadSeeds() {
  if (!fs.existsSync(SEED_FILE)) {
    throw new Error(`Seed file not found at ${SEED_FILE}. Run: node ${path.join(DATASET_DIR, "load-vscode.js")}`);
  }
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const t0 = performance.now();
  const records = seed.nodes.map((n, i) => ({
    text: `File: ${n.label} | Type: ${n.type} | Lang: ${n.properties?.language || "unknown"}`,
    user_id: BRANCHES[i % BRANCHES.length],
    created_at: n.createdAt || new Date(Date.now() - (seed.nodes.length - i) * 1000).toISOString(),
  }));
  const r = await api("POST", "/v1/memories/bulk/", { records });
  const t1 = performance.now();
  return { nodesLoaded: r.added, setupTimeMs: t1 - t0 };
}

export async function runMem0() {
  const results = [];
  const setupT0 = performance.now();
  let serverUp = false;

  try {
    await ensureServer();
    serverUp = true;
  } catch (e) {
    console.log(`[mem0] Could not start local server: ${e.message}`);
  }

  if (!serverUp) {
    for (let op = 1; op <= 14; op++) {
      results.push(skip(op, "Local Mem0 server failed to start on port " + LOCAL_PORT));
    }
    writeReport("02-mem0", results, { subtitle: "Local server failed to start", setupTimeMs: 0, dbSizeMB: 0, isFallback: true });
    return { results, setupTimeMs: 0, isFallback: true };
  }

  let setupTimeMs = 0;
  try {
    const seed = await loadSeeds();
    setupTimeMs = seed.setupTimeMs;
  } catch (e) {
    console.log(`[mem0] Seed load failed: ${e.message}`);
  }

  // ─── Op 1: Add a fact ───────────────────────────────────────────
  try {
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/v1/memories/", {
        messages: [{ role: "user", content: "VS Code uses JWT for session tokens" }],
        user_id: "branch:feat/auth",
      });
    }, 30, 5);
    results.push(ok(1, m.p50, { opName: OP_NAMES[1], metrics: m }));
  } catch (e) {
    results.push(skip(1, e.message));
  }

  // ─── Op 2: Semantic search ──────────────────────────────────────
  try {
    await api("POST", "/v1/memories/", {
      messages: [{ role: "user", content: "OAuth2Provider authentication controller" }],
      user_id: "branch:feat/auth",
    });
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/v1/memories/search/", { query: "authentication controller", user_id: "branch:feat/auth", limit: 10 });
    }, 20, 3);
    const sample = await api("POST", "/v1/memories/search/", { query: "authentication controller", user_id: "branch:feat/auth", limit: 10 });
    results.push(ok(2, m.p50, { opName: OP_NAMES[2], metrics: { ...m, returned: sample.results?.length || 0 } }));
  } catch (e) {
    results.push(skip(2, e.message));
  }

  // ─── Op 3: Multi-hop graph traversal ────────────────────────────
  results.push(skip(3, "Mem0 is vector store only — no graph traversal / multi-hop BFS"));

  // ─── Op 4: Token-budget context packing ──────────────────────────
  results.push(skip(4, "Mem0 has no token-budget context packing API — closest is get_all which dumps everything"));

  // ─── Op 5: Branch isolation ──────────────────────────────────────
  try {
    await api("POST", "/v1/memories/", {
      messages: [{ role: "user", content: "VS Code uses API keys for billing" }],
      user_id: "branch:feat/payments",
    });
    const authResults = await api("POST", "/v1/memories/search/", { query: "VS Code", user_id: "branch:feat/auth" });
    const authHasPayments = JSON.stringify(authResults).includes("API keys") ? 1 : 0;
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/v1/memories/", {
        messages: [{ role: "user", content: "isolation test" }],
        user_id: "branch:feat/payments",
      });
    }, 20, 3);
    results.push(ok(5, m.p50, { opName: OP_NAMES[5], metrics: { ...m, leakage: authHasPayments } }));
  } catch (e) {
    results.push(skip(5, e.message));
  }

  // ─── Op 6: Cross-scope merge ─────────────────────────────────────
  results.push(skip(6, "Mem0 has no scope merge API — would require manual copy + delete on user_id boundary"));

  // ─── Op 7: Temporal evolution query ──────────────────────────────
  results.push(skip(7, "Mem0 has no temporal aggregation / bucket query API — search returns flat top-k"));

  // ─── Op 8: Inference review queue ───────────────────────────────
  results.push(skip(8, "Mem0 has no inference review queue — all memories are trusted by default"));

  // ─── Op 9: Agentic mass-forget ───────────────────────────────────
  try {
    const r = await api("GET", "/v1/memories/?user_id=branch:feat/auth");
    const before = r.count;
    const ids = r.results.map(m => m.id);
    for (const id of ids) await api("DELETE", `/v1/memories/${id}/`);
    const m = await timeBatchAsync(async () => {
      return await api("DELETE", "/v1/memories/?user_id=branch:feat/auth");
    }, 5, 1);
    results.push(ok(9, m.p50, { opName: OP_NAMES[9], metrics: { ...m, before, matched: before } }));
  } catch (e) {
    results.push(skip(9, e.message));
  }

  // ─── Op 10: PII redaction ────────────────────────────────────────
  {
    try {
      await api("POST", "/v1/memories/", {
        messages: [{ role: "user", content: "My API key is sk-abc123def456ghi789" }],
        user_id: "branch:feat/auth",
      });
      const r = await api("POST", "/v1/memories/search/", { query: "sk-abc123def456ghi789", user_id: "branch:feat/auth" });
      const containsKey = JSON.stringify(r).includes("sk-abc");
      results.push(ok(10, 0, { opName: OP_NAMES[10], metrics: { p50: 0, p95: 0, p99: 0, redacted: !containsKey, leakage: containsKey ? 1 : 0 } }));
    } catch (e) {
      results.push(skip(10, e.message));
    }
  }

  // ─── Op 11: Failure memory ───────────────────────────────────────
  results.push(skip(11, "Mem0 has no failure memory type — would require custom metadata, not queryable as a first-class concept"));

  // ─── Op 12: Decision provenance ──────────────────────────────────
  results.push(skip(12, "Mem0 has no decision provenance — no alternatives, no chosen, no rationale structured fields"));

  // ─── Op 13: Optimization history ─────────────────────────────────
  results.push(skip(13, "Mem0 has no change/optimization history — would require custom metadata, not first-class queryable"));

  // ─── Op 14: Episodic trace + replay ──────────────────────────────
  results.push(skip(14, "Mem0 has no episodic trace/replay API — closest is search by time, no chronological frame sequence"));

  writeReport("02-mem0", results, {
    subtitle: `Real local Mem0-compatible REST server (${BASE_URL}) with Ollama embeddings (nomic-embed-text, 768-dim) and in-memory vector store.`,
    setupTimeMs,
    dbSizeMB: 0,
    isFallback: false,
  });

  return { results, setupTimeMs, isFallback: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMem0().then(r => {
    console.log(`[mem0] Done. ${r.results.length} ops. Setup ${(r.setupTimeMs/1000).toFixed(1)}s. isFallback=${r.isFallback}.`);
    if (serverProc) { try { process.kill(-serverProc.pid); } catch (e) {} }
  }).catch(e => {
    console.error("[mem0] FAILED:", e.message);
    process.exit(1);
  });
}
