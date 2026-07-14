// AlekhDB - Model Context Protocol (MCP) JSON-RPC Standard Server (mcp_server.js)
import { AlekhDB } from "./alekhdb.js";
import * as fs from "fs";
import * as path from "path";

const sm = new AlekhDB(true);
sm.autoSave = true;

if (process.env.GEMINI_API_KEY) {
  sm.llmConfig = { provider: "gemini", apiKey: process.env.GEMINI_API_KEY, endpoint: "", model: "gemini-2.5-flash" };
}

let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let boundary = buffer.indexOf("\n");
  while (boundary !== -1) {
    const line = buffer.slice(0, boundary).trim();
    buffer = buffer.slice(boundary + 1);
    if (line) handleRequest(line);
    boundary = buffer.indexOf("\n");
  }
});

async function handleRequest(line) {
  try {
    const req = JSON.parse(line);
    const { method, id, params } = req;

    if (method === "initialize") {
      sendResponse(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "alekhdb-mcp-server", version: "2.0.0" } });
      return;
    }

    if (method === "tools/list") {
      sendResponse(id, {
        tools: [
          { name: "alekhdb_add", description: "Save a memory, extracting facts. Supports conversationContext, forgetAfter, memoryType.", inputSchema: { type: "object", properties: { text: { type: "string" }, scope: { type: "string" }, forgetAfter: { type: "string" }, conversationContext: { type: "array", items: { type: "object" } } }, required: ["text"] } },
          { name: "alekhdb_search", description: "Keyword + graph search. Multi-hop configurable with filters.", inputSchema: { type: "object", properties: { query: { type: "string" }, scope: { type: "string" }, maxDepth: { type: "number" }, filters: { type: "object" } }, required: ["query"] } },
          { name: "alekhdb_search_hybrid", description: "Multi-signal fusion search (keyword + vector + entity + temporal + cognitive).", inputSchema: { type: "object", properties: { query: { type: "string" }, scope: { type: "string" }, signals: { type: "object" }, rerank: { type: "boolean" }, threshold: { type: "number" }, limit: { type: "number" } }, required: ["query"] } },
          { name: "alekhdb_get_context", description: "Token-aware context packing. Returns prompt-ready markdown within token budget.", inputSchema: { type: "object", properties: { query: { type: "string" }, maxTokens: { type: "number" }, includeProfile: { type: "boolean" }, includeRelations: { type: "boolean" }, scope: { type: "string" } }, required: ["query"] } },
          { name: "alekhdb_profile", description: "Get static + dynamic user profile. Returns markdown.", inputSchema: { type: "object", properties: { scope: { type: "string" }, structured: { type: "boolean" } } } },
          { name: "alekhdb_review_inferred", description: "Review inferred memories: list, approve, decline, or undo.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["list", "approve", "decline", "undo"] }, memoryId: { type: "string" }, scope: { type: "string" } }, required: ["action"] } },
          { name: "alekhdb_forget_match", description: "Agentic mass-forget: soft-delete memories matching a query.", inputSchema: { type: "object", properties: { query: { type: "string" }, scope: { type: "string" }, dryRun: { type: "boolean" }, limit: { type: "number" } }, required: ["query"] } },
          { name: "alekhdb_memory_history", description: "Get full version history for a memory.", inputSchema: { type: "object", properties: { memoryId: { type: "string" } }, required: ["memoryId"] } },
          { name: "alekhdb_trace_start", description: "Start a new episodic trace.", inputSchema: { type: "object", properties: { traceId: { type: "string" }, agentId: { type: "string" }, sessionId: { type: "string" }, taskId: { type: "string" } }, required: ["traceId"] } },
          { name: "alekhdb_trace_append", description: "Append an event frame to an open trace.", inputSchema: { type: "object", properties: { traceId: { type: "string" }, toolCallJson: { type: "object" }, toolResultJson: { type: "object" }, errorSignature: { type: "string" } }, required: ["traceId"] } },
          { name: "alekhdb_trace_replay", description: "Get ordered chronological frames for a trace.", inputSchema: { type: "object", properties: { traceId: { type: "string" } }, required: ["traceId"] } },
          { name: "alekhdb_analyze", description: "Parse a file or directory into AST nodes.", inputSchema: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" } }, required: ["path"] } },
          { name: "alekhdb_list_projects", description: "List all unique scopes.", inputSchema: { type: "object", properties: {} } },
          { name: "alekhdb_list_entities", description: "List entities in a scope.", inputSchema: { type: "object", properties: { scope: { type: "string" }, entityType: { type: "string" } } } },
          { name: "alekhdb_git_status", description: "Get current git branch + memory scope.", inputSchema: { type: "object", properties: {} } },
          { name: "alekhdb_stats", description: "System observability: counts, latencies, decay stats.", inputSchema: { type: "object", properties: {} } },
          { name: "alekhdb_add_decision", description: "Store a decision with alternatives and rationale.", inputSchema: { type: "object", properties: { id: { type: "string" }, context: { type: "string" }, alternatives: { type: "array", items: { type: "string" } }, chosen: { type: "string" }, rationale: { type: "string" }, scope: { type: "string" } }, required: ["id", "chosen"] } },
          { name: "alekhdb_add_failure", description: "Store a failure memory with error details.", inputSchema: { type: "object", properties: { id: { type: "string" }, approach: { type: "string" }, error: { type: "string" }, errorSignature: { type: "string" }, context: { type: "string" }, scope: { type: "string" } }, required: ["id", "approach"] } },
          { name: "alekhdb_add_change", description: "Store an optimization/change with replacement reasoning.", inputSchema: { type: "object", properties: { id: { type: "string" }, removed: { type: "string" }, removedReason: { type: "string" }, added: { type: "string" }, addedReason: { type: "string" }, justification: { type: "string" }, scope: { type: "string" } }, required: ["id", "removed", "added"] } },
          { name: "alekhdb_get_briefing", description: "Generate cross-session briefing for a time window.", inputSchema: { type: "object", properties: { since: { type: "string" }, until: { type: "string" }, sessionIds: { type: "array", items: { type: "string" } } } } },
          { name: "alekhdb_get_evolution", description: "Temporal trend analysis — changes over time.", inputSchema: { type: "object", properties: { since: { type: "string" }, until: { type: "string" }, bucket: { type: "string", enum: ["day", "week", "month"] }, scope: { type: "string" } } } },
          { name: "alekhdb_add_knowledge", description: "Store any knowledge type (decision, failure, change, principle, pattern, constraint, tactic, observation).", inputSchema: { type: "object", properties: { id: { type: "string" }, type: { type: "string", enum: ["decision", "failure", "change", "principle", "pattern", "constraint", "tactic", "observation"] }, scope: { type: "string" } }, additionalProperties: true, required: ["id", "type"] } },
          { name: "alekhdb_search_knowledge", description: "Unified search across all knowledge types.", inputSchema: { type: "object", properties: { types: { type: "array", items: { type: "string" } }, scope: { type: "string" }, status: { type: "string" }, query: { type: "string" }, minImportance: { type: "number" }, domain: { type: "string" }, tags: { type: "array", items: { type: "string" } } } } },
          { name: "alekhdb_check_conflict", description: "Pre-action conflict guard — check proposed action against existing knowledge.", inputSchema: { type: "object", properties: { type: { type: "string" }, chosen: { type: "string" }, rule: { type: "string" }, approach: { type: "string" }, errorSignature: { type: "string" }, domain: { type: "string" } }, required: ["type"] } },
        ],
      });
      return;
    }

    if (method === "resources/list") {
      sendResponse(id, { resources: [
        { uri: "alekhdb://profile", name: "User Profile", mimeType: "text/markdown" },
        { uri: "alekhdb://graph", name: "Memory Graph Snapshot", mimeType: "application/json" },
        { uri: "alekhdb://stats", name: "System Stats", mimeType: "application/json" },
        { uri: "alekhdb://inferred", name: "Review Queue", mimeType: "application/json" },
      ]});
      return;
    }

    if (method === "resources/read") {
      const { uri } = params;
      let content = "", mimeType = "text/plain";
      if (uri === "alekhdb://profile") { content = sm.profile(); mimeType = "text/markdown"; }
      else if (uri === "alekhdb://graph") { content = JSON.stringify({ nodes: sm.nodes, edges: sm.edges }); mimeType = "application/json"; }
      else if (uri === "alekhdb://stats") { content = JSON.stringify(sm.stats()); mimeType = "application/json"; }
      else if (uri === "alekhdb://inferred") { content = JSON.stringify(sm.review.list()); mimeType = "application/json"; }
      sendResponse(id, { contents: [{ uri, mimeType, text: content }] });
      return;
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;
      let resultText = "";

      switch (name) {
        case "alekhdb_add": {
          const result = await sm.addMemory(args.text, args.scope || sm.currentScope, { forgetAfter: args.forgetAfter, conversationContext: args.conversationContext });
          resultText = `Ingested ${result.nodes?.length || 0} memory nodes. ${result.conflict ? 'Conflict: ' + result.conflict : ''}`;
          break;
        }
        case "alekhdb_search": {
          const result = await sm.search(args.query, args.scope || "all", { maxDepth: args.maxDepth || 1, filters: args.filters });
          resultText = result.synthesis || JSON.stringify(result.results || result.matchedNodeIds);
          break;
        }
        case "alekhdb_search_hybrid": {
          const result = await sm.searchHybrid(args.query, args.scope || "all", { signals: args.signals, rerank: args.rerank, threshold: args.threshold || 0, limit: args.limit || 10 });
          resultText = result.synthesis || JSON.stringify(result.results);
          break;
        }
        case "alekhdb_get_context": {
          const { getContext } = await import('./alekhdb-context.js');
          const ctx = await getContext(sm, { query: args.query, maxTokens: args.maxTokens || 4000, includeProfile: args.includeProfile !== false, includeRelations: args.includeRelations !== false, scope: args.scope || "all" });
          resultText = ctx.context;
          break;
        }
        case "alekhdb_profile": {
          if (args.structured) resultText = JSON.stringify(sm.profileStructured({ scope: args.scope }), null, 2);
          else resultText = sm.profile({ scope: args.scope });
          break;
        }
        case "alekhdb_review_inferred": {
          if (args.action === 'list') resultText = JSON.stringify(sm.review.list({ scope: args.scope }), null, 2);
          else if (args.action === 'approve') resultText = JSON.stringify(sm.review.approve(args.memoryId));
          else if (args.action === 'decline') resultText = JSON.stringify(sm.review.decline(args.memoryId));
          else if (args.action === 'undo') resultText = JSON.stringify(sm.review.undo(args.memoryId));
          break;
        }
        case "alekhdb_forget_match": {
          const result = await sm.forgetMatch({ query: args.query, scope: args.scope || "all", dryRun: args.dryRun, limit: args.limit || 100 });
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
          const frame = sm.appendEventFrame(args.traceId, { toolCallJson: args.toolCallJson, toolResultJson: args.toolResultJson, errorSignature: args.errorSignature || "" });
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
          if (fs.statSync(args.path).isDirectory()) {
            const files = walkDirSync(args.path);
            for (const f of files) { const code = fs.readFileSync(f, 'utf8'); sm.astChunkCode(code, f); }
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
          const entities = sm.nodes.filter(n => (!args.entityType || n.type === args.entityType) && !n.isForgotten).map(n => ({ id: n.id, label: n.label, type: n.type, scope: n.scope }));
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
        case "alekhdb_add_decision": {
          sm.addDecision(args.id, { context: args.context, alternatives: args.alternatives || [], chosen: args.chosen, rationale: args.rationale, scope: args.scope || sm.currentScope });
          sm._flushSave();
          resultText = `Decision stored: ${args.chosen}`;
          break;
        }
        case "alekhdb_add_failure": {
          sm.addFailure(args.id, { approach: args.approach, error: args.error, errorSignature: args.errorSignature, context: args.context, scope: args.scope || sm.currentScope });
          sm._flushSave();
          resultText = `Failure stored: ${args.approach}`;
          break;
        }
        case "alekhdb_add_change": {
          sm.addChange(args.id, { removed: args.removed, removedReason: args.removedReason, added: args.added, addedReason: args.addedReason, justification: args.justification, scope: args.scope || sm.currentScope });
          sm._flushSave();
          resultText = `Change stored: ${args.removed} → ${args.added}`;
          break;
        }
        case "alekhdb_get_briefing": {
          const briefing = sm.getBriefing({ since: args.since, until: args.until, sessionIds: args.sessionIds });
          resultText = briefing.context;
          break;
        }
        case "alekhdb_get_evolution": {
          const evo = sm.getEvolution({ since: args.since, until: args.until, bucket: args.bucket || "day", scope: args.scope });
          resultText = JSON.stringify(evo, null, 2);
          break;
        }
        case "alekhdb_add_knowledge": {
          const { id, type, ...data } = args;
          sm.addKnowledge(type, id, data);
          sm._flushSave();
          resultText = `Knowledge stored: ${id} (${type})`;
          break;
        }
        case "alekhdb_search_knowledge": {
          const results = sm.searchKnowledge(args);
          resultText = JSON.stringify(results, null, 2);
          break;
        }
        case "alekhdb_check_conflict": {
          const warnings = sm.checkConflict({ type: args.type, data: args });
          resultText = JSON.stringify(warnings, null, 2);
          break;
        }
        default:
          throw new Error(`Tool not found: ${name}`);
      }

      sendResponse(id, { content: [{ type: "text", text: resultText }] });
      return;
    }

  } catch (err) {
    try {
      const req = JSON.parse(line);
      sendError(req.id, -32603, err.message);
    } catch (e) { sendError(null, -32700, "Parse error"); }
  }
}

function walkDirSync(dir, fileList = []) {
  try { const files = fs.readdirSync(dir); for (const file of files) { if (file === "node_modules" || file === ".git" || file === "dist") continue; const filePath = path.join(dir, file); const stat = fs.statSync(filePath); if (stat.isDirectory()) walkDirSync(filePath, fileList); else if (stat.isFile() && /\.(js|mjs|ts|tsx|jsx|py|rs|go|java|c|cpp|rb|php|lua|md|txt|json|yaml|yml)$/i.test(file)) fileList.push(filePath); } }
  catch (err) {}
  return fileList;
}

function sendResponse(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}
