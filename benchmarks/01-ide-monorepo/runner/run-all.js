// run-all.js — Orchestrates the 14-operation benchmark across 5 backends.
//
// For each backend:
//   1. Calls the adapter's run() function
//   2. Adapter writes its own report (reports/0X-backend-report.md)
//   3. Adapter appends its metrics to reports/metrics.json

import { runAlekhdb } from "./../backends/alekhdb.js";
import { runMem0 } from "./../backends/mem0.js";
import { runSupermemory } from "./../backends/supermemory.js";
import { runZepGraphiti } from "./../backends/zep-graphiti.js";
import { runLetta } from "./../backends/letta.js";

const t0 = performance.now();

console.log("\n========================================");
console.log("BENCHMARK 01 — AI IDE Mono-Repo");
console.log("Running 14 ops against 5 backends...");
console.log("========================================\n");

const backends = [
  { name: "AlekhDB", run: runAlekhdb },
  { name: "Mem0", run: runMem0 },
  { name: "Supermemory", run: runSupermemory },
  { name: "Zep/Graphiti", run: runZepGraphiti },
  { name: "Letta", run: runLetta },
];

const summary = {};

for (const backend of backends) {
  console.log(`\n--- [${backend.name}] Starting ---`);
  const tBackend0 = performance.now();
  try {
    const result = await backend.run();
    const tBackend1 = performance.now();
    const okCount = result.results.filter(r => r.status === "OK").length;
    const skipCount = result.results.filter(r => r.status === "SKIP").length;
    console.log(`[${backend.name}] Done in ${((tBackend1 - tBackend0) / 1000).toFixed(1)}s — ${okCount} OK, ${skipCount} SKIP`);
    summary[backend.name] = { okCount, skipCount, timeMs: tBackend1 - tBackend0, ...result };
  } catch (e) {
    console.error(`[${backend.name}] FAILED: ${e.message}`);
    summary[backend.name] = { error: e.message };
  }
}

const t1 = performance.now();
const totalSec = ((t1 - t0) / 1000).toFixed(1);

console.log("\n========================================");
console.log("BENCHMARK COMPLETE");
console.log("========================================");
console.log(`Total time: ${totalSec}s`);
console.log("");
console.log("Backend results:");
for (const [name, s] of Object.entries(summary)) {
  if (s.error) {
    console.log(`  ${name}: ERROR (${s.error})`);
  } else {
    console.log(`  ${name}: ${s.okCount} OK, ${s.skipCount} SKIP, ${(s.timeMs/1000).toFixed(1)}s`);
  }
}
console.log("");
console.log("Reports written to:");
console.log("  benchmarks/01-ide-monorepo/reports/01-alekhdb-report.md");
console.log("  benchmarks/01-ide-monorepo/reports/02-mem0-report.md");
console.log("  benchmarks/01-ide-monorepo/reports/03-supermemory-report.md");
console.log("  benchmarks/01-ide-monorepo/reports/04-zep-graphiti-report.md");
console.log("  benchmarks/01-ide-monorepo/reports/05-letta-report.md");
console.log("");
console.log("Run the scorer next:");
console.log("  node benchmarks/01-ide-monorepo/runner/score.js");
console.log("========================================\n");
