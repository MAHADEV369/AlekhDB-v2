// _common.js — Shared timing, metrics, and correctness helpers for all backend adapters.
//
// Used by alekhdb.js, mem0.js, supermemory.js. Provides:
//   - time(fn) — wraps an op, returns {latencyMs, result}
//   - timeBatch(fn, n) — runs N times, returns p50/p95/p99
//   - measureMemory(fn) — heap delta before/after
//   - verifyCorrectness(op, expected, actual) — recall/precision
//   - writeReport(backendName, metrics) — appends to reports/0X-backend-report.md
//   - skip(op, reason) — record a SKIP with justification

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORTS_DIR = path.resolve(__dirname, "..", "reports");

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function time(fn) {
  const t0 = performance.now();
  const result = fn();
  const t1 = performance.now();
  return { latencyMs: t1 - t0, result };
}

export async function timeAsync(fn) {
  const t0 = performance.now();
  const result = await fn();
  const t1 = performance.now();
  return { latencyMs: t1 - t0, result };
}

export async function timeBatchAsync(fn, n = 1000, warmup = 50) {
  for (let i = 0; i < warmup; i++) await fn();
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    const t1 = performance.now();
    samples.push(t1 - t0);
  }
  return {
    p50: +pct(samples, 50).toFixed(4),
    p95: +pct(samples, 95).toFixed(4),
    p99: +pct(samples, 99).toFixed(4),
    min: +Math.min(...samples).toFixed(4),
    max: +Math.max(...samples).toFixed(4),
    mean: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(4),
    samples: samples.length,
  };
}

export function timeBatch(fn, n = 1000, warmup = 50) {
  for (let i = 0; i < warmup; i++) fn();
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    const t1 = performance.now();
    samples.push(t1 - t0);
  }
  return {
    p50: +pct(samples, 50).toFixed(4),
    p95: +pct(samples, 95).toFixed(4),
    p99: +pct(samples, 99).toFixed(4),
    min: +Math.min(...samples).toFixed(4),
    max: +Math.max(...samples).toFixed(4),
    mean: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(4),
    samples: samples.length,
  };
}

export function measureMemory(fn) {
  if (global.gc) global.gc();
  const before = process.memoryUsage();
  const result = fn();
  const after = process.memoryUsage();
  return {
    result,
    heapDeltaMB: +((after.heapUsed - before.heapUsed) / (1024 * 1024)).toFixed(3),
    rssDeltaMB: +((after.rss - before.rss) / (1024 * 1024)).toFixed(3),
  };
}

export function verifyCorrectness(expectedIds, actualIds, k = 5) {
  const topK = actualIds.slice(0, k);
  const hits = topK.filter(id => expectedIds.includes(id));
  const recall = expectedIds.length === 0 ? 0 : hits.length / Math.min(expectedIds.length, k);
  const precision = topK.length === 0 ? 0 : hits.length / topK.length;
  return {
    recall: +recall.toFixed(3),
    precision: +precision.toFixed(3),
    hits: hits.length,
    expected: expectedIds.length,
    actualReturned: actualIds.length,
  };
}

export function skip(op, reason) {
  return { op, status: "SKIP", reason, latencyMs: 0, metrics: null };
}

export function ok(op, latencyMs, extras = {}) {
  return { op, status: "OK", latencyMs, ...extras };
}

export function writeReport(backendName, results, extras = {}) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportFile = path.join(REPORTS_DIR, `${backendName}.md`);
  const lines = [];
  lines.push(`# Backend Report — ${backendName}`);
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  if (extras.subtitle) lines.push(extras.subtitle);
  lines.push("");
  lines.push("## Per-operation results");
  lines.push("");
  lines.push("| # | Op | Status | p50 (ms) | p95 (ms) | p99 (ms) | Notes |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of results) {
    if (r.status === "SKIP") {
      lines.push(`| ${r.op} | ${r.opName} | SKIP | — | — | — | ${r.reason} |`);
    } else {
      const m = r.metrics || {};
      const notes = [];
      if (m.recall !== undefined) notes.push(`recall@5=${m.recall}`);
      if (m.precision !== undefined) notes.push(`precision@5=${m.precision}`);
      if (m.heapDeltaMB !== undefined) notes.push(`heap=${m.heapDeltaMB}MB`);
      if (m.leakage !== undefined) notes.push(`leakage=${m.leakage}`);
      if (m.redacted !== undefined) notes.push(`redacted=${m.redacted}`);
      if (m.returned !== undefined) notes.push(`returned=${m.returned}`);
      lines.push(`| ${r.op} | ${r.opName} | OK | ${m.p50 ?? r.latencyMs?.toFixed(4) ?? "?"} | ${m.p95 ?? "?"} | ${m.p99 ?? "?"} | ${notes.join(", ") || "—"} |`);
    }
  }
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  const okCount = results.filter(r => r.status === "OK").length;
  const skipCount = results.filter(r => r.status === "SKIP").length;
  lines.push(`- Operations executed: ${okCount} / ${results.length}`);
  lines.push(`- Operations skipped: ${skipCount} / ${results.length}`);
  if (extras.setupTimeMs !== undefined) {
    lines.push(`- Setup time: ${(extras.setupTimeMs / 1000).toFixed(2)}s`);
  }
  if (extras.dbSizeMB !== undefined) {
    lines.push(`- DB size on disk: ${extras.dbSizeMB.toFixed(2)} MB`);
  }
  lines.push("");
  fs.writeFileSync(reportFile, lines.join("\n") + "\n");

  const metricsFile = path.join(REPORTS_DIR, "metrics.json");
  let allMetrics = {};
  if (fs.existsSync(metricsFile)) {
    try { allMetrics = JSON.parse(fs.readFileSync(metricsFile, "utf8")); } catch (e) {}
  }
  allMetrics[backendName] = {
    results: results.map(r => ({
      op: r.op,
      opName: r.opName,
      status: r.status,
      reason: r.reason,
      metrics: r.metrics || null,
      latencyMs: r.latencyMs,
    })),
    extras,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(metricsFile, JSON.stringify(allMetrics, null, 2));
  return reportFile;
}

export const OP_NAMES = {
  1: "Add a fact across branches",
  2: "Semantic search",
  3: "Multi-hop graph traversal",
  4: "Token-budget context packing",
  5: "Branch isolation (add contradicting fact)",
  6: "Cross-scope merge",
  7: "Temporal evolution query",
  8: "Inference review queue",
  9: "Agentic mass-forget",
  10: "PII redaction",
  11: "Failure memory",
  12: "Decision provenance",
  13: "Optimization history",
  14: "Episodic trace + replay",
  15: "Add a knowledge principle",
  16: "Add a supersedes edge",
  17: "Unified knowledge search",
  18: "Pre-action conflict guard",
};
