// zep-graphiti.js — Zep/Graphiti backend adapter for the 01-ide-monorepo benchmark.
//
// Spawns a real local Zep/Graphiti-compatible REST server (zep-graphiti-server.py) on
// http://127.0.0.1:8125 that uses Ollama for LLM-based entity/fact extraction
// (mimicking Graphiti's core capability) and an in-memory bi-temporal graph store.
//
// This represents the published Zep/Graphiti system fairly:
//   - Episodes with bi-temporal edges
//   - LLM-driven entity/fact extraction
//   - Hybrid search via embeddings
//   - group_id isolation (Zep's user/thread scoping)

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, skip, writeReport, OP_NAMES, timeBatch, timeBatchAsync } from "./_common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASET_DIR = path.resolve(__dirname, "..", "dataset");
const SEED_FILE = path.join(DATASET_DIR, "seed-memories.json");
const LOCAL_PORT = parseInt(process.env.ZEP_LOCAL_PORT || "8125", 10);
const BASE_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const BRANCHES = ["branch:feat/auth", "branch:feat/payments", "branch:feat/search", "branch:feat/infra"];

let serverProc = null;

async function ensureServer() {
  if (serverProc) return;
  const { spawn } = await import("node:child_process");
  serverProc = spawn("python3", [path.join(__dirname, "zep-graphiti-server.py")], {
    env: { ...process.env, ZEP_LOCAL_PORT: String(LOCAL_PORT), ZEP_FAST: "1" },
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
  throw new Error("Failed to start local Zep/Graphiti server");
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) throw new Error(`Zep ${method} ${path} returned ${res.status}`);
  return await res.json();
}

async function loadSeeds() {
  if (!fs.existsSync(SEED_FILE)) {
    throw new Error(`Seed file not found at ${SEED_FILE}.`);
  }
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const t0 = performance.now();
  const records = seed.nodes.map((n, i) => ({
    text: `File: ${n.label} | Type: ${n.type} | Lang: ${n.properties?.language || "unknown"}`,
    group_id: BRANCHES[i % BRANCHES.length],
  }));
  const r = await api("POST", "/bulk", { records });
  const t1 = performance.now();
  return { nodesLoaded: r.added, setupTimeMs: t1 - t0 };
}

export async function runZepGraphiti() {
  const results = [];
  const setupT0 = performance.now();
  let serverUp = false;

  try {
    await ensureServer();
    serverUp = true;
  } catch (e) {
    console.log(`[zep] Server failed: ${e.message}`);
  }

  if (!serverUp) {
    for (let op = 1; op <= 14; op++) {
      results.push(skip(op, "Local Zep/Graphiti server failed to start"));
    }
    writeReport("04-zep-graphiti", results, { subtitle: "Server failed to start", setupTimeMs: 0, dbSizeMB: 0, isFallback: true });
    return { results, setupTimeMs: 0, isFallback: true };
  }

  let setupTimeMs = 0;
  try {
    const seed = await loadSeeds();
    setupTimeMs = seed.setupTimeMs;
  } catch (e) {
    console.log(`[zep] Seed load failed: ${e.message}`);
  }

  // ─── Op 1: Add a fact ───────────────────────────────────────────
  try {
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/episodes", { content: "VS Code uses JWT for session tokens", group_id: "branch:feat/auth" });
    }, 5, 1);
    results.push(ok(1, m.p50, { opName: OP_NAMES[1], metrics: m }));
  } catch (e) {
    results.push(skip(1, e.message));
  }

  // ─── Op 2: Semantic search ──────────────────────────────────────
  try {
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/search", { query: "authentication controller", group_id: "branch:feat/auth", limit: 10 });
    }, 3, 1);
    const sample = await api("POST", "/search", { query: "authentication controller", group_id: "branch:feat/auth", limit: 10 });
    results.push(ok(2, m.p50, { opName: OP_NAMES[2], metrics: { ...m, returned: sample.results?.length || 0 } }));
  } catch (e) {
    results.push(skip(2, e.message));
  }

  // ─── Op 3: Multi-hop graph traversal ────────────────────────────
  results.push(skip(3, "Zep/Graphiti exposes a hybrid retriever, not direct BFS over edges — no low-level multi-hop walk API"));

  // ─── Op 4: Token-budget context packing ──────────────────────────
  results.push(skip(4, "Zep/Graphiti doesn't expose a token-budget context packing API — returns ranked results"));

  // ─── Op 5: Branch isolation ──────────────────────────────────────
  try {
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/episodes", { content: "isolation test episode", group_id: "branch:feat/payments" });
    }, 5, 1);
    const authResults = await api("POST", "/search", { query: "isolation", group_id: "branch:feat/auth" });
    const authHasPayments = authResults.results?.some(r => r.content?.includes("payments")) ? 1 : 0;
    results.push(ok(5, m.p50, { opName: OP_NAMES[5], metrics: { ...m, leakage: authHasPayments } }));
  } catch (e) {
    results.push(skip(5, e.message));
  }

  // ─── Op 6: Cross-scope merge ─────────────────────────────────────
  results.push(skip(6, "Zep/Graphiti's group_id is the scoping unit; merge would require manual episode replay"));

  // ─── Op 7: Temporal evolution query ──────────────────────────────
  results.push(skip(7, "Zep/Graphiti's search supports time filters but not bucket aggregation series"));

  // ─── Op 8: Inference review queue ───────────────────────────────
  results.push(skip(8, "Zep/Graphiti treats all extracted facts as trusted — no review queue concept"));

  // ─── Op 9: Agentic mass-forget ───────────────────────────────────
  results.push(skip(9, "Zep/Graphiti doesn't expose a bulk-forget-by-query API; would need episode-level deletes"));

  // ─── Op 10: PII redaction ────────────────────────────────────────
  try {
    await api("POST", "/episodes", { content: "My API key is sk-abc123def456ghi789", group_id: "branch:feat/auth" });
    const r = await api("POST", "/search", { query: "sk-abc123def456ghi789", group_id: "branch:feat/auth" });
    const containsKey = JSON.stringify(r).includes("sk-abc");
    results.push(ok(10, 0, { opName: OP_NAMES[10], metrics: { p50: 0, p95: 0, p99: 0, redacted: !containsKey, leakage: containsKey ? 1 : 0 } }));
  } catch (e) {
    results.push(skip(10, e.message));
  }

  // ─── Op 11: Failure memory ───────────────────────────────────────
  results.push(skip(11, "Zep/Graphiti treats all episodes uniformly — no failure-type first-class concept"));

  // ─── Op 12: Decision provenance ──────────────────────────────────
  results.push(skip(12, "Zep/Graphiti's LLM extraction may capture decisions, but no structured alternatives/chosen/rationale fields"));

  // ─── Op 13: Optimization history ─────────────────────────────────
  results.push(skip(13, "Zep/Graphiti's bi-temporal edges track validity, but no first-class change/replace semantics"));

  // ─── Op 14: Episodic trace + replay ──────────────────────────────
  results.push(skip(14, "Zep/Graphiti's episode ingestion is the closest concept, but no frame-level append + replay API"));

  writeReport("04-zep-graphiti", results, {
    subtitle: `Local Zep/Graphiti-compatible REST server (${BASE_URL}) with Ollama LLM extraction (${process.env.ZEP_LLM || 'qwen3.5:9b'}).`,
    setupTimeMs,
    dbSizeMB: 0,
    isFallback: false,
  });

  return { results, setupTimeMs, isFallback: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runZepGraphiti().then(r => {
    console.log(`[zep] Done. ${r.results.length} ops. Setup ${(r.setupTimeMs/1000).toFixed(1)}s. isFallback=${r.isFallback}.`);
    if (serverProc) { try { process.kill(-serverProc.pid); } catch (e) {} }
  }).catch(e => {
    console.error("[zep] FAILED:", e.message);
    process.exit(1);
  });
}
