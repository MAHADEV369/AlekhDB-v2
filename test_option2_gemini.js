// AlekhDB Enterprise - Option 2 Gemini Cognitive Stress-Test (test_option2_gemini.js)
// This script runs a high-fidelity GraphRAG stress-test utilizing the Google Gemini API.

import { AlekhDB } from "./alekhdb.js";

async function runGeminiStressTest() {
  console.log("==========================================================================");
  console.log("🧠 STARTING OPTION 2 COGNITIVE STRESS TEST: GEMINI GRAPHRAG ENGINE");
  console.log("==========================================================================\n");

  // 1. Check for API key in the environment
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.error("❌ ERROR: GEMINI_API_KEY environment variable is not set.");
    console.log("\nTo run this test, please export your Gemini API key in your terminal:");
    console.log("   export GEMINI_API_KEY=\"your-api-key-here\"");
    console.log("   node test_option2_gemini.js\n");
    console.log("Alternatively, you can pass your API key as a command-line argument.");
    process.exit(1);
  }

  // 2. Initialize AlekhDB and enable Option 2 Gemini routing
  const sm = new AlekhDB(true);
  sm.clearToDefault();
  
  sm.llmConfig = {
    provider: "gemini",
    apiKey: geminiKey,
    endpoint: "",
    model: "gemini-2.5-flash"
  };
  sm.autoSave = true;

  console.log("✔ AlekhDB switched to 🔵 OPTION 2 (Active Gemini 2.5 Flash Cognitive Brain).\n");

  // ==========================================
  // PHASE 1: SEEDING THE COMPLEX KNOWLEDGE BASE
  // ==========================================
  console.log("📡 Ingesting complex initial fact base...");
  
  const fact1 = "Trident is a principal software architect who works at Cluely. Trident prefers using Node.js for backend development.";
  const fact2 = "John is the VP of Engineering at Cluely. John prefers using Slack for critical sales pipeline and infrastructure alerts.";
  const fact3 = "Sarah is the Product Lead at Cluely. Sarah prefers secure Email communication channels.";

  console.log(` -> Ingesting: "${fact1}"`);
  await sm.addMemory(fact1, "work");

  console.log(` -> Ingesting: "${fact2}"`);
  await sm.addMemory(fact2, "work");

  console.log(` -> Ingesting: "${fact3}"`);
  await sm.addMemory(fact3, "work");

  console.log("\n✔ Initial Graph database built successfully.");
  console.log(`   Active Nodes: ${sm.nodes.length}`);
  console.log(`   Active Edges: ${sm.edges.length}\n`);

  // ==========================================
  // PHASE 2: TESTING LOGICAL CONTRADICTIONS (Doyle's TMS Audit)
  // ==========================================
  console.log("--------------------------------------------------------------------------");
  console.log("🧬 PHASE 2: TESTING COGNITIVE DISSONANCE & TMS CONTRADICTION DECAY");
  console.log("--------------------------------------------------------------------------");

  // Contradiction A: Trident migrates the backend stack from Node.js to Bun
  const contradictionA = "Trident migrated Cluely's entire backend server stack to Bun.sh, completely deactivating the stale Node.js framework.";
  console.log(`[Ingest Event]: "${contradictionA}"`);
  
  const resultA = await sm.addMemory(contradictionA, "work");
  
  console.log("\nTMS Conflict Audit Log:");
  console.log(` -> Audit Event Log: ${resultA.conflict || "No conflict detected (Fallback rules applied)"}`);
  
  // Verify clashing edges decayed
  const nodejsEdges = sm.edges.filter(e => e.target === "tech-nodejs" || e.source === "tech-nodejs");
  nodejsEdges.forEach((edge) => {
    console.log(` -> Connection: ${edge.source} -[${edge.label}]-> ${edge.target} | Active: ${edge.active} | Weight: ${edge.weight}`);
  });

  // Contradiction B: John switches alerts from Slack to Discord
  const contradictionB = "John (VP of Engineering) shifted all sales alerts to Discord due to Slack API limits, deactivating Slack configuration pathways.";
  console.log(`\n[Ingest Event]: "${contradictionB}"`);
  
  const resultB = await sm.addMemory(contradictionB, "work");
  console.log("\nTMS Conflict Audit Log:");
  console.log(` -> Audit Event Log: ${resultB.conflict}`);

  // ==========================================
  // PHASE 3: TESTING CHROMA CONTEXT-1 SELF-EDITING (Active Pruning)
  // ==========================================
  console.log("\n--------------------------------------------------------------------------");
  console.log("📉 PHASE 3: TESTING CHROMA CONTEXT-1 SELF-EDITING (ACTIVE PRUNING)");
  console.log("--------------------------------------------------------------------------");
  
  const redundantFact = "Trident updated his developer details: he resides in California and operates strictly as a cloud-first system engineer, rendering his legacy local server notes obsolete.";
  console.log(`[Ingest Event]: "${redundantFact}"`);
  
  const resultC = await sm.addMemory(redundantFact, "work");
  console.log(`\nPruning Metrics:`);
  console.log(` -> Actively pruned ${resultC.prunedCount} redundant nodes from active memory footprint.`);
  
  const archivedNodes = sm.nodes.filter(n => n.properties?.archived);
  console.log(` -> Total Archived (Pruned) Nodes: ${archivedNodes.length}`);
  archivedNodes.forEach((node) => {
    console.log(`    - Archived Node: ${node.label} (${node.id}) | Reason: Decayed/Obsolete`);
  });

  // ==========================================
  // PHASE 4: TESTING MULTI-HOP GraphRAG RETRIEVAL
  // ==========================================
  console.log("\n--------------------------------------------------------------------------");
  console.log("🔍 PHASE 4: TESTING DYNAMIC GraphRAG SYNTHESIS");
  console.log("--------------------------------------------------------------------------");

  const query = "What is Cluely's current backend stack preference, who works there, and what are their alert channel configurations?";
  console.log(`[Search Query]: "${query}"`);
  
  const searchResult = await sm.search(query, "work");
  console.log("\nGemini GraphRAG Synthesized Response:\n");
  console.log(searchResult.synthesis);

  console.log("\n==========================================================================");
  console.log("🎉 OPTION 2 COGNITIVE GEMINI STRESS-TEST COMPLETED SUCCESSFULLY");
  console.log("==========================================================================");
}

runGeminiStressTest().catch(console.error);
