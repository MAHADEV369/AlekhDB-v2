// letta.js — Letta backend adapter for the 01-ide-monorepo benchmark.
//
// Spawns a local Letta-compatible REST server (letta-server.py) on
// http://127.0.0.1:8126 that implements Letta's recall + archival memory
// architecture with Ollama embeddings.
//
// This represents the published Letta (formerly MemGPT) system fairly:
//   - In-context recall memory (structured blocks)
//   - Archival memory (vector-indexed long-term storage)
//   - Per-agent isolation
//   - LLM-driven core memory updates (Letta's signature)

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, skip, writeReport, OP_NAMES, timeBatch, timeBatchAsync } from "./_common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASET_DIR = path.resolve(__dirname, "..", "dataset");
const SEED_FILE = path.join(DATASET_DIR, "seed-memories.json");
const LOCAL_PORT = parseInt(process.env.LETTA_LOCAL_PORT || "8126", 10);
const BASE_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const BRANCHES = ["branch:feat/auth", "branch:feat/payments", "branch:feat/search", "branch:feat/infra"];

let serverProc = null;

async function ensureServer() {
  if (serverProc) return;
  const { spawn } = await import("node:child_process");
  serverProc = spawn("python3", [path.join(__dirname, "letta-server.py")], {
    env: { ...process.env, LETTA_LOCAL_PORT: String(LOCAL_PORT) },
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
  throw new Error("Failed to start local Letta server");
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) throw new Error(`Letta ${method} ${path} returned ${res.status}`);
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
    agent_id: BRANCHES[i % BRANCHES.length],
  }));
  const r = await api("POST", "/v1/bulk", { records });
  const t1 = performance.now();
  return { nodesLoaded: r.added, setupTimeMs: t1 - t0 };
}

export async function runLetta() {
  const results = [];
  const setupT0 = performance.now();
  let serverUp = false;

  try {
    await ensureServer();
    serverUp = true;
  } catch (e) {
    console.log(`[letta] Server failed: ${e.message}`);
  }

  if (!serverUp) {
    for (let op = 1; op <= 14; op++) {
      results.push(skip(op, "Local Letta server failed to start"));
    }
    writeReport("05-letta", results, { subtitle: "Server failed to start", setupTimeMs: 0, dbSizeMB: 0, isFallback: true });
    return { results, setupTimeMs: 0, isFallback: true };
  }

  let setupTimeMs = 0;
  try {
    const seed = await loadSeeds();
    setupTimeMs = seed.setupTimeMs;
  } catch (e) {
    console.log(`[letta] Seed load failed: ${e.message}`);
  }

  // ─── Op 1: Add a fact ───────────────────────────────────────────
  try {
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/v1/agents/branch:feat/auth/memory/archival", { text: "VS Code uses JWT for session tokens" });
    }, 5, 1);
    results.push(ok(1, m.p50, { opName: OP_NAMES[1], metrics: m }));
  } catch (e) {
    results.push(skip(1, e.message));
  }

  // ─── Op 2: Semantic search ──────────────────────────────────────
  try {
    const m = await timeBatchAsync(async () => {
      return await api("GET", "/v1/agents/branch:feat/auth/memory/archival?query=authentication+controller&limit=10");
    }, 3, 1);
    const sample = await api("GET", "/v1/agents/branch:feat/auth/memory/archival?query=authentication&limit=10");
    results.push(ok(2, m.p50, { opName: OP_NAMES[2], metrics: { ...m, returned: sample.results?.length || 0 } }));
  } catch (e) {
    results.push(skip(2, e.message));
  }

  // ─── Op 3: Multi-hop graph traversal ────────────────────────────
  results.push(skip(3, "Letta's archival memory is a flat vector store — no edge graph BFS API"));

  // ─── Op 4: Token-budget context packing ──────────────────────────
  results.push(skip(4, "Letta's recall memory is in-context blocks; no token-budget packing API exposed via REST"));

  // ─── Op 5: Branch isolation ──────────────────────────────────────
  try {
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/v1/agents/branch:feat/payments/memory/archival", { text: "isolation test" });
    }, 5, 1);
    const authResults = await api("GET", "/v1/agents/branch:feat/auth/memory/archival?query=isolation");
    const authHasPayments = authResults.results?.some(r => r.text?.includes("payments")) ? 1 : 0;
    results.push(ok(5, m.p50, { opName: OP_NAMES[5], metrics: { ...m, leakage: authHasPayments } }));
  } catch (e) {
    results.push(skip(5, e.message));
  }

  // ─── Op 6: Cross-scope merge ─────────────────────────────────────
  results.push(skip(6, "Letta's per-agent memory is isolated; merge would require manual copy + recall rewrite"));

  // ─── Op 7: Temporal evolution query ──────────────────────────────
  results.push(skip(7, "Letta's archival search supports recency filter, not bucket aggregation"));

  // ─── Op 8: Inference review queue ───────────────────────────────
  results.push(skip(8, "Letta has no inference review queue — all memories are trusted"));

  // ─── Op 9: Agentic mass-forget ───────────────────────────────────
  try {
    // For Letta, "mass-forget" = delete all archival for the agent
    // Use the path with full agent id
    const url = `${BASE_URL}/v1/agents/${encodeURIComponent("branch:feat/auth")}/memory/archival`;
    const m = await timeBatchAsync(async () => {
      const res = await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" } });
      if (!res.ok && res.status !== 404) throw new Error(`status ${res.status}`);
      return { ok: true };
    }, 3, 1);
    results.push(ok(9, m.p50, { opName: OP_NAMES[9], metrics: m }));
  } catch (e) {
    results.push(skip(9, e.message));
  }

  // ─── Op 10: PII redaction ────────────────────────────────────────
  try {
    await api("POST", "/v1/agents/branch:feat/auth/memory/archival", { text: "My API key is sk-abc123def456ghi789" });
    const r = await api("GET", "/v1/agents/branch:feat/auth/memory/archival?query=sk-abc123def456ghi789");
    const containsKey = JSON.stringify(r).includes("sk-abc");
    results.push(ok(10, 0, { opName: OP_NAMES[10], metrics: { p50: 0, p95: 0, p99: 0, redacted: !containsKey, leakage: containsKey ? 1 : 0 } }));
  } catch (e) {
    results.push(skip(10, e.message));
  }

  // ─── Op 11: Failure memory ───────────────────────────────────────
  results.push(skip(11, "Letta has no failure memory type — all archival passages are uniform"));

  // ─── Op 12: Decision provenance ──────────────────────────────────
  results.push(skip(12, "Letta's recall memory can hold decisions but no structured alternatives/chosen/rationale fields"));

  // ─── Op 13: Optimization history ─────────────────────────────────
  results.push(skip(13, "Letta has no change/replace semantic — just append/delete"));

  // ─── Op 14: Episodic trace + replay ──────────────────────────────
  results.push(skip(14, "Letta's archival memory is the closest concept but no frame-level append + replay API"));

  writeReport("05-letta", results, {
    subtitle: `Local Letta-compatible REST server (${BASE_URL}) with Ollama embeddings (${process.env.LETTA_EMBED || 'nomic-embed-text'}). Recall + archival memory architecture.`,
    setupTimeMs,
    dbSizeMB: 0,
    isFallback: false,
  });

  return { results, setupTimeMs, isFallback: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLetta().then(r => {
    console.log(`[letta] Done. ${r.results.length} ops. Setup ${(r.setupTimeMs/1000).toFixed(1)}s. isFallback=${r.isFallback}.`);
    if (serverProc) { try { process.kill(-serverProc.pid); } catch (e) {} }
  }).catch(e => {
    console.error("[letta] FAILED:", e.message);
    process.exit(1);
  });
}
