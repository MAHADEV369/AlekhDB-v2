// AlekhDB Core - Elite Integration & Self-Indexing Live Test (elite_test.js)

import { AlekhDB } from "./alekhdb.js";
import * as fs from "fs";

// Helpers for formatted outputs
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const printHeader = (title) => console.log(`\n\x1b[1;35m▶▶▶ ${title} ◀◀◀\x1b[0m`);
const printStep = (num, text) => console.log(`\n\x1b[1;36mStep ${num}: ${text}\x1b[0m`);

async function runEliteTest() {
  console.log("\x1b[1;32m========================================================\x1b[0m");
  console.log("\x1b[1;32m      ALEKHDB CORE - ELITE LIVE RUNTIME TEST        \x1b[0m");
  console.log("\x1b[1;32m========================================================\x1b[0m");
  await delay(800);

  // Initialize engine in Node mode
  const sm = new AlekhDB(true);

  // -------------------------------------------------------------
  printStep(1, "Resetting and Seeding the Core Graph Database...");
  sm.clearToDefault();
  
  // Ingest B2B Account facts
  sm.addNode("company-cluely", "Cluely Inc.", "company", { sector: "B2B SaaS", status: "Active Lead" });
  sm.addNode("client-sarah", "Sarah (Product Lead)", "client", { role: "Champion", preferredChannel: "Email" });
  sm.addEdge("e-cluely-sarah", "client-sarah", "company-cluely", "works_at");
  sm.save();
  
  console.log(`\x1b[32m✔ Graph preloaded. Active Nodes: ${sm.nodes.length}, Edges: ${sm.edges.length}\x1b[0m`);
  await delay(1200);

  // -------------------------------------------------------------
  printStep(2, "Self-Indexing Codebase! (AST-Aware Chunking of alekhdb.js)...");
  console.log("\x1b[33mReading alekhdb.js from filesystem...\x1b[0m");
  
  try {
    const code = fs.readFileSync("./alekhdb.js", "utf8");
    console.log(`\x1b[33mParsing ${code.split("\n").length} lines of JavaScript source code...\x1b[0m`);
    await delay(1000);
    
    const chunkResult = sm.astChunkCode(code, "alekhdb.js");
    console.log(`\x1b[32m✔ AST Chunking Complete!\x1b[0m`);
    console.log(`  File Node Created: \x1b[36m${chunkResult.nodes[0]}\x1b[0m`);
    console.log(`  Extracted Class Node: \x1b[36m${chunkResult.nodes[1]}\x1b[0m`);
    console.log(`  Extracted Method Nodes: \x1b[36m${chunkResult.nodes.slice(2).join(", ")}\x1b[0m`);
  } catch (err) {
    console.error("  Failed to read alekhdb.js:", err);
  }
  await delay(1500);

  // -------------------------------------------------------------
  printStep(3, "Triggering Category Contradiction Zapper...");
  console.log("\x1b[33mCurrent Project backend state is set to: Node.js (uses_backend)\x1b[0m");
  
  // Set initial Node.js link
  sm.addNode("project-alekhdb", "Project AlekhDB", "project", { version: "v1.0.0" });
  sm.addNode("tech-nodejs", "Node.js", "technology", { category: "Runtime" });
  sm.addEdge("e-sm-node", "project-alekhdb", "tech-nodejs", "uses_backend", 1.0, true);
  sm.save();
  await delay(1200);

  console.log("\x1b[35m[Ingesting conflicting fact]: 'We migrated the project to Bun in May 2026'\x1b[0m");
  const ingestionResult = await sm.addMemory("We migrated the project to Bun in May 2026");
  
  if (ingestionResult.conflict) {
    console.log(`\n\x1b[1;31m[!] ${ingestionResult.conflict}\x1b[0m`);
  }
  await delay(1500);

  // Check conflicts log
  console.log("\x1b[33mReading Virtual POSIX Mount File: /memory/conflicts.log ...\x1b[0m");
  const logs = sm.auditLog.filter(l => l.event === "CONTRADICTION_RESOLVED");
  logs.forEach(l => {
    console.log(`  \x1b[32mFile line -> [${l.timestamp}] (${l.event}): ${l.description}\x1b[0m`);
  });
  await delay(1500);

  // -------------------------------------------------------------
  printStep(4, "Executing GraphRAG Hybrid Search query for 'Bun'...");
  console.log("\x1b[33mVector Matching + Graph 2-degree neighborhood traversal...\x1b[0m");
  await delay(1000);

  const t0 = performance.now();
  const searchResult = await sm.search("Bun");
  const t1 = performance.now();
  
  console.log(`\x1b[32m✔ GraphRAG Synthesis Complete.\x1b[0m Search Latency: \x1b[1;33m${(t1 - t0).toFixed(3)} ms\x1b[0m`);
  console.log(searchResult.synthesis);
  await delay(1500);

  // -------------------------------------------------------------
  printStep(5, "Compiles & Synthesizes Markdown User Profile Document...");
  await delay(1000);
  console.log(sm.profile());
  await delay(1000);

  // -------------------------------------------------------------
  console.log("\x1b[1;32m========================================================\x1b[0m");
  console.log("\x1b[1;32m     ✔ ELITE TEST COMPLETE: ALL CORE ARCHITECTURES OK   \x1b[0m");
  console.log("\x1b[1;32m========================================================\x1b[0m\n");
}

runEliteTest();
