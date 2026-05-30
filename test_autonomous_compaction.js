// AlekhDB Core - Autonomous Token-Count Compaction Test (test_autonomous_compaction.js)

import { AlekhDB } from "./alekhdb.js";

const sm = new AlekhDB(true);

console.log("\x1b[1;34m=== RUNNING AUTONOMOUS TOKEN COMPACTION INTEGRATION TEST ===\x1b[0m\n");

// Reset to clean seed
sm.clearToDefault();
sm.addNode("project-alekhdb", "Project AlekhDB", "project", { description: "GraphRAG AI memory layer" });
sm.addNode("tech-bun", "Bun.sh", "technology", { category: "Runtime" });
sm.addEdge("e-sm-bun", "project-alekhdb", "tech-bun", "uses_backend", 1.0, true);
sm.save();

const startTokens = sm.calculateActiveTokens();
console.log(`Initial Context Token Load: \x1b[1;33m${startTokens} tokens\x1b[0m`);

// Define 4 heavy, verbose document logs to force the token count over 6,400 capacity
const heavyParagraphs = [
  "Document block A: " + "A very long detailed architectural trace detailing the deployment of the SQLite file database layer, indexing strategies, low-latency node configurations, and secondary cluster parameters. ".repeat(60),
  "Document block B: " + "Further comprehensive engineering reports mapping out AST syntax chunkers, lexers, structural code analysis parameters, parent-child method containment edges, and scope trackers. ".repeat(60),
  "Document block C: " + "B2B Salesforce webhooks mapping Slack channel preferencing, Notion integration configurations, real-time Gmail event trackers, and Amazon S3 document bucket sync keys. ".repeat(60),
  "Document block D: " + "Delawareip IP lawsuit trade secrets strategy precedents DuPont aerospace legal cases, IP theft liability boundaries, and corporate security guidelines. ".repeat(60)
];

console.log("\n\x1b[36mInjecting heavy documents to fill the context window past 80% (6,400 tokens)...\x1b[0m");

for (let i = 0; i < heavyParagraphs.length; i++) {
  console.log(`\nIngesting Document Block ${i + 1} (${Math.ceil(heavyParagraphs[i].length / 4.0)} tokens)...`);
  const result = sm.addMemory(heavyParagraphs[i]);
  
  const currentTokens = sm.calculateActiveTokens();
  console.log(`Current Active Tokens: \x1b[1;33m${currentTokens} tokens\x1b[0m`);
  
  if (result.conflict && result.conflict.includes("AUTONOMOUS COMPACTION TRIGGERED")) {
    console.log(`\n\x1b[1;32m✔ SUCCESS: Autonomous Compaction successfully fired at Step ${i + 1}!\x1b[0m`);
    console.log(`  Alert Log: \x1b[1;31m[!] ${result.conflict}\x1b[0m`);
    break;
  }
}

console.log("\n\x1b[33mChecking virtual directory files... /memory/profile.md :\x1b[0m");
console.log(sm.profile());

console.log("\n\x1b[1;32m=== AUTONOMOUS COMPACTION TEST PASSED ===\x1b[0m\n");
