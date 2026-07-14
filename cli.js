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
  case "add": await handleAdd(args.slice(1).join(" ")); break;
  case "scrape": await handleScrape(args[1]); break;
  case "parse": await handleParsePdf(args[1]); break;
  case "ls": handleLs(args[1]); break;
  case "cat": handleCat(args[1]); break;
  case "grep": await handleGrep(args.slice(1).join(" ")); break;
  case "search-vector": await handleSearchVector(args.slice(1).join(" ")); break;
  case "context": await handleContext(args.slice(1).join(" ")); break;
  case "profile": handleProfile(); break;
  case "analyze": handleAnalyze(args[1]); break;
  case "seed": handleSeed(); break;
  case "clear": handleClear(); break;
  case "compaction": handleCompaction(); break;
  case "trace-start": handleTraceStart(args[1], args[2], args[3], args[4]); break;
  case "trace-append": handleTraceAppend(args[1], args[2]); break;
  case "trace-finalize": handleTraceFinalize(args[1], args[2]); break;
  case "trace-replay": handleTraceReplay(args[1]); break;
  case "trace-ingest": await handleTraceIngest(args[1]); break;
  case "trace-list": handleTraceList(); break;
  case "capacity": handleCapacity(args[1]); break;
  case "export": handleExport(args[1], args[2]); break;
  case "import": await handleImport(args[1]); break;
  case "forget-match": await handleForgetMatch(args.slice(1).join(" ")); break;
  case "review": handleReview(args[1], args[2], args[3]); break;
  case "history": handleHistory(args[1]); break;
  case "entities": handleEntities(args[1]); break;
  case "projects": handleProjects(); break;
  case "git-branch": handleGitBranch(args[1]); break;
  case "git-merge": handleGitMerge(args[1], args[2]); break;
  case "git-status": handleGitStatus(); break;
  case "privacy-log": handlePrivacyLog(); break;
  case "embed": await handleEmbedAll(); break;
  case "watch": await handleWatch(args[1] || "."); break;
  case "stats": handleStats(); break;
  case "mcp": await import('./mcp_server.js'); break;
  case "server": await import('./api.js'); break;
  case "decision": handleAddDecision(args[1], args.slice(2)); break;
  case "failure": handleAddFailure(args[1], args.slice(2)); break;
  case "change": handleAddChange(args[1], args.slice(2)); break;
  case "briefing": handleBriefing(args.slice(1)); break;
  case "evolution": handleEvolution(args.slice(1)); break;
  case "knowledge": handleAddKnowledge(args.slice(1)); break;
  case "principle": handleAddPrinciple(args.slice(1)); break;
  case "pattern": handleAddPattern(args.slice(1)); break;
  case "constraint": handleAddConstraint(args.slice(1)); break;
  case "tactic": handleAddTactic(args.slice(1)); break;
  case "observation": handleAddObservation(args.slice(1)); break;
  case "knowledge-search": handleKnowledgeSearch(args.slice(1).join(" ")); break;
  case "check-conflict": handleCheckConflict(args.slice(1).join(" ")); break;
  default:
    console.log(`\x1b[31mError: Unknown command "${command}"\x1b[0m`);
    printHelp();
    process.exit(1);
}

function printHelp() {
  console.log(`
\x1b[1;34mAlekhDB Core v2 - Lightweight GraphRAG POSIX CLI\x1b[0m
Usage: alekhdb [command] [arguments]

\x1b[36mCore Commands:\x1b[0m
  \x1b[33mseed\x1b[0m                 Populate local DB with seed datasets
  \x1b[33manalyze <dir>\x1b[0m        Recursively index a local codebase directory
  \x1b[33mscrape <url>\x1b[0m         Scrape a URL and index to graph
  \x1b[33mparse <pdf_path>\x1b[0m     Parse a local PDF file and index text to graph
  \x1b[33madd "<text>"\x1b[0m         Ingest raw text/notes, run extraction
  \x1b[33mls [path]\x1b[0m            List virtual directories of the active semantic mount
  \x1b[33mcat <file_path>\x1b[0m      Display the contents of a semantic file
  \x1b[33mgrep "<query>"\x1b[0m       Search memory using hybrid RAG
  \x1b[33msearch-vector "<query>"\x1b[0m  Vector-only search (needs embed module)
  \x1b[33mcontext "<query>"\x1b[0m     Token-aware context packing
  \x1b[33mprofile\x1b[0m              Output synthesized Markdown profile
  \x1b[33mcompaction\x1b[0m           Run preemptive context compaction
  \x1b[33mclear\x1b[0m                Reset and empty the local database
  \x1b[33mcapacity [tokens]\x1b[0m    Print or adjust the active context window capacity

\x1b[36mMemory Lifecycle:\x1b[0m
  \x1b[33mreview list|approve|decline|undo <id>\x1b[0m  Manage inferred memories
  \x1b[33mforget-match "<query>"\x1b[0m  Agentic mass-forget matching memories
  \x1b[33mhistory <id>\x1b[0m          View version history of a memory
  \x1b[33mexport [scope] [file]\x1b[0m  Export memories as JSON
  \x1b[33mimport <file>\x1b[0m         Import memories from JSON

\x1b[36mEpisodic Traces:\x1b[0m
  \x1b[33mtrace-start <id> <agent> <session> <task>\x1b[0m  Start a trace
  \x1b[33mtrace-append <id> '<json>'\x1b[0m                 Append frame to trace
  \x1b[33mtrace-finalize <id> <outcome>\x1b[0m              Lock trace
  \x1b[33mtrace-replay <id>\x1b[0m                          Print trace replay
  \x1b[33mtrace-ingest <id>\x1b[0m                          Bridge trace into graph
  \x1b[33mtrace-list\x1b[0m                                 List all traces

\x1b[36mReasoning Memory (v3):\x1b[0m
  \x1b[33mdecision <id> --chosen <x> --rationale <text> [--alt a b c]\x1b[0m  Store a decision
  \x1b[33mfailure <id> --approach <text> [--error <text>]\x1b[0m               Store a failure memory
  \x1b[33mchange <id> --removed <x> --added <z> [--justification <text>]\x1b[0m  Store a change
  \x1b[33mbriefing [--since <date>] [--until <date>]\x1b[0m      Cross-session briefing
  \x1b[33mevolution [--since <date>] [--bucket day|week|month]\x1b[0m  Temporal trends
  \x1b[33mknowledge <id> --type <t> [flags]\x1b[0m     Store any knowledge type generically
  \x1b[33mprinciple <id> --rule <text> [flags]\x1b[0m  Store a principle/heuristic
  \x1b[33mpattern <id> --symptoms <t> --rootCause <t>\x1b[0m  Store a failure pattern
  \x1b[33mconstraint <id> --invariant <text>\x1b[0m      Store an architectural constraint
  \x1b[33mtactic <id> --situation <t> --approach <t>\x1b[0m  Store a proven tactic
  \x1b[33mobservation <id> --observation <text>\x1b[0m   Store an observation/insight
  \x1b[33mknowledge-search [--types ...] [--scope s]\x1b[0m  Search knowledge graph
  \x1b[33mcheck-conflict --type <t> [--chosen <x>] [--rule <r>]\x1b[0m  Pre-action conflict check

\x1b[36mIDE & Integration:\x1b[0m
  \x1b[33mgit-status\x1b[0m            Show current git branch and memory scope
  \x1b[33mgit-branch <name>\x1b[0m     Switch memory scope to branch
  \x1b[33mgit-merge <from> <to>\x1b[0m Merge branch memories
  \x1b[33mprivacy-log\x1b[0m          Show PII redaction audit log
  \x1b[33membed\x1b[0m                Re-embed all memories
  \x1b[33mwatch <path>\x1b[0m         Start file watcher
  \x1b[33mstats\x1b[0m                System observability
  \x1b[33mentities [type]\x1b[0m      List entities in memory
  \x1b[33mprojects\x1b[0m             List all scopes
  \x1b[33mmcp\x1b[0m                  Start MCP server (stdin/stdout)
  \x1b[33mserver\x1b[0m               Start REST API server

\x1b[36mExamples:\x1b[0m
  $ alekhdb seed
  $ alekhdb analyze .
  $ alekhdb stats
  `);
}

async function handleAdd(text) {
  if (!text) { console.log("\x1b[31mError: Please provide a text fact to ingest.\x1b[0m"); process.exit(1); }
  console.log(`\x1b[36mIngesting fact: "${text}"...\x1b[0m`);
  const result = await sm.addMemory(text);
  console.log("\x1b[32mSuccess: Knowledge ingested and indexed into Graph.\x1b[0m");
  if (result.conflict) console.log(`\n\x1b[1;31m[!] ${result.conflict}\x1b[0m`);
  console.log(`Extracted Nodes: ${result.nodes.join(", ") || "None"}`);
  console.log(`Active Connections Created: ${result.edges.length}`);
  sm._flushSave();
}

function handleLs(lsPath = "/memory") {
  const normPath = lsPath.replace(/\/$/, "");
  console.log(`\x1b[34mListing directory contents of: ${normPath}\x1b[0m`);
  if (normPath === "" || normPath === "/" || normPath === "/memory") {
    console.log(`\ndrwxr-xr-x   trident   staff   128 B   \x1b[1;36muser/\x1b[0m\ndrwxr-xr-x   trident   staff   128 B   \x1b[1;36mprojects/\x1b[0m\ndrwxr-xr-x   trident   staff   128 B   \x1b[1;36mtraces/\x1b[0m\n-rw-r--r--   trident   staff   2.4 KB  \x1b[32mprofile.md\x1b[0m\n-rw-r--r--   trident   staff   1.1 KB  \x1b[32mconflicts.log\x1b[0m`);
  } else if (normPath === "/memory/user") {
    const clients = sm.nodes.filter(n => n.type === "client").map(n => n.id + ".txt");
    console.log(`drwxr-xr-x   trident   staff   128 B   \x1b[1;36mpreferences/\x1b[0m`);
    clients.forEach(c => console.log(`-rw-r--r--   trident   staff   312 B   \x1b[32m${c}\x1b[0m`));
  } else if (normPath === "/memory/user/preferences") {
    console.log(`-rw-r--r--   trident   staff   184 B   \x1b[32mdiet.txt\x1b[0m\n-rw-r--r--   trident   staff   184 B   \x1b[32mstack.txt\x1b[0m`);
  } else if (normPath === "/memory/projects") {
    const files = sm.nodes.filter(n => n.type === "file").map(n => n.label);
    const classes = sm.nodes.filter(n => n.type === "class").map(n => n.label + ".class");
    console.log(`-rw-r--r--   trident   staff   512 B   \x1b[32malekhdb.jsonc\x1b[0m`);
    files.forEach(f => console.log(`-rw-r--r--   trident   staff   1.2 KB  \x1b[32m${f}\x1b[0m`));
    classes.forEach(c => console.log(`-rw-r--r--   trident   staff   600 B   \x1b[32m${c}\x1b[0m`));
  } else if (normPath === "/memory/traces") {
    console.log(`\ndrwxr-xr-x   trident   staff   128 B   \x1b[1;36mopen/\x1b[0m\ndrwxr-xr-x   trident   staff   128 B   \x1b[1;36mfinalized/\x1b[0m`);
    sm.traces.forEach(t => console.log(`-rw-r--r--   trident   staff   512 B   \x1b[32m${t.traceId}.trace\x1b[0m`));
  } else if (normPath === "/memory/traces/open") {
    const openTraces = sm.traces.filter(t => t.status === "open");
    if (openTraces.length === 0) console.log("No active open traces.");
    else openTraces.forEach(t => console.log(`-rw-r--r--   trident   staff   512 B   \x1b[32m${t.traceId}.trace\x1b[0m`));
  } else if (normPath === "/memory/traces/finalized") {
    const finalizedTraces = sm.traces.filter(t => t.status === "finalized");
    if (finalizedTraces.length === 0) console.log("No finalized traces.");
    else finalizedTraces.forEach(t => console.log(`-rw-r--r--   trident   staff   512 B   \x1b[32m${t.traceId}.trace\x1b[0m`));
  } else { console.log(`\x1b[31mls: ${lsPath}: No such file or directory\x1b[0m`); }
}

function handleCat(catPath) {
  if (!catPath) { console.log("\x1b[31mError: Please specify a file path to cat.\x1b[0m"); process.exit(1); }
  const normPath = catPath.toLowerCase().replace(/\/$/, "");
  if (normPath.includes("profile.md")) { console.log(sm.profile()); }
  else if (normPath.includes("conflicts.log")) {
    console.log("\n\x1b[1;31m--- CHRONOLOGICAL CONTRADICTION & MUTATION AUDIT TRAIL ---\x1b[0m");
    const conflictLogs = sm.auditLog.filter(l => l.event === "CONTRADICTION_RESOLVED" || l.event === "PREFERENCE_UPDATE");
    if (conflictLogs.length === 0) console.log("No logical memory clashes resolved yet. Database stack is consistent.");
    else conflictLogs.forEach(l => console.log(`\x1b[33m[${l.timestamp}]\x1b[0m \x1b[36m(${l.event})\x1b[0m: ${l.description}`));
  } else if (normPath.includes(".trace")) {
    const baseName = normPath.split("/").pop().replace(/\.trace$/, "");
    const trace = sm.traces.find(t => t.traceId.toLowerCase() === baseName);
    if (trace) handleTraceReplay(trace.traceId);
    else console.log(`\x1b[31mcat: ${catPath}: Trace file not found\x1b[0m`);
  } else if (normPath.includes("diet.txt")) {
    console.log(`# Synthesized Dietary Preference\n* Active Contact: Sarah (Product Lead)\n* Diet preference: Vegan (Strict preference registered in account history).`);
  } else if (normPath.includes("stack.txt")) {
    const activeBackend = sm.edges.find(e => e.label === "uses_backend" && e.active);
    const runtime = activeBackend ? sm.nodes.find(n => n.id === activeBackend.target) : null;
    console.log(`# Synthesized Stack Preference\n* Active Backend Runtime: ${runtime ? runtime.label : "Node.js (Stale)"}\n* Database storage: SQLite`);
  } else if (normPath.includes("alekhdb.jsonc")) {
    console.log(`{"apiKey": "sm_live_node_cli_token_9x12","defaultScope": "work","syncIntervalSeconds": 60,"localMountPath": "/memory"}`);
  } else if (normPath.endsWith(".txt") || normPath.endsWith(".class") || normPath.endsWith(".js")) {
    const baseName = normPath.split("/").pop().replace(/\.(txt|class|js)$/, "");
    const matchingNode = sm.nodes.find(n => n.id.includes(baseName) || n.label.toLowerCase().includes(baseName));
    if (matchingNode) { console.log(`# Node Meta Properties: ${matchingNode.label}`); console.log(JSON.stringify(matchingNode.properties, null, 2)); }
    else console.log(`\x1b[31mcat: ${catPath}: File not found\x1b[0m`);
  } else { console.log(`\x1b[31mcat: ${catPath}: No such file\x1b[0m`); }
}

async function handleGrep(query) {
  if (!query) { console.log("\x1b[31mError: Please provide a search query for grep.\x1b[0m"); process.exit(1); }
  console.log(`\x1b[36mRunning semantic RAG grep for: "${query}"...\x1b[0m`);
  const results = await sm.search(query);
  console.log(results.synthesis);
}

async function handleSearchVector(query) {
  if (!query) { console.log("\x1b[31mError: Please provide a search query.\x1b[0m"); process.exit(1); }
  console.log(`\x1b[36mRunning vector search for: "${query}"...\x1b[0m`);
  if (sm._embedFn) { const results = await sm.searchVector(query); console.log(JSON.stringify(results.results.slice(0, 5), null, 2)); }
  else console.log("\x1b[33mEmbeddings not enabled. Use: npm install @huggingface/transformers and enableEmbeddings()\x1b[0m");
}

async function handleContext(query) {
  if (!query) { console.log("\x1b[31mError: Please provide a query.\x1b[0m"); process.exit(1); }
  const { getContext } = await import('./alekhdb-context.js');
  const ctx = await getContext(sm, { query, maxTokens: 2000 });
  process.stdout.write(ctx.context + '\n');
}

function handleProfile() { console.log(sm.profile()); }

function handleSeed() {
  console.log("\x1b[36mSeeding local memory database with initial datasets...\x1b[0m");
  sm.autoSave = false;
  sm.clearToDefault();
  initialNodes.forEach(node => sm.addNode(node.id, node.label, node.type, node.properties, node.scope));
  initialEdges.forEach(edge => sm.addEdge(edge.id, edge.source, edge.target, edge.label, edge.weight, edge.active));
  if (Array.isArray(initialTraces)) sm.traces = JSON.parse(JSON.stringify(initialTraces));
  if (Array.isArray(initialEventFrames)) sm.eventFrames = JSON.parse(JSON.stringify(initialEventFrames));
  sm.logAudit("DB_SEED", "Preloaded database with software, B2B Sales, Legal, and Episodic Traces.");
  sm.autoSave = true;
  sm.save();
  console.log("\x1b[32mSuccess: Local database seeded. Active nodes: " + sm.nodes.length + ", Edges: " + sm.edges.length + ", Traces: " + sm.traces.length + "\x1b[0m");
}

function handleClear() { sm.clearToDefault(); console.log("\x1b[32mSuccess: Database wiped clean.\x1b[0m"); }
function handleCompaction() { console.log("\x1b[36mRunning active context window compaction...\x1b[0m"); const summaryId = sm.compaction(); console.log(`\x1b[32mSuccess: Context compacted. Generated summary node: ${summaryId}\x1b[0m`); sm._flushSave(); }

function walkDir(dir, fileList = []) {
  try { const files = fs.readdirSync(dir); for (const file of files) { if (file === "node_modules" || file === ".git" || file === ".gemini" || file === "dist") continue; const filePath = path.join(dir, file); const stat = fs.statSync(filePath); if (stat.isDirectory()) walkDir(filePath, fileList); else if (stat.isFile() && (file.endsWith(".js") || file.endsWith(".mjs"))) fileList.push(filePath); } }
  catch (err) { console.error("Failed to read directory:", err.message); }
  return fileList;
}

function handleAnalyze(targetDir = ".") {
  console.log(`\n\x1b[36mInitializing codebase directory scan in: ${targetDir} ...\x1b[0m`);
  const files = walkDir(targetDir);
  console.log(`Located ${files.length} code files. Starting AST-Aware structural chunking...`);
  let nodesCount = 0;
  for (const file of files) {
    try { const code = fs.readFileSync(file, "utf8"); const relativePath = path.relative(process.cwd(), file); const res = sm.astChunkCode(code, relativePath); console.log(`  \x1b[32m✔ Indexed:\x1b[0m ${relativePath} (Extracted ${res.nodes.length} nodes)`); nodesCount += res.nodes.length; }
    catch (err) { console.error(`  \x1b[31m✖ Failed to parse ${file}:\x1b[0m`, err.message); }
  }
  console.log(`\n\x1b[1;32mCodebase analysis complete! Index size expanded by ${nodesCount} structural nodes.\x1b[0m`);
  sm._flushSave();
}

async function handleScrape(url) {
  if (!url) { console.log("\x1b[31mError: Please provide a URL to scrape.\x1b[0m"); process.exit(1); }
  console.log(`\n\x1b[36mInitializing scraper for URL: ${url} ...\x1b[0m`);
  try { const res = await sm.scrapeUrl(url); console.log(`\x1b[32m✔ Scraping Successful!\x1b[0m\n  Source Engine: \x1b[36m${res.source}\x1b[0m\n  Extracted Document Node: \x1b[36m${res.nodes.join(", ")}\x1b[0m\n  Preview (150 chars): "${res.text.slice(0, 150)}..."`); }
  catch (err) { console.error(`\x1b[31m✖ Scraping Failed:\x1b[0m`, err.message); }
}

async function handleParsePdf(pdfPath) {
  if (!pdfPath) { console.log("\x1b[31mError: Please provide a path to a PDF file to parse.\x1b[0m"); process.exit(1); }
  console.log(`\n\x1b[36mInitializing PDF Parser for file: ${pdfPath} ...\x1b[0m`);
  try { const res = await sm.parsePdfFile(pdfPath); console.log(`\x1b[32m✔ PDF Parsing Successful!\x1b[0m\n  Extracted Document Node: \x1b[36m${res.nodes.join(", ")}\x1b[0m\n  Document Title: \x1b[36m${res.metadata?.Title || "N/A"}\x1b[0m\n  Preview (150 chars): "${res.text.slice(0, 150)}..."`); }
  catch (err) { console.error(`\x1b[31m✖ PDF Parsing Failed:\x1b[0m`, err.message); }
}

function handleTraceStart(traceId, agentId, sessionId, taskId) {
  if (!traceId) { console.log("\x1b[31mError: Please provide a traceId.\x1b[0m"); process.exit(1); }
  console.log(`\x1b[36mStarting active trace attempt: ${traceId}...\x1b[0m`);
  try { const trace = sm.startTrace(traceId, agentId, sessionId, taskId); console.log(`\x1b[32m✔ Trace started:\x1b[0m\n  Trace ID: ${trace.traceId}\n  Agent: ${trace.agentId}\n  Task Name: ${trace.taskId}`); sm._flushSave(); }
  catch (err) { console.error(`\x1b[31m✖ Trace Start Failed:\x1b[0m`, err.message); }
}

function handleTraceAppend(traceId, jsonStr) {
  if (!traceId || !jsonStr) { console.log("\x1b[31mError: Missing traceId or event frame JSON payload.\x1b[0m"); process.exit(1); }
  console.log(`\x1b[36mAppending event frame to trace ${traceId}...\x1b[0m`);
  try { const frameData = JSON.parse(jsonStr); const frame = sm.appendEventFrame(traceId, frameData); console.log(`\x1b[32m✔ Frame #${frame.stepIdx} appended:\x1b[0m\n  Timestamp: ${frame.ts}\n  Error Signature: ${frame.errorSignature || "None"}`); sm._flushSave(); }
  catch (err) { console.error(`\x1b[31m✖ Frame Append Failed:\x1b[0m`, err.message); }
}

function handleTraceFinalize(traceId, outcome) {
  if (!traceId || !outcome) { console.log("\x1b[31mError: Missing traceId or outcome.\x1b[0m"); process.exit(1); }
  console.log(`\x1b[36mFinalizing trace ${traceId} with outcome: ${outcome}...\x1b[0m`);
  try { const trace = sm.finalizeTrace(traceId, outcome); console.log(`\x1b[32m✔ Trace finalized.\x1b[0m\n  Outcome: ${trace.outcome}\n  Locked at: ${trace.finalizedAt}`); sm._flushSave(); }
  catch (err) { console.error(`\x1b[31m✖ Trace Finalization Failed:\x1b[0m`, err.message); }
}

function handleTraceReplay(traceId) {
  if (!traceId) { console.log("\x1b[31mError: Please specify a traceId to replay.\x1b[0m"); process.exit(1); }
  try { const data = sm.replayTrace(traceId); console.log(`\n\x1b[1;35m========================================================\x1b[0m\n\x1b[1;35m    EPISODIC TRACE REPLAY: ${data.trace.traceId}         \x1b[0m\n\x1b[1;35m========================================================\x1b[0m\n\x1b[36mTask Name   :\x1b[0m ${data.trace.taskId}\n\x1b[36mAgent ID    :\x1b[0m ${data.trace.agentId}\n\x1b[36mSession ID  :\x1b[0m ${data.trace.sessionId}\n\x1b[36mStatus      :\x1b[0m ${data.trace.status.toUpperCase()}\n\x1b[36mOutcome     :\x1b[0m ${data.trace.outcome === "success" ? "\x1b[32mSUCCESS\x1b[0m" : "\x1b[31mFAILURE\x1b[0m"}\n\x1b[36mStarted At  :\x1b[0m ${data.trace.createdAt}`); if (data.trace.finalizedAt) console.log(`\x1b[36mLocked At   :\x1b[0m ${data.trace.finalizedAt}`); console.log(`\x1b[1;35m--------------------------------------------------------\x1b[0m`); if (data.frames.length === 0) console.log(`  No chronological steps recorded in this trace.`); else data.frames.forEach(frame => { console.log(`\n\x1b[1;33m[Step #${frame.stepIdx}] [${frame.ts}]\x1b[0m`); console.log(`  \x1b[36mTool Call :\x1b[0m ${JSON.stringify(frame.toolCallJson)}\n  \x1b[36mResponse  :\x1b[0m ${JSON.stringify(frame.toolResultJson)}\n  \x1b[36mSnapshot  :\x1b[0m ${JSON.stringify(frame.stateSnapshotJson)}`); if (frame.errorSignature) console.log(`  \x1b[1;31mError Sig :\x1b[0m \x1b[1;31m${frame.errorSignature}\x1b[0m`); if (frame.extractedBeliefs && frame.extractedBeliefs.length > 0) console.log(`  \x1b[32mBeliefs   :\x1b[0m \x1b[32m${frame.extractedBeliefs.join(", ")}\x1b[0m`); }); console.log(`\n\x1b[1;35m========================================================\x1b[0m\n`); }
  catch (err) { console.error(`\x1b[31m✖ Trace Replay Failed:\x1b[0m`, err.message); }
}

async function handleTraceIngest(traceId) {
  if (!traceId) { console.log("\x1b[31mError: Please specify a traceId to ingest.\x1b[0m"); process.exit(1); }
  console.log(`\x1b[36mBridging episodic trace ${traceId} into permanent Ontological Graph...\x1b[0m`);
  try { const result = await sm.ingestTraceAsMemory(traceId); console.log(`\x1b[32m✔ Trace Ingestion Successful!\x1b[0m\n  Created Trace Node ID: \x1b[36m${result.traceNodeId}\x1b[0m\n  Extracted Belief Nodes: \x1b[36m${result.nodes.join(", ") || "None"}\x1b[0m\n  Active Relationships Created: \x1b[36m${result.edges.length}\x1b[0m`); if (result.conflict) console.log(`\n\x1b[1;31m[!] TMS Belief Audit Log:\n    ${result.conflict}\x1b[0m`); sm._flushSave(); }
  catch (err) { console.error(`\x1b[31m✖ Trace Ingestion Failed:\x1b[0m`, err.message); }
}

function handleTraceList() {
  console.log(`\n\x1b[34m--- ACTIVE & HISTORICAL EPISODIC TRACES ---\x1b[0m`);
  if (sm.traces.length === 0) console.log("No episodic traces recorded in database. Mount is empty.");
  else sm.traces.forEach(t => { const outcomeText = t.outcome === "success" ? "\x1b[32mSUCCESS\x1b[0m" : (t.outcome === "failure" ? "\x1b[31mFAILURE\x1b[0m" : "\x1b[33mUNKNOWN\x1b[0m"); const statusText = t.status === "finalized" ? "\x1b[35m[FINALIZED]\x1b[0m" : "\x1b[36m[OPEN]\x1b[0m"; console.log(`* \x1b[33m${t.traceId}\x1b[0m ${statusText} - Task: ${t.taskId} (Outcome: ${outcomeText}, Agent: ${t.agentId})`); });
  console.log("");
}

function handleCapacity(capacityArg) {
  if (!capacityArg) { console.log(`\n\x1b[34m--- ACTIVE CONTEXT WINDOW CAPACITY ---\x1b[0m\nCurrent Context Capacity: \x1b[36m${sm.contextCapacity.toLocaleString()}\x1b[0m tokens\nActive Memory Token Usage: \x1b[36m${sm.calculateActiveTokens().toLocaleString()}\x1b[0m tokens\nCompaction Threshold (80%): \x1b[33m${(sm.contextCapacity * 0.8).toLocaleString()}\x1b[0m tokens\n`); return; }
  const capacityVal = parseInt(capacityArg);
  if (isNaN(capacityVal) || capacityVal < 8000 || capacityVal > 1000000) { console.log("\x1b[31mError: Capacity must be a number between 8,000 and 1,000,000 tokens.\x1b[0m"); process.exit(1); }
  sm.contextCapacity = capacityVal;
  sm.save();
  console.log(`\x1b[32m✔ Success: Active context token capacity limit updated to ${capacityVal.toLocaleString()} tokens!\x1b[0m`);
}

function handleExport(scopeArg, filePath) {
  const data = sm.export({ scope: scopeArg || null });
  if (filePath) { fs.writeFileSync(filePath, data, 'utf8'); console.log(`\x1b[32m✔ Exported to ${filePath}\x1b[0m`); }
  else process.stdout.write(data + '\n');
}

async function handleImport(filePath) {
  if (!filePath || !fs.existsSync(filePath)) { console.log("\x1b[31mError: File not found.\x1b[0m"); process.exit(1); }
  const jsonStr = fs.readFileSync(filePath, 'utf8');
  const result = sm.import(jsonStr, { merge: true });
  console.log(`\x1b[32m✔ Imported ${result.nodes} nodes, ${result.edges} edges\x1b[0m`);
  sm._flushSave();
}

async function handleForgetMatch(query) {
  if (!query) { console.log("\x1b[31mError: Provide a query.\x1b[0m"); process.exit(1); }
  console.log(`\x1b[36mPreview: memories matching "${query}"...\x1b[0m`);
  const preview = await sm.forgetMatch({ query, dryRun: true });
  console.log(`\x1b[33mWould forget ${preview.matched} memories:\x1b[0m`);
  preview.matches.forEach(m => console.log(`  - ${m.id}: ${m.label}`));
  const { default: readline } = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\x1b[33mExecute forget? (y/N):\x1b[0m ', async (answer) => {
    if (answer.toLowerCase() === 'y') { const result = await sm.forgetMatch({ query, dryRun: false }); console.log(`\x1b[32m✔ Forgotten ${result.forgotten} memories\x1b[0m`); sm._flushSave(); }
    else console.log('Cancelled.');
    rl.close();
  });
}

function handleReview(action, memoryId, scope) {
  if (!action) { console.log("\x1b[31mError: Provide action (list|approve|decline|undo).\x1b[0m"); process.exit(1); }
  if (action === 'list') { const list = sm.review.list({ scope: scope || sm.currentScope }); console.log(JSON.stringify(list, null, 2)); }
  else if (!memoryId) { console.log("\x1b[31mError: Provide memoryId.\x1b[0m"); process.exit(1); }
  else { let result; if (action === 'approve') result = sm.review.approve(memoryId); else if (action === 'decline') result = sm.review.decline(memoryId); else if (action === 'undo') result = sm.review.undo(memoryId); else { console.log("\x1b[31mInvalid action.\x1b[0m"); process.exit(1); } console.log(JSON.stringify(result, null, 2)); sm._flushSave(); }
}

function handleHistory(memoryId) {
  if (!memoryId) { console.log("\x1b[31mError: Provide memoryId.\x1b[0m"); process.exit(1); }
  const history = sm.getHistory(memoryId);
  console.log(JSON.stringify(history, null, 2));
}

function handleEntities(entityType) {
  const entities = sm.nodes.filter(n => (!entityType || n.type === entityType) && !n.isForgotten).map(n => ({ id: n.id, label: n.label, type: n.type, scope: n.scope }));
  console.log(JSON.stringify(entities, null, 2));
}

function handleProjects() {
  const scopes = [...new Set(sm.nodes.map(n => n.scope))].filter(Boolean);
  console.log(scopes.join('\n'));
}

function handleGitBranch(branch) {
  if (!branch) { console.log(`\x1b[33mCurrent branch scope: ${sm.getScope()}\x1b[0m`); return; }
  if (sm._gitApi) { sm._gitApi.setBranch(branch); console.log(`\x1b[32m✔ Switched to branch: ${branch}\x1b[0m`); sm._flushSave(); }
  else console.log("\x1b[33mGit module not enabled.\x1b[0m");
}

async function handleGitMerge(fromBranch, toBranch) {
  if (!fromBranch || !toBranch) { console.log("\x1b[31mError: Provide from and to branches.\x1b[0m"); process.exit(1); }
  if (sm._gitApi) { const result = await sm._gitApi.mergeBranch(fromBranch, toBranch); console.log(JSON.stringify(result)); sm._flushSave(); }
  else console.log("\x1b[33mGit module not enabled.\x1b[0m");
}

function handleGitStatus() {
  if (sm._gitApi) { console.log(JSON.stringify(sm._gitApi.getStatus(), null, 2)); }
  else console.log("\x1b[33mGit module not enabled.\x1b[0m");
}

function handlePrivacyLog() {
  if (sm.getPrivacyLog) { const log = sm.getPrivacyLog(); console.log(JSON.stringify(log, null, 2)); }
  else console.log("\x1b[33mPrivacy module not enabled.\x1b[0m");
}

async function handleEmbedAll() {
  if (sm.embedAll) { const count = await sm.embedAll(); console.log(`\x1b[32m✔ Embedded ${count} memories\x1b[0m`); sm._flushSave(); }
  else console.log("\x1b[33mEmbed module not enabled.\x1b[0m");
}

async function handleWatch(watchPath) {
  try { const { enableWatcher } = await import('./alekhdb-watcher.js'); const w = await enableWatcher(sm, { paths: [watchPath] }); console.log(`\x1b[32m✔ Watching ${watchPath} (ctrl+c to stop)\x1b[0m`); process.on('SIGINT', () => { w.stop(); process.exit(0); }); }
  catch (err) { console.error(`\x1b[31mFailed to start watcher:\x1b[0m`, err.message); }
}

function handleStats() { console.log(JSON.stringify(sm.stats(), null, 2)); }

function handleAddDecision(id, rest) {
  if (!id) { console.log("\x1b[31mUsage: alekhdb decision <id> --chosen <x> --rationale <text> [--alt a b c] [--context <text>]\x1b[0m"); return; }
  const parsed = parseFlags(rest);
  if (!parsed.chosen) { console.log("\x1b[31mError: --chosen is required\x1b[0m"); return; }
  sm.addDecision(id, { context: parsed.context || "", alternatives: parsed.alt ? (Array.isArray(parsed.alt) ? parsed.alt : parsed.alt.split(",")) : [], chosen: parsed.chosen, rationale: parsed.rationale || "" });
  sm._flushSave();
  console.log(`\x1b[32mDecision stored: ${parsed.chosen}\x1b[0m`);
}

function handleAddFailure(id, rest) {
  if (!id) { console.log("\x1b[31mUsage: alekhdb failure <id> --approach <text> [--error <text>] [--error-signature <sig>] [--context <text>]\x1b[0m"); return; }
  const parsed = parseFlags(rest);
  if (!parsed.approach) { console.log("\x1b[31mError: --approach is required\x1b[0m"); return; }
  sm.addFailure(id, { approach: parsed.approach, error: parsed.error || "", errorSignature: parsed["error-signature"] || "", context: parsed.context || "" });
  sm._flushSave();
  console.log(`\x1b[32mFailure stored: ${parsed.approach}\x1b[0m`);
}

function handleAddChange(id, rest) {
  if (!id) { console.log("\x1b[31mUsage: alekhdb change <id> --removed <x> --added <z> [--removed-reason <text>] [--added-reason <text>] [--justification <text>]\x1b[0m"); return; }
  const parsed = parseFlags(rest);
  if (!parsed.removed || !parsed.added) { console.log("\x1b[31mError: --removed and --added are required\x1b[0m"); return; }
  sm.addChange(id, { removed: parsed.removed, removedReason: parsed["removed-reason"] || "", added: parsed.added, addedReason: parsed["added-reason"] || "", justification: parsed.justification || "" });
  sm._flushSave();
  console.log(`\x1b[32mChange stored: ${parsed.removed} → ${parsed.added}\x1b[0m`);
}

function handleBriefing(rest) {
  const parsed = parseFlags(rest);
  const briefing = sm.getBriefing({ since: parsed.since, until: parsed.until, sessionIds: parsed["session-ids"] ? parsed["session-ids"].split(",") : undefined });
  console.log(briefing.context);
}

function handleEvolution(rest) {
  const parsed = parseFlags(rest);
  const evo = sm.getEvolution({ since: parsed.since, until: parsed.until, bucket: parsed.bucket || "day", scope: parsed.scope });
  console.log(JSON.stringify(evo, null, 2));
}

function handleAddKnowledge(rest) {
  const id = rest[0];
  if (!id) { console.log("\x1b[31mUsage: alekhdb knowledge <id> --type <type> [--rule <text>] [...]\x1b[0m"); return; }
  const parsed = parseFlags(rest.slice(1));
  if (!parsed.type) { console.log("\x1b[31mError: --type is required (decision, failure, change, principle, pattern, constraint, tactic, observation)\x1b[0m"); return; }
  const { type, ...data } = parsed;
  sm.addKnowledge(type, id, data);
  sm._flushSave();
  console.log(`\x1b[32mKnowledge stored: ${id} (${type})\x1b[0m`);
}

function handleAddPrinciple(rest) {
  const id = rest[0];
  if (!id) { console.log("\x1b[31mUsage: alekhdb principle <id> --rule <text> [--context <text>] [--exceptions <text>] [--importance <1-5>]\x1b[0m"); return; }
  const parsed = parseFlags(rest.slice(1));
  if (!parsed.rule) { console.log("\x1b[31mError: --rule is required\x1b[0m"); return; }
  sm.addKnowledge('principle', id, parsed);
  sm._flushSave();
  console.log(`\x1b[32mPrinciple stored: ${id}\x1b[0m`);
}

function handleAddPattern(rest) {
  const id = rest[0];
  if (!id) { console.log("\x1b[31mUsage: alekhdb pattern <id> --symptoms <text> --rootCause <text> [--fix <text>] [--frequency common|rare]\x1b[0m"); return; }
  const parsed = parseFlags(rest.slice(1));
  if (!parsed.symptoms || !parsed.rootCause) { console.log("\x1b[31mError: --symptoms and --rootCause are required\x1b[0m"); return; }
  sm.addKnowledge('pattern', id, parsed);
  sm._flushSave();
  console.log(`\x1b[32mPattern stored: ${id}\x1b[0m`);
}

function handleAddConstraint(rest) {
  const id = rest[0];
  if (!id) { console.log("\x1b[31mUsage: alekhdb constraint <id> --invariant <text> [--why <text>] [--enforcement auto|manual|unenforced]\x1b[0m"); return; }
  const parsed = parseFlags(rest.slice(1));
  if (!parsed.invariant) { console.log("\x1b[31mError: --invariant is required\x1b[0m"); return; }
  sm.addKnowledge('constraint', id, parsed);
  sm._flushSave();
  console.log(`\x1b[32mConstraint stored: ${id}\x1b[0m`);
}

function handleAddTactic(rest) {
  const id = rest[0];
  if (!id) { console.log("\x1b[31mUsage: alekhdb tactic <id> --situation <text> --approach <text> [--steps <text>] [--risks <text>]\x1b[0m"); return; }
  const parsed = parseFlags(rest.slice(1));
  if (!parsed.situation || !parsed.approach) { console.log("\x1b[31mError: --situation and --approach are required\x1b[0m"); return; }
  sm.addKnowledge('tactic', id, parsed);
  sm._flushSave();
  console.log(`\x1b[32mTactic stored: ${id}\x1b[0m`);
}

function handleAddObservation(rest) {
  const id = rest[0];
  if (!id) { console.log("\x1b[31mUsage: alekhdb observation <id> --observation <text> [--context <text>] [--implications <text>] [--confidence proven|theorized|challenged]\x1b[0m"); return; }
  const parsed = parseFlags(rest.slice(1));
  if (!parsed.observation) { console.log("\x1b[31mError: --observation is required\x1b[0m"); return; }
  sm.addKnowledge('observation', id, parsed);
  sm._flushSave();
  console.log(`\x1b[32mObservation stored: ${id}\x1b[0m`);
}

function handleKnowledgeSearch(queryStr) {
  const parsed = parseFlags(queryStr.split(' '));
  const results = sm.searchKnowledge(parsed);
  console.log(JSON.stringify(results, null, 2));
}

function handleCheckConflict(queryStr) {
  const parsed = parseFlags(queryStr.split(' '));
  if (!parsed.type) { console.log("\x1b[31mError: --type is required\x1b[0m"); return; }
  const warnings = sm.checkConflict({ type: parsed.type, data: parsed });
  if (warnings.length === 0) {
    console.log("\x1b[32mNo conflicts detected.\x1b[0m");
  } else {
    console.log(JSON.stringify(warnings, null, 2));
  }
}

function parseFlags(arr) {
  const result = {};
  let key = null;
  for (const arg of arr) {
    if (arg.startsWith("--")) { key = arg.slice(2); result[key] = true; }
    else if (key) { if (result[key] === true) result[key] = arg; else if (Array.isArray(result[key])) result[key].push(arg); else result[key] = arg; }
  }
  return result;
}
