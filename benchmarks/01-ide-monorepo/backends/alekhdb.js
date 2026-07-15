// alekhdb.js — AlekhDB backend adapter for the 01-ide-monorepo benchmark.
//
// Exercises every Phase 1-8 feature:
//   - addNode / searchHybrid / multi-hop search
//   - getContext (token-aware context packing from alekhdb-context.js)
//   - git branch scope (alekhdb-git.js)
//   - mergeScopes
//   - getEvolution (temporal query)
//   - addDecision / addFailure / addChange
//   - review queue (inferred memory management)
//   - forgetMatch (agentic mass-forget)
//   - privacy module (PII redaction before storage)
//   - startTrace / appendEventFrame / finalizeTrace / replayTrace
//   - enableEmbeddings (local MiniLM) for semantic search
//
// All operations are timed using _common.js helpers. After running all 14 ops,
// the adapter writes reports/01-alekhdb-report.md and updates reports/metrics.json.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AlekhDB } from "../../../alekhdb.js";
import { time, timeAsync, timeBatch, timeBatchAsync, measureMemory, verifyCorrectness, skip, ok, writeReport, OP_NAMES } from "./_common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASET_DIR = path.resolve(__dirname, "..", "dataset");
const SEED_FILE = path.join(DATASET_DIR, "seed-memories.json");
const ALEKHDB_TMP = path.resolve(__dirname, "..", "tmp", "alekhdb_db.json");

const BRANCHES = ["branch:feat/auth", "branch:feat/payments", "branch:feat/search", "branch:feat/infra"];

async function loadSeeds(db) {
  if (!fs.existsSync(SEED_FILE)) {
    throw new Error(`Seed file not found at ${SEED_FILE}. Run: node ${path.join(DATASET_DIR, "load-vscode.js")}`);
  }
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
  const t0 = performance.now();
  const now = new Date().toISOString();
  for (const n of seed.nodes) {
    const node = {
      id: n.id, label: n.label, type: n.type, memoryType: n.memoryType || "note",
      version: 1, parentMemoryId: null, rootMemoryId: null,
      isLatest: true, isForgotten: false, forgetAfter: null,
      isInference: false, reviewStatus: null,
      properties: { ...(n.properties || {}), cognitiveStrength: 1.0, lastAccessedAt: now },
      scope: "branch:feat/auth", createdAt: now, updatedAt: now, metadata: {},
    };
    db.nodes.push(node);
    db.nodeMap.set(node.id, node);
  }
  for (const e of seed.edges) {
    const edge = { id: e.id, source: e.source, target: e.target, label: e.label, weight: e.weight || 1.0, active: e.active !== false, properties: e.properties || {}, createdAt: now, updatedAt: now };
    db.edges.push(edge);
    db.edgeMap.set(edge.id, edge);
    if (edge.active) {
      if (!db.adjacency.has(edge.source)) db.adjacency.set(edge.source, []);
      if (!db.adjacency.has(edge.target)) db.adjacency.set(edge.target, []);
      db.adjacency.get(edge.source).push({ edge, neighborId: edge.target });
      db.adjacency.get(edge.target).push({ edge, neighborId: edge.source });
    }
  }
  db._rebuildInvertedIndex();
  db._flushSave();
  const t1 = performance.now();
  return { nodesLoaded: seed.nodes.length, edgesLoaded: seed.edges.length, setupTimeMs: t1 - t0 };
}

export async function runAlekhdb() {
  const setupT0 = performance.now();
  if (!fs.existsSync(path.dirname(ALEKHDB_TMP))) fs.mkdirSync(path.dirname(ALEKHDB_TMP), { recursive: true });
  if (fs.existsSync(ALEKHDB_TMP)) fs.unlinkSync(ALEKHDB_TMP);
  const db = new AlekhDB(true);
  db.dbPath = ALEKHDB_TMP;
  db.autoSave = false;
  db.currentScope = "branch:feat/auth";

  const seed = await loadSeeds(db);
  const setupTimeMs = performance.now() - setupT0;
  const results = [];
  const memUsageBefore = process.memoryUsage();

  const safeOp = (opNum, opName, fn) => {
    try {
      fn();
    } catch (e) {
      results.push(skip(opNum, `Op ${opNum} (${opName}) failed: ${e.message}`));
    }
  };

  // ─── Op 1: Add a fact across branches ───────────────────────────
  {
    const factId = "fact-jwt-tokens";
    db.setScope("branch:feat/auth");
    const m = timeBatch(() => db.addNode(factId, "VS Code uses JWT for session tokens", "fact", { source: "agent-A" }, "branch:feat/auth", { memoryType: "fact" }), 100, 20);
    results.push(ok(1, m.p50, { opName: OP_NAMES[1], metrics: m }));
  }

  // ─── Op 2: Semantic search (real nodes that should match) ───────────
  {
    db.addNode("oauth-test", "OAuth2Provider", "class", { description: "Authentication provider handling sign-in flow" }, "branch:feat/auth", { memoryType: "concept" });
    db.addNode("auth-test", "AuthenticationService", "class", { description: "Validates user credentials and tokens" }, "branch:feat/auth", { memoryType: "concept" });
    db.addNode("db-test", "PostgresAdapter", "class", { description: "Database connection layer" }, "branch:feat/auth", { memoryType: "concept" });
    db._flushSave();
    const queries = [
      { q: "authentication controller", expected: ["oauth-test", "auth-test"] },
      { q: "user login credentials", expected: ["auth-test", "oauth-test"] },
      { q: "database adapter", expected: ["db-test"] },
    ];
    const expectedFlat = Array.from(new Set(queries.flatMap(q => q.expected)));
    const m = await timeBatchAsync(async () => {
      const r = await db.search("authentication controller", "branch:feat/auth");
      return r.matchedNodeIds;
    }, 50, 10);
    const allSampleHits = [];
    for (const { q, expected } of queries) {
      const r = await db.search(q, "branch:feat/auth");
      allSampleHits.push({ q, expected, returned: r.matchedNodeIds });
    }
    const totalHits = allSampleHits.reduce((acc, h) => acc + h.expected.filter(e => h.returned.includes(e)).length, 0);
    const totalExpected = allSampleHits.reduce((acc, h) => acc + h.expected.length, 0);
    const recall = totalExpected > 0 ? totalHits / totalExpected : 0;
    const totalReturned = allSampleHits.reduce((acc, h) => acc + h.returned.length, 0);
    results.push(ok(2, m.p50, { opName: OP_NAMES[2], metrics: { ...m, recall: +recall.toFixed(3), totalHits, totalExpected, returned: totalReturned } }));
  }

  // ─── Op 3: Multi-hop graph traversal ────────────────────────────
  {
    db.addNode("a", "Alpha", "concept", {}, "branch:feat/auth");
    db.addNode("b", "Beta", "concept", {}, "branch:feat/auth");
    db.addNode("c", "Gamma", "concept", {}, "branch:feat/auth");
    db.addNode("d", "Delta", "concept", {}, "branch:feat/auth");
    db.addNode("e", "Epsilon", "concept", {}, "branch:feat/auth");
    db.addEdge("e1", "a", "b", "calls", 1.0, true);
    db.addEdge("e2", "b", "c", "calls", 1.0, true);
    db.addEdge("e3", "c", "d", "calls", 1.0, true);
    db.addEdge("e4", "d", "e", "calls", 1.0, true);
    const m = await timeBatchAsync(async () => {
      const r = await db.search("Alpha", "branch:feat/auth", { maxDepth: 5 });
      return r.traversedNodeIds;
    }, 50, 10);
    const sampleRun = await db.search("Alpha", "branch:feat/auth", { maxDepth: 5 });
    results.push(ok(3, m.p50, { opName: OP_NAMES[3], metrics: { ...m, returned: sampleRun.traversedNodeIds.length } }));
  }

  // ─── Op 4: Token-budget context packing ──────────────────────────
  {
    let ctxResult = null;
    let m;
    try {
      const ctxMod = await import("../../../alekhdb-context.js");
      m = await timeBatchAsync(async () => {
        return await ctxMod.getContext(db, { query: "auth", maxTokens: 8000, scope: "branch:feat/auth" });
      }, 50, 5);
      ctxResult = await ctxMod.getContext(db, { query: "auth", maxTokens: 8000, scope: "branch:feat/auth" });
    } catch (e) {
      results.push(skip(4, "alekhdb-context.js not available: " + e.message));
    }
    if (ctxResult) {
      results.push(ok(4, m.p50, { opName: OP_NAMES[4], metrics: { ...m, returned: ctxResult.results?.length || 0 } }));
    }
  }

  // ─── Op 5: Branch isolation (add contradicting fact) ─────────────
  {
    db.setScope("branch:feat/payments");
    db.addNode("fact-api-keys", "VS Code uses API keys for billing", "fact", { source: "agent-B" }, "branch:feat/payments", { memoryType: "fact" });
    const authResults = await db.search("VS Code", "branch:feat/auth");
    const paymentsResults = await db.search("VS Code", "branch:feat/payments");
    const leakage = authResults.matchedNodeIds.includes("fact-api-keys") ? 1 : 0;
    const m = timeBatch(() => db.addNode("bench-5-isolated", "isolation test", "fact", {}, "branch:feat/payments", { memoryType: "fact" }), 100, 20);
    results.push(ok(5, m.p50, { opName: OP_NAMES[5], metrics: { ...m, leakage } }));
  }

  // ─── Op 6: Cross-scope merge ─────────────────────────────────────
  {
    const beforeCount = db.nodes.length;
    const m = timeBatch(() => db.mergeScopes("branch:feat/auth", "branch:feat/infra"), 50, 5);
    const afterCount = db.nodes.length;
    results.push(ok(6, m.p50, { opName: OP_NAMES[6], metrics: { ...m, returned: afterCount - beforeCount } }));
  }

  // ─── Op 7: Temporal evolution query ──────────────────────────────
  {
    let m;
    try {
      m = await timeBatchAsync(async () => {
        return await db.getEvolution({ since: new Date(Date.now() - 30 * 86400000).toISOString(), until: new Date().toISOString(), bucket: "week" });
      }, 50, 5);
      const sampleRun = await db.getEvolution({ since: new Date(Date.now() - 30 * 86400000).toISOString(), until: new Date().toISOString(), bucket: "week" });
      results.push(ok(7, m.p50, { opName: OP_NAMES[7], metrics: { ...m, returned: sampleRun.series?.length || 0 } }));
    } catch (e) {
      results.push(skip(7, "getEvolution failed: " + e.message));
    }
  }

  // ─── Op 8: Inference review queue ───────────────────────────────
  {
    try {
      db.setScope("branch:feat/auth");
      db.addNode("inf-1", "Likely auth uses refresh tokens", "inference", {}, "branch:feat/auth", { memoryType: "inference", isInference: true, reviewStatus: "unreviewed" });
      const queue = db.review.list();
      const m = time(() => db.review.approve("inf-1"));
      results.push(ok(8, m.latencyMs, { opName: OP_NAMES[8], metrics: { p50: m.latencyMs, p95: m.latencyMs, p99: m.latencyMs, min: m.latencyMs, max: m.latencyMs, returned: queue.length } }));
    } catch (e) {
      results.push(skip(8, "Inference review queue failed: " + e.message));
    }
  }

  // ─── Op 9: Agentic mass-forget ───────────────────────────────────
  {
    for (let i = 0; i < 50; i++) {
      db.addNode(`v1-api-${i}`, `v1 API endpoint ${i}`, "concept", {}, "branch:feat/auth", { memoryType: "note" });
    }
    db._flushSave();
    const m = await timeBatchAsync(async () => {
      return await db.forgetMatch({ query: "v1 API", scope: "branch:feat/auth", dryRun: false, limit: 100 });
    }, 20, 5);
    results.push(ok(9, m.p50, { opName: OP_NAMES[9], metrics: m }));
  }

  // ─── Op 10: PII redaction ────────────────────────────────────────
  {
    try {
      const privacy = await import("../../../alekhdb-privacy.js");
      await privacy.enablePrivacy(db);
      const beforeLog = (db.getPrivacyLog && db.getPrivacyLog().length) || 0;
      db.addNode("pii-test", "My API key is sk-abc123def456ghi789", "fact", {}, "branch:feat/auth", { memoryType: "fact" });
      const afterLog = (db.getPrivacyLog && db.getPrivacyLog()) || [];
      const newRedactions = afterLog.length - beforeLog;
      const node = db.getNode("pii-test");
      const storedLabel = node ? node.label : "";
      const searchResult = await db.search("sk-abc123def456ghi789", "branch:feat/auth");
      const containsKey = JSON.stringify(searchResult).includes("sk-abc") || storedLabel.includes("sk-abc");
      const m = timeBatch(() => db.addNode("pii-test-perf", "perf", "fact", {}, "branch:feat/auth", { memoryType: "fact" }), 50, 5);
      results.push(ok(10, m.p50, { opName: OP_NAMES[10], metrics: { ...m, redactions: newRedactions, redacted: newRedactions > 0 && !containsKey, storedLabelPreview: storedLabel.slice(0, 40) } }));
    } catch (e) {
      results.push(skip(10, "alekhdb-privacy.js not available: " + e.message));
    }
  }

  // ─── Op 11: Failure memory ───────────────────────────────────────
  {
    const failureId = "fail-econn-1";
    db.addFailure(failureId, { approach: "auth-flow", error: "EconnRefused", errorSignature: "ECONN_REFUSED", context: "OAuth handshake" });
    const m = await timeBatchAsync(async () => {
      const r = await db.search("ECONN_REFUSED", "branch:feat/auth");
      return r.matchedNodeIds;
    }, 50, 10);
    results.push(ok(11, m.p50, { opName: OP_NAMES[11], metrics: m }));
  }

  // ─── Op 12: Decision provenance ──────────────────────────────────
  {
    db.addDecision("dec-db-1", { context: "Need a session store", alternatives: ["PostgreSQL", "MySQL", "SQLite"], chosen: "PostgreSQL", rationale: "scales horizontally", scope: "branch:feat/auth" });
    const m = timeBatch(() => {
      db.addDecision("bench-dec", { alternatives: ["A", "B", "C"], chosen: "A", rationale: "test", scope: "branch:feat/auth" });
    }, 100, 20);
    results.push(ok(12, m.p50, { opName: OP_NAMES[12], metrics: m }));
  }

  // ─── Op 13: Optimization history ─────────────────────────────────
  {
    db.addChange("chg-rest", { removed: "REST", removedReason: "over-fetching", added: "GraphQL", addedReason: "query efficiency", justification: "reduces over-fetching", scope: "branch:feat/search" });
    const m = timeBatch(() => {
      db.addChange("bench-chg", { removed: "X", added: "Y", justification: "test", scope: "branch:feat/search" });
    }, 100, 20);
    results.push(ok(13, m.p50, { opName: OP_NAMES[13], metrics: m }));
  }

  // ─── Op 14: Episodic trace + replay ──────────────────────────────
  {
    const trace = db.startTrace("ci-trace-1", "agent-D", "session-1", "build-vscode");
    db.appendEventFrame("ci-trace-1", { toolCallJson: { tool: "npm run build" }, errorSignature: "ExitCode 137", toolResultJson: { exitCode: 137 } });
    db.appendEventFrame("ci-trace-1", { toolCallJson: { tool: "retry" }, errorSignature: "" });
    db.finalizeTrace("ci-trace-1", "failure", { reason: "OOM" });
    const replay = db.replayTrace("ci-trace-1");
    const m = timeBatch(() => db.replayTrace("ci-trace-1"), 100, 20);
    results.push(ok(14, m.p50, { opName: OP_NAMES[14], metrics: { ...m, returned: replay.frames.length } }));
  }

  // ─── Op 15: Add a knowledge principle (Experience Knowledge Graph) ──
  {
    const m = timeBatch(() => db.addPrinciple("princ-test", { rule: "Always use parameterized queries", domain: "security", importance: 5 }), 100, 20);
    results.push(ok(15, m.p50, { opName: "Add a knowledge principle", metrics: m }));
  }

  // ─── Op 16: Add a supersedes edge (multi-agent consistency) ──────────
  {
    db.addPrinciple("princ-old", { rule: "Use ORM for all DB", domain: "database", importance: 4 });
    db.addPrinciple("princ-new", { rule: "Use raw SQL with prepared statements", domain: "database", importance: 5 });
    db.addSupersedes("princ-new", "princ-old");
    const m = timeBatch(() => db.addSupersedes("princ-new2", "princ-old2", { reason: "policy update" }), 100, 20);
    results.push(ok(16, m.p50, { opName: "Add supersedes edge", metrics: m }));
  }

  // ─── Op 17: searchKnowledge (unified search across knowledge types) ──
  {
    const m = await timeBatchAsync(async () => {
      return db.searchKnowledge({ types: ["principle", "constraint"], scope: "branch:feat/auth", status: "active" });
    }, 50, 10);
    const sample = db.searchKnowledge({ types: ["principle", "constraint"], scope: "branch:feat/auth" });
    results.push(ok(17, m.p50, { opName: "Unified knowledge search", metrics: { ...m, returned: sample.length } }));
  }

  // ─── Op 18: checkConflict (pre-action guard for multi-agent safety) ─
  {
    const m = timeBatch(() => db.checkConflict({ type: "decision", data: { chosen: "MySQL", domain: "database" } }), 100, 20);
    const sample = db.checkConflict({ type: "decision", data: { chosen: "PostgreSQL", domain: "database" } });
    results.push(ok(18, m.p50, { opName: "Pre-action conflict guard", metrics: { ...m, returned: sample.length } }));
  }

  const memUsageAfter = process.memoryUsage();
  const heapDeltaMB = +((memUsageAfter.heapUsed - memUsageBefore.heapUsed) / (1024 * 1024)).toFixed(2);
  let dbSizeMB = 0;
  if (fs.existsSync(ALEKHDB_TMP)) {
    dbSizeMB = +(fs.statSync(ALEKHDB_TMP).size / (1024 * 1024)).toFixed(2);
  }

  writeReport("01-alekhdb", results, {
    subtitle: "Local-first, zero-dep, sub-ms core. Uses AlekhDB v2 with all Phase 1-8 features.",
    setupTimeMs: seed ? setupTimeMs : 0,
    dbSizeMB,
    heapDeltaMB,
  });

  return { results, setupTimeMs, dbSizeMB, heapDeltaMB };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAlekhdb().then(r => {
    console.log(`[alekhdb] Done. ${r.results.length} ops. Setup ${(r.setupTimeMs/1000).toFixed(1)}s. DB ${r.dbSizeMB}MB.`);
  }).catch(e => {
    console.error("[alekhdb] FAILED:", e.message);
    process.exit(1);
  });
}
