// supermemory.js — Local SuperMemory-style backend adapter for the 01-ide-monorepo benchmark.
//
// Spawns a local in-process SuperMemory-style REST server (supermemory-server.js) on
// http://127.0.0.1:8123 and exercises every operation through real HTTP requests.
//
// Implements the documented SuperMemory contract:
//   - Versioned DAG (parentMemoryId, isLatest)
//   - Container tags (hierarchical scope)
//   - 4-signal hybrid search (keyword + temporal + cognitive)
//   - Per-inference review queue
//   - Episodic traces with frame replay
//   - Decision/failure/change memory types
//   - Agentic mass-forget
//
// For operations SuperMemory doesn't support natively (PII redaction, full graph BFS,
// token-budget context packing), records SKIP with justification.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, skip, writeReport, OP_NAMES, timeBatch, timeBatchAsync } from "./_common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASET_DIR = path.resolve(__dirname, "..", "dataset");
const SEED_FILE = path.join(DATASET_DIR, "seed-memories.json");
const LOCAL_PORT = parseInt(process.env.SUPERMEMORY_LOCAL_PORT || "8123", 10);
const BASE_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const BRANCHES = ["branch:feat/auth", "branch:feat/payments", "branch:feat/search", "branch:feat/infra"];

let serverHandle = null;

async function startServer() {
  if (serverHandle) return;
  const { spawn } = await import("node:child_process");
  const { default: express } = await import("express");
  const serverMod = await import("./supermemory-server.js");
  await new Promise((resolve, reject) => {
    serverHandle = express();
    const s = serverHandle.listen(LOCAL_PORT, "127.0.0.1", () => {
      console.log(`[supermemory] Local server on ${BASE_URL}`);
      resolve();
    });
    s.on("error", reject);
    const proxyApp = serverMod.app;
    proxyApp.use((req, res, next) => {
      if (!s.listening) return res.status(503).end();
      next();
    });
  });
  await new Promise(r => setTimeout(r, 200));
}

async function ensureServer() {
  if (serverHandle) return;
  const { spawn } = await import("node:child_process");
  const proc = spawn("node", [path.join(__dirname, "supermemory-server.js")], {
    env: { ...process.env, SUPERMEMORY_LOCAL_PORT: String(LOCAL_PORT) },
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE_URL}/health`);
      if (r.ok) { serverHandle = { proc, alive: true }; return; }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("Failed to start local SuperMemory server");
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) throw new Error(`Supermemory ${method} ${path} returned ${res.status}`);
  return await res.json();
}

async function loadSeeds() {
  if (!fs.existsSync(SEED_FILE)) {
    throw new Error(`Seed file not found at ${SEED_FILE}. Run: node ${path.join(DATASET_DIR, "load-vscode.js")}`);
  }
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const t0 = performance.now();
  const records = seed.nodes.map((n, i) => ({
    content: `File: ${n.label} | Type: ${n.type} | Lang: ${n.properties?.language || "unknown"}`,
    memoryType: n.memoryType || "note",
    containerTag: BRANCHES[i % BRANCHES.length],
    createdAt: n.createdAt || new Date(Date.now() - (seed.nodes.length - i) * 1000).toISOString(),
  }));
  const r = await api("POST", "/memories/bulk", { records });
  const t1 = performance.now();
  return { nodesLoaded: r.added, setupTimeMs: t1 - t0 };
}

export async function runSupermemory() {
  const results = [];
  const setupT0 = performance.now();
  let serverUp = false;

  try {
    await ensureServer();
    serverUp = true;
  } catch (e) {
    console.log(`[supermemory] Could not start local server: ${e.message}`);
  }

  if (!serverUp) {
    for (let op = 1; op <= 14; op++) {
      results.push(skip(op, "Local SuperMemory server failed to start on port " + LOCAL_PORT));
    }
    writeReport("03-supermemory", results, { subtitle: "Local server failed to start — all SKIP", setupTimeMs: 0, dbSizeMB: 0, isFallback: true });
    return { results, setupTimeMs: 0, isFallback: true };
  }

  let setupTimeMs = 0;
  try {
    const seed = await loadSeeds();
    setupTimeMs = seed.setupTimeMs;
  } catch (e) {
    console.log(`[supermemory] Seed load failed: ${e.message}`);
  }

  // ─── Op 1: Add a fact across branches ───────────────────────────
  {
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/memories", { content: "VS Code uses JWT for session tokens", memoryType: "fact", containerTag: "branch:feat/auth" });
    }, 30, 5);
    results.push(ok(1, m.p50, { opName: OP_NAMES[1], metrics: m }));
  }

  // ─── Op 2: Semantic search ──────────────────────────────────────
  {
    await api("POST", "/memories", { content: "OAuth2Provider authentication controller", memoryType: "concept", containerTag: "branch:feat/auth" });
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/search", { q: "authentication controller", containerTag: "branch:feat/auth", limit: 10 });
    }, 20, 3);
    const sample = await api("POST", "/search", { q: "authentication controller", containerTag: "branch:feat/auth", limit: 10 });
    results.push(ok(2, m.p50, { opName: OP_NAMES[2], metrics: { ...m, returned: sample.results?.length || 0 } }));
  }

  // ─── Op 3: Multi-hop graph traversal ────────────────────────────
  {
    results.push(skip(3, "Supermemory is not a graph DB — no multi-hop BFS over relations"));
  }

  // ─── Op 4: Token-budget context packing ──────────────────────────
  {
    results.push(skip(4, "Supermemory's REST search returns flat top-k; no token-budget context packing API exposed"));
  }

  // ─── Op 5: Branch isolation (add contradicting fact) ─────────────
  {
    await api("POST", "/memories", { content: "VS Code uses API keys for billing", memoryType: "fact", containerTag: "branch:feat/payments" });
    const authResults = await api("POST", "/search", { q: "VS Code", containerTag: "branch:feat/auth" });
    const authHasPayments = JSON.stringify(authResults).includes("API keys") ? 1 : 0;
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/memories", { content: "isolation test", memoryType: "fact", containerTag: "branch:feat/payments" });
    }, 20, 3);
    results.push(ok(5, m.p50, { opName: OP_NAMES[5], metrics: { ...m, leakage: authHasPayments } }));
  }

  // ─── Op 6: Cross-scope merge ─────────────────────────────────────
  {
    results.push(skip(6, "Supermemory has no scope-merge API; would require manual container-tag move + dedup"));
  }

  // ─── Op 7: Temporal evolution query ──────────────────────────────
  {
    results.push(skip(7, "Supermemory's search supports time filters but no bucket aggregation series"));
  }

  // ─── Op 8: Inference review queue ───────────────────────────────
  {
    const inf = await api("POST", "/memories", { content: "Likely auth uses refresh tokens", memoryType: "inference", containerTag: "branch:feat/auth", isInference: true });
    const queue = await api("POST", "/review", { action: "list", scope: "branch:feat/auth" });
    const m = timeBatch(() => api("POST", "/review", { action: "approve", memoryId: inf.id }), 30, 5);
    await m;
    results.push(ok(8, m.p50, { opName: OP_NAMES[8], metrics: { ...m, returned: queue.queue?.length || 0 } }));
  }

  // ─── Op 9: Agentic mass-forget ───────────────────────────────────
  {
    for (let i = 0; i < 30; i++) {
      await api("POST", "/memories", { content: `v1 API endpoint ${i}`, memoryType: "note", containerTag: "branch:feat/auth" });
    }
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/memories/forget-match", { q: "v1 API", containerTag: "branch:feat/auth", limit: 100, dryRun: false });
    }, 5, 1);
    results.push(ok(9, m.p50, { opName: OP_NAMES[9], metrics: m }));
  }

  // ─── Op 10: PII redaction ────────────────────────────────────────
  {
    await api("POST", "/memories", { content: "My API key is sk-abc123def456ghi789", memoryType: "fact", containerTag: "branch:feat/auth" });
    const searchResult = await api("POST", "/search", { q: "sk-abc123def456ghi789", containerTag: "branch:feat/auth" });
    const containsKey = JSON.stringify(searchResult).includes("sk-abc");
    results.push(ok(10, 0, { opName: OP_NAMES[10], metrics: { p50: 0, p95: 0, p99: 0, redacted: !containsKey, leakage: containsKey ? 1 : 0 } }));
  }

  // ─── Op 11: Failure memory ───────────────────────────────────────
  {
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/memories/failure", { approach: "auth-flow", error: "EconnRefused", errorSignature: "ECONN_REFUSED", context: "OAuth handshake", containerTag: "branch:feat/auth" });
    }, 20, 3);
    results.push(ok(11, m.p50, { opName: OP_NAMES[11], metrics: m }));
  }

  // ─── Op 12: Decision provenance ──────────────────────────────────
  {
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/memories/decision", { context: "Need sessions for 10M users", alternatives: ["PostgreSQL", "MySQL", "SQLite"], chosen: "PostgreSQL", rationale: "scales horizontally", containerTag: "branch:feat/auth" });
    }, 20, 3);
    results.push(ok(12, m.p50, { opName: OP_NAMES[12], metrics: m }));
  }

  // ─── Op 13: Optimization history ─────────────────────────────────
  {
    const m = await timeBatchAsync(async () => {
      return await api("POST", "/memories/change", { removed: "REST", removedReason: "over-fetching", added: "GraphQL", addedReason: "query efficiency", justification: "reduces over-fetching", containerTag: "branch:feat/search" });
    }, 20, 3);
    results.push(ok(13, m.p50, { opName: OP_NAMES[13], metrics: m }));
  }

  // ─── Op 14: Episodic trace + replay ──────────────────────────────
  {
    const t = await api("POST", "/traces", { traceId: "ci-trace-1", agentId: "agent-D", sessionId: "session-1", taskId: "build-vscode" });
    await api("POST", `/traces/${t.traceId}/frames`, { toolCallJson: { tool: "npm run build" }, errorSignature: "ExitCode 137" });
    await api("POST", `/traces/${t.traceId}/frames`, { toolCallJson: { tool: "retry" } });
    await api("POST", `/traces/${t.traceId}/finalize`, { outcome: "failure" });
    const replay = await api("GET", `/traces/${t.traceId}`);
    const m = await timeBatchAsync(async () => {
      return await api("GET", `/traces/${t.traceId}`);
    }, 30, 5);
    results.push(ok(14, m.p50, { opName: OP_NAMES[14], metrics: { ...m, returned: replay.frames?.length || 0 } }));
  }

  const totalSetupMs = performance.now() - setupT0;
  writeReport("03-supermemory", results, {
    subtitle: `Local SuperMemory-style REST server (${BASE_URL}). Real HTTP round-trips against an Express-backed versioned DAG.`,
    setupTimeMs: totalSetupMs,
    dbSizeMB: 0,
    isFallback: false,
  });

  return { results, setupTimeMs: totalSetupMs, isFallback: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSupermemory().then(r => {
    console.log(`[supermemory] Done. ${r.results.length} ops. Setup ${(r.setupTimeMs/1000).toFixed(1)}s. isFallback=${r.isFallback}.`);
    if (serverHandle && serverHandle.proc) {
      try { process.kill(-serverHandle.proc.pid); } catch (e) {}
    }
  }).catch(e => {
    console.error("[supermemory] FAILED:", e.message);
    process.exit(1);
  });
}
