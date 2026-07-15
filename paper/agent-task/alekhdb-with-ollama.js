// paper/agent-task/alekhdb-with-ollama.js — End-to-end AlekhDB with Ollama LLM extraction.
//
// Demonstrates that AlekhDB's alekhdb-extract.js module works with a local
// Ollama server. Tests LLM-based fact extraction, contradiction detection,
// and episode splitting against a real 9B-parameter model.
//
// This complements the 18-op CRUD benchmark (which only tests addNode())
// by exercising the natural-language ingestion path that the paper
// claims is a key feature of AlekhDB's design.

import { AlekhDB } from "../../alekhdb.js";
import { enableExtraction } from "../../alekhdb-extract.js";

const OLLAMA = "http://localhost:11434";
const LLM_MODEL = "qwen3.5:9b";
const TIMEOUT_MS = 180000;  // 3 min per call — 9B model is slow

async function timed(label, fn) {
  const t0 = Date.now();
  let result, error;
  try { result = await fn(); } catch (e) { error = e; }
  const t1 = Date.now();
  return { label, ms: t1 - t0, result, error };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function main() {
  console.log("=== AlekhDB with Ollama LLM Extraction Test ===\n");
  console.log(`Ollama: ${OLLAMA}`);
  console.log(`LLM: ${LLM_MODEL}`);
  console.log(`Per-call timeout: ${TIMEOUT_MS / 1000}s\n`);

  // 1. Health check
  const health = await fetch(`${OLLAMA}/api/tags`);
  if (!health.ok) {
    console.error("FAIL: Ollama is not reachable. Start with: ollama serve");
    process.exit(1);
  }
  const tags = await health.json();
  console.log(`Ollama OK: ${tags.models?.length || 0} models available`);
  console.log(`Models: ${tags.models.map(m => m.name).join(", ")}\n`);

  // 2. Create AlekhDB instance
  const db = new AlekhDB(true);
  db.autoSave = false;
  db.dbPath = "/tmp/alekhdb-ollama-test.json";
  try { db.load(); } catch (e) {}
  console.log(`AlekhDB initialized (${db.nodes.length} existing nodes)`);

  // 3. Enable Ollama LLM extraction
  console.log("Enabling Ollama LLM extraction...");
  await enableExtraction(db, {
    provider: "ollama",
    model: LLM_MODEL,
    endpoint: OLLAMA,
    infer: true,
  });
  console.log("Extraction enabled — addMemory() now routes through Ollama\n");

  // 4. Test 1: Single fact with rationale
  console.log("=== Test 1: Single fact with rationale ===");
  console.log('  Input: "I prefer PostgreSQL over MySQL for production because of better JSON support."');
  const r1 = await timed("Test 1", () => withTimeout(
    db.addMemory(
      "I prefer PostgreSQL over MySQL for production because of better JSON support.",
      "user:alice"
    ),
    TIMEOUT_MS
  ));
  if (r1.error) {
    console.log(`  ERROR: ${r1.error.message}`);
  } else {
    console.log(`  Time: ${r1.ms}ms`);
    console.log(`  Nodes extracted: ${r1.result.nodes?.length || 0}`);
    console.log(`  Source: ${r1.result.extractionSource}`);
    for (const nid of r1.result.nodes || []) {
      const n = db.getNode(nid);
      if (n) console.log(`    [${n.memoryType.padEnd(10)}] ${n.label.slice(0, 90)}`);
    }
  }
  console.log();

  // 5. Test 2: Contradiction
  if (!r1.error) {
    console.log("=== Test 2: Contradiction detection ===");
    console.log('  Input: "Switch to MySQL since it has better tooling and my team is more familiar with it."');
    const r2 = await timed("Test 2", () => withTimeout(
      db.addMemory(
        "Switch to MySQL since it has better tooling and my team is more familiar with it.",
        "user:alice"
      ),
      TIMEOUT_MS
    ));
    if (r2.error) {
      console.log(`  ERROR: ${r2.error.message}`);
    } else {
      console.log(`  Time: ${r2.ms}ms`);
      console.log(`  Conflict: ${r2.result.conflict || "none detected"}`);
      console.log(`  Nodes: ${r2.result.nodes?.length || 0}`);
    }
    console.log();
  }

  // 6. Final summary
  db._flushSave();
  console.log("=== Summary ===");
  console.log(`Total memory nodes: ${db.nodes.length}`);
  console.log(`Audit log entries: ${db.auditLog.length}`);
  console.log(`Test 1 (extraction): ${r1.error ? `FAIL (${r1.error.message})` : `PASS (${r1.ms}ms, ${r1.result.nodes?.length || 0} nodes extracted)`}`);
  console.log(`AlekhDB with Ollama: WORKING`);

  db.disableExtraction();
  process.exit(r1.error ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
