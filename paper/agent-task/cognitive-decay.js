// paper/agent-task/cognitive-decay.js — Cognitive study: Ebbinghaus vs TTL vs no-decay.
//
// Simulates a long-horizon agent task over 30 days. At each day, new
// facts are added. The agent needs to recall relevant facts for
// day-specific tasks. We measure recall accuracy over time.
//
// Three decay strategies:
//   1. Ebbinghaus (AlekhDB's biological decay) — exponential S = S0 * exp(-lambda * t)
//   2. Uniform TTL (step decay at fixed time) — set isForgotten = true at threshold
//   3. No decay (keep everything) — strength always 1.0
//
// Hypothesis: Ebbinghaus outperforms uniform TTL on long-horizon tasks because
// it preserves frequently-accessed memories longer than rarely-accessed ones.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AlekhDB } from "../../alekhdb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SIM_DAYS = 30;
const FACTS_PER_DAY = 10;
const N_TASKS = 50;

class EbbinghausStrategy {
  constructor(db) { this.db = db; }
  setup() {
    this.db.setDecayRate(168);  // 1 week half-life
  }
  // AlekhDB already does Ebbinghaus automatically
  apply() {}  // No-op, decay is automatic
}

class UniformTTLStrategy {
  constructor(db) { this.db = db; this.thresholdMs = 7 * 86400000; }  // 7 day TTL
  setup() {}
  apply() {
    const now = Date.now();
    for (const node of this.db.nodes) {
      if (node.isForgotten) continue;
      const age = now - new Date(node.createdAt).getTime();
      if (age > this.thresholdMs) {
        node.isForgotten = true;
      }
    }
  }
}

class NoDecayStrategy {
  constructor(db) { this.db = db; }
  setup() {}
  apply() {}  // Never forget
}

function setupTasks() {
  // Generate N_TASKS tasks across 30 days
  // Each task has a query and a list of relevant fact IDs
  const tasks = [];
  const facts = [];
  for (let day = 0; day < SIM_DAYS; day++) {
    for (let i = 0; i < FACTS_PER_DAY; i++) {
      const factId = `f-d${day}-${i}`;
      const importance = Math.random();  // 0-1
      facts.push({ id: factId, day, importance, text: `Fact from day ${day} #${i}: ${['User prefers X', 'System has bug Y', 'Performance issue Z'][i % 3]}` });
    }
  }
  for (let i = 0; i < N_TASKS; i++) {
    // Random task on a random day
    const taskDay = Math.floor(Math.random() * SIM_DAYS);
    // 1-3 relevant facts from that day
    const relevant = facts.filter(f => f.day === taskDay).slice(0, 1 + Math.floor(Math.random() * 3));
    tasks.push({ day: taskDay, query: relevant[0]?.text || "test", relevantIds: relevant.map(f => f.id) });
  }
  return { tasks, facts };
}

async function runStrategy(name, strategyClass) {
  const db = new AlekhDB(true);
  db.autoSave = false;
  const strategy = new strategyClass(db);
  strategy.setup();
  // Add all facts
  const { tasks, facts } = setupTasks();
  for (const f of facts) {
    db.addNode(f.id, f.text, "fact", { day: f.day, importance: f.importance }, "user:test", { memoryType: "fact" });
    // Backdate creation
    const n = db.getNode(f.id);
    if (n) {
      const daysAgo = SIM_DAYS - f.day;
      n.createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
      n.properties.lastAccessedAt = n.createdAt;
    }
  }
  // Apply decay strategy
  strategy.apply();
  // Run tasks
  let totalRecall = 0;
  let totalTasks = 0;
  for (const task of tasks) {
    const r = await db.search(task.query, "user:test");
    const retrievedIds = r.matchedNodeIds || [];
    const hits = task.relevantIds.filter(id => retrievedIds.includes(id)).length;
    const recall = task.relevantIds.length > 0 ? hits / task.relevantIds.length : 0;
    totalRecall += recall;
    totalTasks++;
  }
  return {
    strategy: name,
    avgRecall: totalRecall / totalTasks,
    totalTasks,
    totalFacts: facts.length,
  };
}

async function main() {
  const results = [];
  for (const [name, cls] of [
    ["Ebbinghaus (1wk half-life)", EbbinghausStrategy],
    ["Uniform TTL (7 days)", UniformTTLStrategy],
    ["No decay", NoDecayStrategy],
  ]) {
    console.log(`Running ${name}...`);
    const r = await runStrategy(name, cls);
    console.log(`  ${name}: avg recall = ${(r.avgRecall * 100).toFixed(1)}%`);
    results.push(r);
  }
  const outPath = path.join(__dirname, "..", "data", "cognitive-decay-results.json");
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`\nResults saved to ${outPath}`);
  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.strategy}: ${(r.avgRecall * 100).toFixed(1)}% recall`);
  }
  const winning = results.reduce((a, b) => a.avgRecall > b.avgRecall ? a : b);
  console.log(`\nWinner: ${winning.strategy}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e); process.exit(1); });
}
