// paper/scripts/scaling-benchmark.js — Multi-size benchmark for scaling curves.
//
// Runs all 5 backends at 4 dataset sizes: 500, 2K, 5K, 10K files.
// Outputs a JSON with per-size per-backend results for plotting.

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const DATASET_DIR = path.join(ROOT, "benchmarks/01-ide-monorepo/dataset");
const SEED_FILE = path.join(DATASET_DIR, "seed-memories.json");
const REPORTS_DIR = path.join(ROOT, "paper/data");
const SIZES = [500, 2000, 5000, 10000];

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const results = { sizes: {}, generatedAt: new Date().toISOString() };

for (const size of SIZES) {
  console.log(`\n=== Generating seed for size=${size} ===`);
  execSync(`node ${path.join(DATASET_DIR, "load-vscode.js")}`, {
    cwd: ROOT,
    env: { ...process.env, BENCH_MAX_FILES: String(size) },
    stdio: "inherit",
  });
  console.log(`\n=== Running 5-way benchmark at size=${size} ===`);
  // Kill any leftover servers
  try { execSync("pkill -f 'mem0-local-server|supermemory-server|zep-graphiti-server|letta-server' 2>/dev/null"); } catch (e) {}
  await new Promise(r => setTimeout(r, 2000));
  // Clean reports
  for (const f of ["01-alekhdb.md", "02-mem0.md", "03-supermemory.md", "04-zep-graphiti.md", "05-letta.md", "metrics.json"]) {
    try { fs.unlinkSync(path.join(ROOT, `benchmarks/01-ide-monorepo/reports/${f}`)); } catch (e) {}
  }
  const t0 = Date.now();
  try {
    execSync(`node ${path.join(ROOT, "benchmarks/01-ide-monorepo/runner/run-all.js")}`, {
      cwd: ROOT,
      env: { ...process.env, BENCH_MAX_FILES: String(size) },
      stdio: "inherit",
      timeout: 30 * 60 * 1000,  // 30 min timeout
    });
  } catch (e) {
    console.error(`Benchmark failed at size ${size}:`, e.message.slice(0, 200));
  }
  const elapsed = (Date.now() - t0) / 1000;
  console.log(`Size ${size} took ${elapsed.toFixed(1)}s`);
  // Read the results
  try {
    const metrics = JSON.parse(fs.readFileSync(path.join(ROOT, "benchmarks/01-ide-monorepo/reports/metrics.json"), "utf8"));
    results.sizes[size] = { elapsedSec: elapsed, backends: metrics };
  } catch (e) {
    console.error(`Could not read metrics for size ${size}`);
    results.sizes[size] = { elapsedSec: elapsed, error: e.message };
  }
  // Save per-size report
  fs.writeFileSync(
    path.join(REPORTS_DIR, `scaling-${size}.json`),
    JSON.stringify(results.sizes[size], null, 2)
  );
  try { execSync("pkill -f 'mem0-local-server|supermemory-server|zep-graphiti-server|letta-server' 2>/dev/null"); } catch (e) {}
  await new Promise(r => setTimeout(r, 3000));
}

fs.writeFileSync(
  path.join(REPORTS_DIR, "scaling-all.json"),
  JSON.stringify(results, null, 2)
);
console.log("\n=== Scaling benchmark complete ===");
console.log(`Results saved to ${path.join(REPORTS_DIR, "scaling-all.json")}`);
