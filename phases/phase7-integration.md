# Phase 7 — Integration

> **Edit**: `mcp_server.js`, `api.js`, `cli.js`, `doctor.js`
> **New deps**: ZERO
> **Goal**: Expose all new features via MCP (12+ tools), REST (25+ endpoints), CLI (20+ commands)
> **Depends on**: All previous phases (1-6)

---

## Context

**Current MCP** (`mcp_server.js`, 151 lines): 3 tools (`alekhdb_add`, `alekhdb_search`, `alekhdb_profile`). stdin/stdout JSON-RPC. No streaming. No optional module tools.

**Current REST** (`api.js`, 411 lines): ~15 endpoints covering ingest, search, graph, audit, compact, prune, traces, upload (multimodal), cluster.

**Current CLI** (`cli.js`, 546 lines): 17 commands.

Mem0 has 9 MCP tools. Supermemory has 6 MCP tools + 5 resources. We need to match + exceed.

---

## Step 7.1: Expanded MCP Server (`mcp_server.js`)

### Rewrite `tools/list` response:

```javascript
if (method === "tools/list") {
  sendResponse(id, {
    tools: [
      // === Core memory tools (always available) ===
      {
        name: "alekhdb_add",
        description: "Save a memory, extracting facts (optionally via Ollama LLM). Supports conversationContext, forgetAfter, memoryType.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "The raw fact or conversation to ingest" },
            scope: { type: "string", description: "Container tag scope (default: current)" },
            forgetAfter: { type: "string", description: "ISO date when this memory expires (optional)" },
            conversationContext: { type: "array", items: { type: "object" }, description: "Prior conversation for contextual extraction" },
          },
          required: ["text"],
        },
      },
      {
        name: "alekhdb_search",
        description: "Keyword + graph search (always available). Multi-hop configurable.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            scope: { type: "string" },
            maxDepth: { type: "number", description: "Graph traversal depth (default 1)" },
            filters: { type: "object", description: "AND/OR filter expressions" },
          },
          required: ["query"],
        },
      },
      {
        name: "alekhdb_search_hybrid",
        description: "Multi-signal fusion search (keyword + vector + entity + temporal + cognitive). Requires embeddings enabled for vector signal.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            scope: { type: "string" },
            signals: { type: "object", description: "Signal weights" },
            rerank: { type: "boolean" },
            threshold: { type: "number" },
            limit: { type: "number" },
          },
          required: ["query"],
        },
      },
      {
        name: "alekhdb_get_context",
        description: "Token-aware context packing. Returns prompt-ready markdown string within a token budget. Includes profile + memories + relations.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            maxTokens: { type: "number", description: "Token budget (default 4000)" },
            includeProfile: { type: "boolean" },
            includeRelations: { type: "boolean" },
            scope: { type: "string" },
          },
          required: ["query"],
        },
      },
      {
        name: "alekhdb_profile",
        description: "Get static + dynamic user profile. One call, ~0.1ms. Returns markdown.",
        inputSchema: {
          type: "object",
          properties: {
            scope: { type: "string" },
            structured: { type: "boolean", description: "Return structured JSON instead of markdown" },
          },
        },
      },
      // === Memory lifecycle ===
      {
        name: "alekhdb_review_inferred",
        description: "Review inferred memories: list pending, approve, decline, or undo.",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["list", "approve", "decline", "undo"] },
            memoryId: { type: "string", description: "Required for approve/decline/undo" },
            scope: { type: "string" },
          },
          required: ["action"],
        },
      },
      {
        name: "alekhdb_forget_match",
        description: "Agentic mass-forget: soft-delete memories matching a query (preview with dryRun).",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            scope: { type: "string" },
            dryRun: { type: "boolean", description: "Preview matches without deleting" },
            limit: { type: "number" },
          },
          required: ["query"],
        },
      },
      {
        name: "alekhdb_memory_history",
        description: "Get full version history for a memory (the DAG chain).",
        inputSchema: {
          type: "object",
          properties: {
            memoryId: { type: "string" },
          },
          required: ["memoryId"],
        },
      },
      // === Episodic traces ===
      {
        name: "alekhdb_trace_start",
        description: "Start a new episodic trace (flight recorder).",
        inputSchema: {
          type: "object",
          properties: {
            traceId: { type: "string" },
            agentId: { type: "string" },
            sessionId: { type: "string" },
            taskId: { type: "string" },
          },
          required: ["traceId"],
        },
      },
      {
        name: "alekhdb_trace_append",
        description: "Append an event frame (tool call + result + snapshot) to an open trace.",
        inputSchema: {
          type: "object",
          properties: {
            traceId: { type: "string" },
            toolCallJson: { type: "object" },
            toolResultJson: { type: "object" },
            errorSignature: { type: "string" },
          },
          required: ["traceId"],
        },
      },
      {
        name: "alekhdb_trace_replay",
        description: "Get ordered chronological frames for a trace (post-mortem replay).",
        inputSchema: {
          type: "object",
          properties: {
            traceId: { type: "string" },
          },
          required: ["traceId"],
        },
      },
      // === Code understanding ===
      {
        name: "alekhdb_analyze",
        description: "Parse a file or directory into AST nodes (uses regex or tree-sitter if enabled).",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path or directory" },
            recursive: { type: "boolean", description: "Walk directory recursively" },
          },
          required: ["path"],
        },
      },
      // === Scopes / multi-tenancy ===
      {
        name: "alekhdb_list_projects",
        description: "List all unique scopes (container tags) in memory.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "alekhdb_list_entities",
        description: "List entities (people, projects, technologies) in a scope.",
        inputSchema: {
          type: "object",
          properties: {
            scope: { type: "string" },
            entityType: { type: "string", description: "Filter by node type (e.g., 'client', 'project', 'technology')" },
          },
        },
      },
      // === Optional IDE modules ===
      {
        name: "alekhdb_git_status",
        description: "Get current git branch + memory scope (if git module enabled).",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "alekhdb_stats",
        description: "System observability: counts, latencies, memory usage, decay stats.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  });
  return;
}
```

### Update `tools/call` handler:

```javascript
if (method === "tools/call") {
  const { name, arguments: args } = params;
  let resultText = "";
  
  switch (name) {
    case "alekhdb_add": {
      const result = await sm.addMemory(args.text, args.scope || sm.currentScope, {
        forgetAfter: args.forgetAfter,
        conversationContext: args.conversationContext,
      });
      resultText = `Ingested ${result.nodes?.length || 0} memory nodes. ${result.conflict ? 'Conflict: ' + result.conflict : ''}`;
      break;
    }
    case "alekhdb_search": {
      const result = await sm.search(args.query, args.scope || "all", {
        maxDepth: args.maxDepth || 1,
        filters: args.filters,
      });
      resultText = result.synthesis || JSON.stringify(result.results || result.matchedNodeIds);
      break;
    }
    case "alekhdb_search_hybrid": {
      const result = await sm.searchHybrid(args.query, args.scope || "all", {
        signals: args.signals,
        rerank: args.rerank,
        threshold: args.threshold || 0,
        limit: args.limit || 10,
      });
      resultText = result.synthesis || JSON.stringify(result.results);
      break;
    }
    case "alekhdb_get_context": {
      const { getContext } = await import('./alekhdb-context.js');
      const ctx = await getContext(sm, {
        query: args.query,
        maxTokens: args.maxTokens || 4000,
        includeProfile: args.includeProfile !== false,
        includeRelations: args.includeRelations !== false,
        scope: args.scope || "all",
      });
      resultText = ctx.context;
      break;
    }
    case "alekhdb_profile": {
      if (args.structured) {
        resultText = JSON.stringify(sm.profileStructured({ scope: args.scope }), null, 2);
      } else {
        resultText = sm.profile({ scope: args.scope });
      }
      break;
    }
    case "alekhdb_review_inferred": {
      if (args.action === 'list') {
        resultText = JSON.stringify(sm.review.list({ scope: args.scope }), null, 2);
      } else if (args.action === 'approve') {
        resultText = JSON.stringify(sm.review.approve(args.memoryId));
      } else if (args.action === 'decline') {
        resultText = JSON.stringify(sm.review.decline(args.memoryId));
      } else if (args.action === 'undo') {
        resultText = JSON.stringify(sm.review.undo(args.memoryId));
      }
      break;
    }
    case "alekhdb_forget_match": {
      const result = await sm.forgetMatch({
        query: args.query, scope: args.scope || "all",
        dryRun: args.dryRun, limit: args.limit || 100,
      });
      resultText = JSON.stringify(result);
      break;
    }
    case "alekhdb_memory_history": {
      const history = sm.getHistory(args.memoryId);
      resultText = JSON.stringify(history, null, 2);
      break;
    }
    case "alekhdb_trace_start": {
      const trace = sm.startTrace(args.traceId, args.agentId, args.sessionId, args.taskId);
      resultText = `Trace started: ${trace.traceId}`;
      break;
    }
    case "alekhdb_trace_append": {
      const frame = sm.appendEventFrame(args.traceId, {
        toolCallJson: args.toolCallJson,
        toolResultJson: args.toolResultJson,
        errorSignature: args.errorSignature || "",
      });
      sm._flushSave();
      resultText = `Frame #${frame.stepIdx} appended`;
      break;
    }
    case "alekhdb_trace_replay": {
      const data = sm.replayTrace(args.traceId);
      resultText = JSON.stringify({ trace: data.trace, frames: data.frames }, null, 2);
      break;
    }
    case "alekhdb_analyze": {
      // Handle file or directory
      if (fs.statSync(args.path).isDirectory()) {
        // Walk + chunk all files (existing handleAnalyze logic from cli.js)
        const files = walkDir(args.path);
        for (const f of files) {
          const code = fs.readFileSync(f, 'utf8');
          sm.astChunkCode(code, f);
        }
        resultText = `Analyzed ${files.length} files`;
      } else {
        const code = fs.readFileSync(args.path, 'utf8');
        const r = sm.astChunkCode(code, args.path);
        resultText = `Extracted ${r.nodes.length} nodes from ${args.path}`;
      }
      sm._flushSave();
      break;
    }
    case "alekhdb_list_projects": {
      const scopes = [...new Set(sm.nodes.map(n => n.scope))].filter(Boolean);
      resultText = JSON.stringify(scopes);
      break;
    }
    case "alekhdb_list_entities": {
      const entities = sm.nodes
        .filter(n => (!args.entityType || n.type === args.entityType) && !n.isForgotten)
        .map(n => ({ id: n.id, label: n.label, type: n.type, scope: n.scope }));
      resultText = JSON.stringify(entities);
      break;
    }
    case "alekhdb_git_status": {
      resultText = JSON.stringify(sm._gitApi?.getStatus() || { error: 'git module not enabled' });
      break;
    }
    case "alekhdb_stats": {
      resultText = JSON.stringify(sm.stats());
      break;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
  
  sendResponse(id, { content: [{ type: "text", text: resultText }] });
  return;
}
```

### Add `stats()` method to `alekhdb.js`:

```javascript
stats() {
  return {
    nodes: this.nodes.length,
    edges: this.edges.length,
    memories: this.nodes.filter(n => !n.isForgotten && n.isLatest !== false).length,
    archived: this.nodes.filter(n => n.properties?.archived).length,
    forgotten: this.nodes.filter(n => n.isForgotten).length,
    inferred: this.nodes.filter(n => n.isInference).length,
    traces: this.traces.length,
    openTraces: this.traces.filter(t => t.status === 'open').length,
    eventFrames: this.eventFrames.length,
    activeTokens: this.calculateActiveTokens(),
    contextCapacity: this.contextCapacity,
    decayRate: this.decayRate,
    invertedIndexSize: this.invertedIndex.size,
    autoSave: this.autoSave,
    version: '2.0.0',
  };
}
```

### MCP Resources:

```javascript
if (method === "resources/list") {
  sendResponse(id, {
    resources: [
      { uri: "alekhdb://profile", name: "User Profile", mimeType: "text/markdown" },
      { uri: "alekhdb://graph", name: "Memory Graph Snapshot", mimeType: "application/json" },
      { uri: "alekhdb://stats", name: "System Stats", mimeType: "application/json" },
      { uri: "alekhdb://inferred", name: "Review Queue", mimeType: "application/json" },
    ],
  });
  return;
}

if (method === "resources/read") {
  const { uri } = params;
  let content = "";
  let mimeType = "text/plain";
  
  if (uri === "alekhdb://profile") {
    content = sm.profile(); mimeType = "text/markdown";
  } else if (uri === "alekhdb://graph") {
    content = JSON.stringify({ nodes: sm.nodes, edges: sm.edges }); mimeType = "application/json";
  } else if (uri === "alekhdb://stats") {
    content = JSON.stringify(sm.stats()); mimeType = "application/json";
  } else if (uri === "alekhdb://inferred") {
    content = JSON.stringify(sm.review.list()); mimeType = "application/json";
  }
  
  sendResponse(id, { contents: [{ uri, mimeType, text: content }] });
  return;
}
```

---

## Step 7.2: REST API (`api.js`)

### Add new endpoints:

```javascript
// Multi-signal hybrid search
app.post("/api/search/hybrid", async (req, res) => {
  const { query, scope, signals, rerank, threshold, limit, filters } = req.body;
  try {
    const result = await sm.searchHybrid(query, scope || "all", { signals, rerank, threshold, limit, filters });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Token-aware context packing
app.post("/api/context", async (req, res) => {
  const { query, maxTokens = 4000, includeProfile, includeRelations, scope } = req.body;
  try {
    const { getContext } = await import('./alekhdb-context.js');
    const ctx = await getContext(sm, { query, maxTokens, includeProfile, includeRelations, scope });
    res.json(ctx);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Structured profile with buckets
app.get("/api/profile/structured", (req, res) => {
  res.json(sm.profileStructured({ scope: req.query.scope }));
});

// Profile bucket config
app.get("/api/profile/buckets", (req, res) => {
  res.json(sm.getProfileBuckets());
});

app.post("/api/profile/buckets", (req, res) => {
  sm.setProfileBuckets(req.body);
  res.json({ success: true });
});

// Suggest buckets
app.post("/api/profile/suggest-buckets", (req, res) => {
  res.json(sm.suggestProfileBuckets(req.body.context || ''));
});

// Batch operations
app.post("/api/memories/batch", async (req, res) => {
  try {
    const result = await sm.batchAdd(req.body.items);
    res.json({ success: true, results: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/memories/batch-delete", (req, res) => {
  const count = sm.batchDelete(req.body.ids);
  res.json({ success: true, deleted: count });
});

app.post("/api/memories/batch-update", (req, res) => {
  const count = sm.batchUpdate(req.body.updates);
  res.json({ success: true, updated: count });
});

// Export/import
app.post("/api/memories/export", (req, res) => {
  const data = sm.export(req.body || {});
  res.setHeader('Content-Type', 'application/json');
  res.send(data);
});

app.post("/api/memories/import", (req, res) => {
  // req.body can be string or { data: "..." }
  const jsonStr = typeof req.body === 'string' ? req.body : (req.body.data || JSON.stringify(req.body));
  const result = sm.import(jsonStr, { merge: req.body.merge });
  res.json({ success: true, ...result });
});

// Memory history
app.get("/api/memories/:id/history", (req, res) => {
  try {
    res.json({ history: sm.getHistory(req.params.id) });
  } catch (err) { res.status(404).json({ error: err.message }); }
});

// Inferred memory review
app.get("/api/inferred", (req, res) => {
  res.json({ memories: sm.review.list({ scope: req.query.scope, limit: parseInt(req.query.limit) || 50 }) });
});

app.post("/api/inferred/:id/review", (req, res) => {
  const { action } = req.body;
  try {
    let result;
    if (action === 'approve') result = sm.review.approve(req.params.id);
    else if (action === 'decline') result = sm.review.decline(req.params.id);
    else if (action === 'undo') result = sm.review.undo(req.params.id);
    else throw new Error('Invalid action');
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Agentic mass-forget
app.post("/api/forget-match", async (req, res) => {
  const { query, scope, dryRun, limit } = req.body;
  const result = await sm.forgetMatch({ query, scope, dryRun, limit });
  res.json(result);
});

// Stats
app.get("/api/stats", (req, res) => {
  res.json(sm.stats());
});

// Events (SSE stream)
app.get("/api/events", (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  
  const events = ['memory:added', 'memory:updated', 'memory:forgotten', 'memory:reviewed', 'compaction:complete', 'git:branch-switched'];
  const unsubscribers = events.map(e => sm.on(e, (payload) => sendEvent({ event: e, payload })));
  
  req.on('close', () => unsubscribers.forEach(unsub => unsub()));
});

// Git integration
app.get("/api/git/status", (req, res) => {
  if (sm._gitApi) res.json({ status: sm._gitApi.getStatus() });
  else res.status(400).json({ error: 'git module not enabled' });
});

app.post("/api/git/branch", (req, res) => {
  if (sm._gitApi) {
    sm._gitApi.setBranch(req.body.branch);
    res.json({ success: true, branch: sm._gitApi.getBranch() });
  } else res.status(400).json({ error: 'git module not enabled' });
});

app.post("/api/git/merge", (req, res) => {
  if (sm._gitApi) {
    sm._gitApi.mergeBranch(req.body.from, req.body.to, { dryRun: req.body.dryRun })
      .then(r => res.json(r))
      .catch(e => res.status(500).json({ error: e.message }));
  } else res.status(400).json({ error: 'git module not enabled' });
});

// Privacy audit log
app.get("/api/privacy/log", (req, res) => {
  res.json({ log: sm.getPrivacyLog ? sm.getPrivacyLog() : [] });
});

// Embed all (re-embed)
app.post("/api/embed/all", async (req, res) => {
  if (sm.embedAll) {
    const count = await sm.embedAll();
    res.json({ success: true, embedded: count });
  } else res.status(400).json({ error: 'embed module not enabled' });
});

// Watcher control
app.post("/api/watch/start", (req, res) => {
  if (sm._watcherApi) {
    sm._watcherApi.start();
    res.json({ success: true });
  } else res.status(400).json({ error: 'watcher module not enabled' });
});

app.post("/api/watch/stop", (req, res) => {
  if (sm._watcherApi) { sm._watcherApi.stop(); res.json({ success: true }); }
  else res.status(400).json({ error: 'watcher module not enabled' });
});
```

---

## Step 7.3: CLI (`cli.js`)

### Add new command handlers:

```javascript
case "search-vector":
  await handleSearchVector(args.slice(1).join(" "));
  break;
case "context":
  await handleContext(args.slice(1).join(" "));
  break;
case "export":
  handleExport(args[1], args[2]);
  break;
case "import":
  await handleImport(args[1]);
  break;
case "forget-match":
  await handleForgetMatch(args.slice(1).join(" "));
  break;
case "review":
  handleReview(args[1], args[2], args[3]);
  break;
case "history":
  handleHistory(args[1]);
  break;
case "entities":
  handleEntities(args[1]);
  break;
case "projects":
  handleProjects();
  break;
case "git-branch":
  handleGitBranch(args[1]);
  break;
case "git-merge":
  handleGitMerge(args[1], args[2]);
  break;
case "git-status":
  handleGitStatus();
  break;
case "privacy-log":
  handlePrivacyLog();
  break;
case "embed":
  await handleEmbedAll();
  break;
case "watch":
  await handleWatch(args[1] || ".");
  break;
case "stats":
  handleStats();
  break;
case "mcp":
  // Spawn MCP server (alias of mcp_server.js)
  await handleMCP();
  break;
case "server":
  // Start REST API server (alias of npm run api)
  await import('./api.js');
  break;
```

### Update `printHelp()` with new commands.

---

## Step 7.4: Benchmark Validation

### Create `bench/run.js`:

```javascript
// bench/run.js — Run AlekhDB against MemoryBench (Supermemory's open-source eval framework)
// Usage: node bench/run.js --benchmark longmemeval --provider alekhdb

// For now: simple latency/quality smoke test
import { AlekhDB } from '../alekhdb.js';
import { enableExtraction } from '../alekhdb-extract.js';
import { enableEmbeddings } from '../alekhdb-embed.js';

async function benchLatency() {
  const db = new AlekhDB(true);
  db.clearToDefault();
  
  console.log('=== Latency Benchmarks ===');
  const N = 10000;
  db.autoSave = false;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) db.addNode('n' + i, 'Node ' + i, 'test');
  const t1 = performance.now();
  console.log(`Add ${N} nodes: ${(t1-t0).toFixed(2)}ms (${(t1-t0)/N*1000}μs/op)`);
  
  const t2 = performance.now();
  const r = await db.search('Node 9999', 'all', { maxDepth: 1 });
  const t3 = performance.now();
  console.log(`Search 1 match in 10K: ${(t3-t2).toFixed(4)}ms`);
  
  const t4 = performance.now();
  db.profile();
  const t5 = performance.now();
  console.log(`Profile(): ${(t5-t4).toFixed(4)}ms`);
  
  const t6 = performance.now();
  db.getNode('n' + (N - 1));
  const t7 = performance.now();
  console.log(`getNode(id) O(1): ${(t7-t6).toFixed(4)}ms`);
  
  db.autoSave = true;
  const t8 = performance.now();
  db.save();
  const t9 = performance.now();
  console.log(`Save (atomic + backup): ${(t9-t8).toFixed(2)}ms`);
  
  const t10 = performance.now();
  const freshDb = new AlekhDB(true);
  const t11 = performance.now();
  console.log(`Load DB (10K+ nodes): ${(t11-t10).toFixed(2)}ms`);
}

benchLatency();
```

### Run validation:

```bash
# Latency benchmarks (must pass sub-ms for core ops)
node bench/run.js

# Existing tests still pass
npm test
npm run doctor
npm run test:stress
```

---

## Step 7.5: Update `doctor.js`

Add checks for new optional modules:

```javascript
// In doctor.js, add new checks:
printCheck("Inverted Index Size", sm.invertedIndex ? "PASS" : "FAIL", `(${sm.invertedIndex?.size || 0} tokens indexed)`);
printCheck("Map Indexes", sm.nodeMap?.size > 0 ? "PASS" : "WARN", `(${sm.nodeMap?.size || 0} nodes indexed)`);
printCheck("Atomic Save", sm._saveDebounceMs ? "PASS" : "FAIL", `(debounced ${sm._saveDebounceMs}ms)`);
printCheck("Backup Recovery", fs.existsSync("./alekhdb_db.json.bak") ? "PASS" : "WARN", "(.bak file present)");

// Optional modules (only check if installed)
const hasEmbed = !!(await import('./alekhdb-embed.js').then(m => m.enableEmbeddings).catch(() => null));
printCheck("Embedding Module", hasEmbed ? "PASS" : "INFO", "(optional — npm i @huggingface/transformers to enable)");
```

---

## Verification

```bash
# 1. MCP tool listing
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp_server.js
# Should return 12+ tools

# 2. REST API
npm run api
# Test: curl http://localhost:3000/api/stats
# Test: curl -X POST http://localhost:3000/api/search/hybrid -H 'Content-Type: application/json' -d '{"query":"test"}'

# 3. CLI
node cli.js stats
node cli.js search-vector "test"
node cli.js context "auth"

# 4. Benchmarks
node bench/run.js
# Output should show sub-ms for addNode, getNode, profile

# 5. Full test suite
npm test
npm run doctor
```

## Files

- `mcp_server.js` — rewrite (12+ tools, resources, resources/list)
- `api.js` — add 15+ new endpoints
- `cli.js` — add 12+ new commands + update printHelp
- `doctor.js` — add module checks
- `bench/run.js` — NEW (latency benchmark)
- `package.json` — bump version to 2.0.0, add `bin` entries