// paper/scripts/statistical-trials.js — N=5 trials for AlekhDB + Supermemory with CI computation.
//
// Reports mean ± stddev and 95% CI for each operation per backend.
// Used for the paper to demonstrate statistical significance.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const REPORTS_DIR = path.join(ROOT, "paper/data");
const N_TRIALS = 5;

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function clearServers() {
  try { execSync("pkill -f 'mem0-local-server|supermemory-server|zep-graphiti-server|letta-server' 2>/dev/null"); } catch (e) {}
}

function runOnce() {
  clearServers();
  // Clean reports
  for (const f of ["01-alekhdb.md", "02-mem0.md", "03-supermemory.md", "04-zep-graphiti.md", "05-letta.md", "metrics.json"]) {
    try { fs.unlinkSync(path.join(ROOT, `benchmarks/01-ide-monorepo/reports/${f}`)); } catch (e) {}
  }
  try {
    execSync(`node ${path.join(ROOT, "benchmarks/01-ide-monorepo/runner/run-all.js")}`, {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 30 * 60 * 1000,
    });
  } catch (e) {
    console.error("run-all failed:", e.message.slice(0, 200));
  }
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "benchmarks/01-ide-monorepo/reports/metrics.json"), "utf8"));
  } catch (e) {
    return null;
  }
}

console.log(`Running ${N_TRIALS} trials...\n`);
const trials = [];
for (let i = 0; i < N_TRIALS; i++) {
  console.log(`=== Trial ${i + 1}/${N_TRIALS} ===`);
  const t0 = Date.now();
  const result = runOnce();
  const elapsed = (Date.now() - t0) / 1000;
  if (result) {
    trials.push(result);
    console.log(`  Done in ${elapsed.toFixed(1)}s`);
  } else {
    console.log(`  Failed`);
  }
}

clearServers();

// Compute statistics
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}
function ci95(arr) {
  // Simple z=1.96 approximation
  if (arr.length < 2) return 0;
  return 1.96 * stddev(arr) / Math.sqrt(arr.length);
}

const stats = {};
for (const backendId of Object.keys(trials[0] || {})) {
  stats[backendId] = {};
  const opSet = new Set();
  for (const trial of trials) {
    for (const r of (trial[backendId]?.results || [])) opSet.add(r.op);
  }
  for (const op of [...opSet].sort((a, b) => a - b)) {
    const samples = [];
    for (const trial of trials) {
      const r = (trial[backendId]?.results || []).find(x => x.op === op);
      if (r && r.status === "OK" && r.metrics?.p50) {
        samples.push(r.metrics.p50);
      }
    }
    if (samples.length === 0) {
      stats[backendId][op] = { status: "SKIP" };
    } else {
      stats[backendId][op] = {
        status: "OK",
        n: samples.length,
        mean: +mean(samples).toFixed(4),
        stddev: +stddev(samples).toFixed(4),
        ci95: +ci95(samples).toFixed(4),
        min: +Math.min(...samples).toFixed(4),
        max: +Math.max(...samples).toFixed(4),
      };
    }
  }
}

const output = {
  nTrials: N_TRIALS,
  generatedAt: new Date().toISOString(),
  trials,
  stats,
};

fs.writeFileSync(path.join(REPORTS_DIR, "statistical-trials.json"), JSON.stringify(output, null, 2));
console.log(`\nSaved to ${path.join(REPORTS_DIR, "statistical-trials.json")}`);

// Print summary
console.log("\n=== AlekhDB statistical summary (p50 in ms) ===");
console.log("Op | n | mean | stddev | CI95 | min | max");
for (const [op, s] of Object.entries(stats["01-alekhdb"] || {})) {
  if (s.status === "OK") {
    console.log(`${op}  | ${s.n} | ${s.mean} | ${s.stddev} | ±${s.ci95} | ${s.min} | ${s.max}`);
  }
}
console.log("\n=== Supermemory statistical summary ===");
for (const [op, s] of Object.entries(stats["03-supermemory"] || {})) {
  if (s.status === "OK") {
    console.log(`${op}  | ${s.n} | ${s.mean} | ${s.stddev} | ±${s.ci95} | ${s.min} | ${s.max}`);
  }
}
