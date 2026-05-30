#!/usr/bin/env node

// AlekhDB Core - Runnable POSIX CLI (cli.js)

import { AlekhDB } from "./alekhdb.js";
import { initialNodes, initialEdges, initialTraces, initialEventFrames } from "./sampleData.js";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";

const sm = new AlekhDB(true);
const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  printHelp();
  process.exit(0);
}

switch (command.toLowerCase()) {
  case "add":
    await handleAdd(args.slice(1).join(" "));
    break;
  case "scrape":
    await handleScrape(args[1]);
    break;
  case "parse":
    await handleParsePdf(args[1]);
    break;
  case "ls":
    handleLs(args[1]);
    break;
  case "cat":
    handleCat(args[1]);
    break;
  case "grep":
    await handleGrep(args.slice(1).join(" "));
    break;
  case "profile":
    handleProfile();
    break;
  case "analyze":
    handleAnalyze(args[1]);
    break;
  case "seed":
    handleSeed();
    break;
  case "clear":
    handleClear();
    break;
  case "compaction":
    handleCompaction();
    break;
  case "trace-start":
    handleTraceStart(args[1], args[2], args[3], args[4]);
    break;
  case "trace-append":
    handleTraceAppend(args[1], args[2]);
    break;
  case "trace-finalize":
    handleTraceFinalize(args[1], args[2]);
    break;
  case "trace-replay":
    handleTraceReplay(args[1]);
    break;
  case "trace-ingest":
    await handleTraceIngest(args[1]);
    break;
  case "trace-list":
    handleTraceList();
    break;
  case "capacity":
    handleCapacity(args[1]);
    break;
  default:
    console.log(`\x1b[31mError: Unknown command "${command}"\x1b[0m`);
    printHelp();
    process.exit(1);
}

// Help instructions
function printHelp() {
  console.log(`
\x1b[1;34mAlekhDB Core - Lightweight GraphRAG POSIX CLI\x1b[0m
Usage: alekhdb [command] [arguments]

\x1b[36mCommands:\x1b[0m
  \x1b[33mseed\x1b[0m                 Populate local DB with software, B2B sales, and legal seed datasets
  \x1b[33manalyze <dir>\x1b[0m        Recursively index a local codebase directory and map code structure as graph nodes!
  \x1b[33mscrape <url>\x1b[0m         Scrape a URL (via Jina Reader or local Cheerio HTML scrubbing) and index to graph!
  \x1b[33mparse <pdf_path>\x1b[0m     Parse a local PDF file natively in-memory and index text to graph!
  \x1b[33madd "<text>"\x1b[0m         Ingest raw text/notes, run extraction, and detect logical contradictions
  \x1b[33mls [path]\x1b[0m            List files and virtual directories of the active semantic mount
  \x1b[33mcat <file_path>\x1b[0m      Display the contents of a specific semantic file
  \x1b[33mgrep "<query>"\x1b[0m       Search memory using hybrid vector GraphRAG and return traversed context
  \x1b[33mprofile\x1b[0m              Output synthesized Markdown profile containing stable facts & preferences
  \x1b[33mcompaction\x1b[0m           Run preemptive context compaction to summarize logs and clear context window
  \x1b[33mclear\x1b[0m                Reset and empty the local database
  \x1b[33mcapacity [tokens]\x1b[0m    Print or adjust the active context window capacity (8,000 to 1,000,000)

\x1b[36mEpisodic Trace Commands:\x1b[0m
  \x1b[33mtrace-start <id> <agent> <session> <task>\x1b[0m  Start an active trace attempt session
  \x1b[33mtrace-append <id> '<json>'\x1b[0m                 Append a chronological tool frame to open trace
  \x1b[33mtrace-finalize <id> <outcome>\x1b[0m              Lock active trace with success/failure outcome
  \x1b[33mtrace-replay <id>\x1b[0m                          Print a formatted chronological trace replay
  \x1b[33mtrace-ingest <id>\x1b[0m                          Bridge episodic trace narrative into ontological graph
  \x1b[33mtrace-list\x1b[0m                                 List all open and finalized traces

\x1b[36mExamples:\x1b[0m
  $ alekhdb seed
  $ alekhdb analyze .
  $ alekhdb trace-replay trace-demo-deployment
  $ alekhdb trace-ingest trace-demo-deployment
  `);
}

// Ingest fact
async function handleAdd(text) {
  if (!text) {
    console.log("\x1b[31mError: Please provide a text fact to ingest.\x1b[0m\nExample: supermemory add \"I am a strict vegan\"");
    process.exit(1);
  }
  console.log(`\x1b[36mIngesting fact: "${text}"...\x1b[0m`);
  const result = await sm.addMemory(text);
  console.log("\x1b[32mSuccess: Knowledge ingested and indexed into Graph.\x1b[0m");
  if (result.conflict) {
    console.log(`\n\x1b[1;31m[!] ${result.conflict}\x1b[0m`);
  }
  console.log(`Extracted Nodes: ${result.nodes.join(", ") || "None"}`);
  console.log(`Active Connections Created: ${result.edges.length}`);
}

// List virtual filesystem folders (POSIX mount mapping)
function handleLs(path = "/memory") {
  const normPath = path.replace(/\/$/, "");
  console.log(`\x1b[34mListing directory contents of: ${normPath}\x1b[0m`);
  
  if (normPath === "" || normPath === "/" || normPath === "/memory") {
    console.log(`
drwxr-xr-x   trident   staff   128 B   \x1b[1;36muser/\x1b[0m
drwxr-xr-x   trident   staff   128 B   \x1b[1;36mprojects/\x1b[0m
drwxr-xr-x   trident   staff   128 B   \x1b[1;36mtraces/\x1b[0m
-rw-r--r--   trident   staff   2.4 KB  \x1b[32mprofile.md\x1b[0m
-rw-r--r--   trident   staff   1.1 KB  \x1b[32mconflicts.log\x1b[0m
    `);
  } else if (normPath === "/memory/user") {
    const clients = sm.nodes.filter(n => n.type === "client").map(n => n.id + ".txt");
    console.log(`drwxr-xr-x   trident   staff   128 B   \x1b[1;36mpreferences/\x1b[0m`);
    clients.forEach(c => {
      console.log(`-rw-r--r--   trident   staff   312 B   \x1b[32m${c}\x1b[0m`);
    });
  } else if (normPath === "/memory/user/preferences") {
    console.log(`-rw-r--r--   trident   staff   184 B   \x1b[32mdiet.txt\x1b[0m`);
    console.log(`-rw-r--r--   trident   staff   184 B   \x1b[32mstack.txt\x1b[0m`);
  } else if (normPath === "/memory/projects") {
    const files = sm.nodes.filter(n => n.type === "file").map(n => n.label);
    const classes = sm.nodes.filter(n => n.type === "class").map(n => n.label + ".class");
    
    console.log(`-rw-r--r--   trident   staff   512 B   \x1b[32malekhdb.jsonc\x1b[0m`);
    files.forEach(f => console.log(`-rw-r--r--   trident   staff   1.2 KB  \x1b[32m${f}\x1b[0m`));
    classes.forEach(c => console.log(`-rw-r--r--   trident   staff   600 B   \x1b[32m${c}\x1b[0m`));
  } else if (normPath === "/memory/traces") {
    console.log(`
drwxr-xr-x   trident   staff   128 B   \x1b[1;36mopen/\x1b[0m
drwxr-xr-x   trident   staff   128 B   \x1b[1;36mfinalized/\x1b[0m
    `);
    sm.traces.forEach(t => {
      console.log(`-rw-r--r--   trident   staff   512 B   \x1b[32m${t.traceId}.trace\x1b[0m`);
    });
  } else if (normPath === "/memory/traces/open") {
    const openTraces = sm.traces.filter(t => t.status === "open");
    if (openTraces.length === 0) {
      console.log("No active open traces.");
    } else {
      openTraces.forEach(t => {
        console.log(`-rw-r--r--   trident   staff   512 B   \x1b[32m${t.traceId}.trace\x1b[0m`);
      });
    }
  } else if (normPath === "/memory/traces/finalized") {
    const finalizedTraces = sm.traces.filter(t => t.status === "finalized");
    if (finalizedTraces.length === 0) {
      console.log("No finalized traces.");
    } else {
      finalizedTraces.forEach(t => {
        console.log(`-rw-r--r--   trident   staff   512 B   \x1b[32m${t.traceId}.trace\x1b[0m`);
      });
    }
  } else {
    console.log(`\x1b[31mls: ${path}: No such file or directory\x1b[0m`);
  }
}

// Display file contents (POSIX cat)
function handleCat(path) {
  if (!path) {
    console.log("\x1b[31mError: Please specify a file path to cat.\x1b[0m\nExample: supermemory cat /memory/profile.md");
    process.exit(1);
  }

  const normPath = path.toLowerCase().replace(/\/$/, "");

  if (normPath.includes("profile.md")) {
    console.log(sm.profile());
  } else if (normPath.includes("conflicts.log")) {
    console.log("\n\x1b[1;31m--- CHRONOLOGICAL CONTRADICTION & MUTATION AUDIT TRAIL ---\x1b[0m");
    const conflictLogs = sm.auditLog.filter(l => l.event === "CONTRADICTION_RESOLVED" || l.event === "PREFERENCE_UPDATE");
    if (conflictLogs.length === 0) {
      console.log("No logical memory clashes resolved yet. Database stack is consistent.");
    } else {
      conflictLogs.forEach(l => {
        console.log(`\x1b[33m[${l.timestamp}]\x1b[0m \x1b[36m(${l.event})\x1b[0m: ${l.description}`);
      });
    }
  } else if (normPath.includes(".trace")) {
    const baseName = normPath.split("/").pop().replace(/\.trace$/, "");
    const trace = sm.traces.find(t => t.traceId.toLowerCase() === baseName);
    if (trace) {
      handleTraceReplay(trace.traceId);
    } else {
      console.log(`\x1b[31mcat: ${path}: Trace file not found\x1b[0m`);
    }
  } else if (normPath.includes("diet.txt")) {
    const vegan = sm.nodes.find(n => n.id === "client-sarah");
    console.log(`# Synthesized Dietary Preference
* Active Contact: Sarah (Product Lead)
* Diet preference: Vegan (Strict preference registered in account history).`);
  } else if (normPath.includes("stack.txt")) {
    const activeBackend = sm.edges.find(e => e.label === "uses_backend" && e.active);
    const runtime = activeBackend ? sm.nodes.find(n => n.id === activeBackend.target) : null;
    console.log(`# Synthesized Stack Preference
* Active Backend Runtime: ${runtime ? runtime.label : "Node.js (Stale)"}
* Database storage: SQLite`);
  } else if (normPath.includes("alekhdb.jsonc")) {
    console.log(`{
  // Simulated Cursor/Claude Code Plugin Configuration
  "apiKey": "sm_live_node_cli_token_9x12",
  "defaultScope": "work",
  "syncIntervalSeconds": 60,
  "localMountPath": "/memory"
}`);
  } else if (normPath.endsWith(".txt") || normPath.endsWith(".class") || normPath.endsWith(".js")) {
    const baseName = normPath.split("/").pop().replace(/\.(txt|class|js)$/, "");
    const matchingNode = sm.nodes.find(n => n.id.includes(baseName) || n.label.toLowerCase().includes(baseName));
    if (matchingNode) {
      console.log(`# Node Meta Properties: ${matchingNode.label}`);
      console.log(JSON.stringify(matchingNode.properties, null, 2));
    } else {
      console.log(`\x1b[31mcat: ${path}: File not found\x1b[0m`);
    }
  } else {
    console.log(`\x1b[31mcat: ${path}: No such file\x1b[0m`);
  }
}

// Semantic grep Search
async function handleGrep(query) {
  if (!query) {
    console.log("\x1b[31mError: Please provide a search query for grep.\x1b[0m\nExample: supermemory grep \"Bun\"");
    process.exit(1);
  }

  console.log(`\x1b[36mRunning semantic RAG grep for: "${query}"...\x1b[0m`);
  const results = await sm.search(query);
  console.log(results.synthesis);
}

// Generate Profile
function handleProfile() {
  console.log(sm.profile());
}

// Load seed data
function handleSeed() {
  console.log("\x1b[36mSeeding local memory database with initial datasets...\x1b[0m");
  
  sm.autoSave = false; // Disable auto-saving during bulk insertion
  // Clear first
  sm.clearToDefault();

  // Load sample nodes and edges
  initialNodes.forEach(node => {
    sm.addNode(node.id, node.label, node.type, node.properties, node.scope);
  });

  initialEdges.forEach(edge => {
    sm.addEdge(edge.id, edge.source, edge.target, edge.label, edge.weight, edge.active);
  });

  // Seed Traces and EventFrames
  if (Array.isArray(initialTraces)) {
    sm.traces = JSON.parse(JSON.stringify(initialTraces));
  }
  if (Array.isArray(initialEventFrames)) {
    sm.eventFrames = JSON.parse(JSON.stringify(initialEventFrames));
  }

  sm.logAudit("DB_SEED", "Preloaded database with Software, B2B Sales, Legal, and Episodic Traces.");
  sm.autoSave = true; // Re-enable auto-saving
  sm.save(); // Save exactly once
  console.log("\x1b[32mSuccess: Local database seeded. Active nodes: " + sm.nodes.length + ", Edges: " + sm.edges.length + ", Traces: " + sm.traces.length + "\x1b[0m");
}

// Clear DB
function handleClear() {
  sm.clearToDefault();
  console.log("\x1b[32mSuccess: Database wiped clean.\x1b[0m");
}

// Run Compaction
function handleCompaction() {
  console.log("\x1b[36mRunning active context window compaction...\x1b[0m");
  const summaryId = sm.compaction();
  console.log(`\x1b[32mSuccess: Context compacted. Generated summary node: ${summaryId}\x1b[0m`);
}

// Codebase Directory scanner helper
function walkDir(dir, fileList = []) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file === "node_modules" || file === ".git" || file === ".gemini" || file === "dist") continue;
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        walkDir(filePath, fileList);
      } else if (stat.isFile() && (file.endsWith(".js") || file.endsWith(".mjs"))) {
        fileList.push(filePath);
      }
    }
  } catch (err) {
    console.error("Failed to read directory:", err.message);
  }
  return fileList;
}

// Codebase directory scanner handler
function handleAnalyze(targetDir = ".") {
  console.log(`\n\x1b[36mInitializing codebase directory scan in: ${targetDir} ...\x1b[0m`);
  const files = walkDir(targetDir);
  console.log(`Located ${files.length} code files. Starting AST-Aware structural chunking...`);
  
  let nodesCount = 0;
  for (const file of files) {
    try {
      const code = fs.readFileSync(file, "utf8");
      const relativePath = path.relative(process.cwd(), file);
      const res = sm.astChunkCode(code, relativePath);
      console.log(`  \x1b[32m✔ Indexed:\x1b[0m ${relativePath} (Extracted ${res.nodes.length} nodes)`);
      nodesCount += res.nodes.length;
    } catch (err) {
      console.error(`  \x1b[31m✖ Failed to parse ${file}:\x1b[0m`, err.message);
    }
  }
  console.log(`\n\x1b[1;32mCodebase analysis complete! Index size expanded by ${nodesCount} structural nodes.\x1b[0m`);
  console.log("You can now open the Web UI to visually explore your project codebase or use 'supermemory grep' to locate components!");
}

// Scrape URL handler
async function handleScrape(url) {
  if (!url) {
    console.log("\x1b[31mError: Please provide a URL to scrape.\x1b[0m\nExample: supermemory scrape https://supermemory.ai/");
    process.exit(1);
  }
  console.log(`\n\x1b[36mInitializing scraper for URL: ${url} ...\x1b[0m`);
  try {
    const res = await sm.scrapeUrl(url);
    console.log(`\x1b[32m✔ Scraping Successful!\x1b[0m`);
    console.log(`  Source Engine: \x1b[36m${res.source}\x1b[0m`);
    console.log(`  Extracted Document Node: \x1b[36m${res.nodes.join(", ")}\x1b[0m`);
    console.log(`  Preview (150 chars): "${res.text.slice(0, 150)}..."`);
  } catch (err) {
    console.error(`\x1b[31m✖ Scraping Failed:\x1b[0m`, err.message);
  }
}

// PDF Parser handler
async function handleParsePdf(pdfPath) {
  if (!pdfPath) {
    console.log("\x1b[31mError: Please provide a path to a PDF file to parse.\x1b[0m\nExample: supermemory parse resume.pdf");
    process.exit(1);
  }
  console.log(`\n\x1b[36mInitializing PDF Parser for file: ${pdfPath} ...\x1b[0m`);
  try {
    const res = await sm.parsePdfFile(pdfPath);
    console.log(`\x1b[32m✔ PDF Parsing Successful!\x1b[0m`);
    console.log(`  Extracted Document Node: \x1b[36m${res.nodes.join(", ")}\x1b[0m`);
    console.log(`  Document Title: \x1b[36m${res.metadata?.Title || "N/A"}\x1b[0m`);
    console.log(`  Preview (150 chars): "${res.text.slice(0, 150)}..."`);
  } catch (err) {
    console.error(`\x1b[31m✖ PDF Parsing Failed:\x1b[0m`, err.message);
  }
}

// ==========================================
// EPISODIC TRACE COMMAND HANDLERS
// ==========================================

function handleTraceStart(traceId, agentId, sessionId, taskId) {
  if (!traceId) {
    console.log("\x1b[31mError: Please provide a traceId.\x1b[0m\nExample: supermemory trace-start deploy-prod-001 codex session-42 deploy-production");
    process.exit(1);
  }
  console.log(`\x1b[36mStarting active trace attempt: ${traceId}...\x1b[0m`);
  try {
    const trace = sm.startTrace(traceId, agentId, sessionId, taskId);
    console.log(`\x1b[32m✔ Trace started successfully:\x1b[0m`);
    console.log(`  Trace ID: ${trace.traceId}`);
    console.log(`  Agent: ${trace.agentId}`);
    console.log(`  Task Name: ${trace.taskId}`);
  } catch (err) {
    console.error(`\x1b[31m✖ Trace Start Failed:\x1b[0m`, err.message);
  }
}

function handleTraceAppend(traceId, jsonStr) {
  if (!traceId || !jsonStr) {
    console.log("\x1b[31mError: Missing traceId or event frame JSON payload.\x1b[0m\nExample: supermemory trace-append deploy-prod-001 '{\"toolCallJson\":{\"tool\":\"shell\",\"cmd\":\"kubectl apply\"},\"toolResultJson\":{\"exit_code\":1}}'");
    process.exit(1);
  }
  console.log(`\x1b[36mAppending event frame to trace ${traceId}...\x1b[0m`);
  try {
    const frameData = JSON.parse(jsonStr);
    const frame = sm.appendEventFrame(traceId, frameData);
    console.log(`\x1b[32m✔ Frame #${frame.stepIdx} appended successfully:\x1b[0m`);
    console.log(`  Timestamp: ${frame.ts}`);
    console.log(`  Error Signature: ${frame.errorSignature || "None"}`);
    // Explicit save on append trigger to ensure command line state syncs
    sm.save();
  } catch (err) {
    console.error(`\x1b[31m✖ Frame Append Failed:\x1b[0m`, err.message);
  }
}

function handleTraceFinalize(traceId, outcome) {
  if (!traceId || !outcome) {
    console.log("\x1b[31mError: Missing traceId or outcome.\x1b[0m\nExample: supermemory trace-finalize deploy-prod-001 failure");
    process.exit(1);
  }
  console.log(`\x1b[36mFinalizing trace ${traceId} with outcome: ${outcome}...\x1b[0m`);
  try {
    const trace = sm.finalizeTrace(traceId, outcome);
    console.log(`\x1b[32m✔ Trace ${traceId} finalized successfully.\x1b[0m`);
    console.log(`  Outcome: ${trace.outcome}`);
    console.log(`  Locked at: ${trace.finalizedAt}`);
  } catch (err) {
    console.error(`\x1b[31m✖ Trace Finalization Failed:\x1b[0m`, err.message);
  }
}

function handleTraceReplay(traceId) {
  if (!traceId) {
    console.log("\x1b[31mError: Please specify a traceId to replay.\x1b[0m\nExample: supermemory trace-replay deploy-prod-001");
    process.exit(1);
  }
  try {
    const data = sm.replayTrace(traceId);
    console.log(`\n\x1b[1;35m========================================================\x1b[0m`);
    console.log(`\x1b[1;35m    EPISODIC TRACE REPLAY: ${data.trace.traceId}         \x1b[0m`);
    console.log(`\x1b[1;35m========================================================\x1b[0m`);
    console.log(`\x1b[36mTask Name   :\x1b[0m ${data.trace.taskId}`);
    console.log(`\x1b[36mAgent ID    :\x1b[0m ${data.trace.agentId}`);
    console.log(`\x1b[36mSession ID  :\x1b[0m ${data.trace.sessionId}`);
    console.log(`\x1b[36mStatus      :\x1b[0m ${data.trace.status.toUpperCase()}`);
    console.log(`\x1b[36mOutcome     :\x1b[0m ${data.trace.outcome === "success" ? "\x1b[32mSUCCESS\x1b[0m" : "\x1b[31mFAILURE\x1b[0m"}`);
    console.log(`\x1b[36mStarted At  :\x1b[0m ${data.trace.createdAt}`);
    if (data.trace.finalizedAt) {
      console.log(`\x1b[36mLocked At   :\x1b[0m ${data.trace.finalizedAt}`);
    }
    console.log(`\x1b[1;35m--------------------------------------------------------\x1b[0m`);

    if (data.frames.length === 0) {
      console.log(`  No chronological steps recorded in this trace.`);
    } else {
      data.frames.forEach((frame) => {
        console.log(`\n\x1b[1;33m[Step #${frame.stepIdx}] [${frame.ts}]\x1b[0m`);
        console.log(`  \x1b[36mTool Call :\x1b[0m`, JSON.stringify(frame.toolCallJson));
        console.log(`  \x1b[36mResponse  :\x1b[0m`, JSON.stringify(frame.toolResultJson));
        console.log(`  \x1b[36mSnapshot  :\x1b[0m`, JSON.stringify(frame.stateSnapshotJson));
        if (frame.errorSignature) {
          console.log(`  \x1b[1;31mError Sig :\x1b[0m \x1b[1;31m${frame.errorSignature}\x1b[0m`);
        }
        if (frame.extractedBeliefs && frame.extractedBeliefs.length > 0) {
          console.log(`  \x1b[32mBeliefs   :\x1b[0m \x1b[32m${frame.extractedBeliefs.join(", ")}\x1b[0m`);
        }
      });
    }
    console.log(`\n\x1b[1;35m========================================================\x1b[0m\n`);
  } catch (err) {
    console.error(`\x1b[31m✖ Trace Replay Failed:\x1b[0m`, err.message);
  }
}

async function handleTraceIngest(traceId) {
  if (!traceId) {
    console.log("\x1b[31mError: Please specify a traceId to ingest.\x1b[0m\nExample: supermemory trace-ingest deploy-prod-001");
    process.exit(1);
  }
  console.log(`\x1b[36mBridging episodic trace ${traceId} into permanent Ontological Graph...\x1b[0m`);
  try {
    const result = await sm.ingestTraceAsMemory(traceId);
    console.log(`\x1b[32m✔ Trace Ingestion Successful!\x1b[0m`);
    console.log(`  Created Trace Node ID: \x1b[36m${result.traceNodeId}\x1b[0m`);
    console.log(`  Extracted Belief Nodes: \x1b[36m${result.nodes.join(", ") || "None"}\x1b[0m`);
    console.log(`  Active Relationships Created: \x1b[36m${result.edges.length}\x1b[0m`);
    if (result.conflict) {
      console.log(`\n\x1b[1;31m[!] TMS Belief Audit Log:\x1b[0m`);
      console.log(`    ${result.conflict}`);
    }
  } catch (err) {
    console.error(`\x1b[31m✖ Trace Ingestion Failed:\x1b[0m`, err.message);
  }
}

function handleTraceList() {
  console.log(`\n\x1b[34m--- ACTIVE & HISTORICAL EPISODIC TRACES ---\x1b[0m`);
  if (sm.traces.length === 0) {
    console.log("No episodic traces recorded in database. Mount is empty.");
  } else {
    sm.traces.forEach((t) => {
      const outcomeText = t.outcome === "success" ? "\x1b[32mSUCCESS\x1b[0m" : (t.outcome === "failure" ? "\x1b[31mFAILURE\x1b[0m" : "\x1b[33mUNKNOWN\x1b[0m");
      const statusText = t.status === "finalized" ? "\x1b[35m[FINALIZED]\x1b[0m" : "\x1b[36m[OPEN]\x1b[0m";
      console.log(`* \x1b[33m${t.traceId}\x1b[0m ${statusText} - Task: ${t.taskId} (Outcome: ${outcomeText}, Agent: ${t.agentId})`);
    });
  }
  console.log("");
}

function handleCapacity(capacityArg) {
  if (!capacityArg) {
    console.log(`\n\x1b[34m--- ACTIVE CONTEXT WINDOW CAPACITY ---\x1b[0m`);
    console.log(`Current Context Capacity: \x1b[36m${sm.contextCapacity.toLocaleString()}\x1b[0m tokens`);
    console.log(`Active Memory Token Usage: \x1b[36m${sm.calculateActiveTokens().toLocaleString()}\x1b[0m tokens`);
    console.log(`Compaction Threshold (80%): \x1b[33m${(sm.contextCapacity * 0.8).toLocaleString()}\x1b[0m tokens\n`);
    return;
  }

  const capacityVal = parseInt(capacityArg);
  if (isNaN(capacityVal) || capacityVal < 8000 || capacityVal > 1000000) {
    console.log("\x1b[31mError: Capacity must be a number between 8,000 and 1,000,000 tokens.\x1b[0m\nExample: alekhdb capacity 1000000");
    process.exit(1);
  }

  sm.contextCapacity = capacityVal;
  sm.save();
  console.log(`\x1b[32m✔ Success: Active context token capacity limit updated to ${capacityVal.toLocaleString()} tokens!\x1b[0m`);
}
