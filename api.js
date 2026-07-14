// AlekhDB Enterprise Node.js API Gateway (api.js)

import express from "express";
import cors from "cors";
import multer from "multer";
import { AlekhDB } from "./alekhdb.js";

const app = express();
const port = process.env.PORT || 3000;
const multimodalUrl = process.env.MULTIMODAL_URL || "http://localhost:8000";

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const sm = new AlekhDB(true);
const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// REST ENDPOINT ROUTING
// ==========================================

// --- Core Status & Settings ---

app.get("/api/status", async (req, res) => {
  try {
    let multimodalLive = false;
    try { const response = await fetch(`${multimodalUrl}/health`, { signal: AbortSignal.timeout(1500) }); if (response.ok) multimodalLive = true; } catch (e) {}
    res.json({ status: "healthy", engineMode: sm.llmConfig.provider === "rules" ? "rules-based" : "llm-cognitive", provider: sm.llmConfig.provider, endpoint: sm.llmConfig.endpoint, model: sm.llmConfig.model, multimodalLive, activeTokens: sm.calculateActiveTokens(), totalNodes: sm.nodes.length, totalEdges: sm.edges.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/settings", (req, res) => { res.json({ success: true, settings: sm.llmConfig, contextCapacity: sm.contextCapacity }); });

app.post("/api/settings", (req, res) => {
  const { provider, apiKey, endpoint, model, contextCapacity } = req.body;
  if (!provider) return res.status(400).json({ error: "Missing required provider field" });
  sm.llmConfig = { provider, apiKey: apiKey || "", endpoint: endpoint || "http://localhost:11434", model: model || "" };
  if (contextCapacity !== undefined) sm.contextCapacity = parseInt(contextCapacity) || 32000;
  sm.save();
  sm.logAudit("SETTINGS_UPDATE", `AI Brain toggled to provider: ${provider}, context capacity: ${sm.contextCapacity}`);
  res.json({ success: true, settings: sm.llmConfig, contextCapacity: sm.contextCapacity });
});

app.get("/api/stats", (req, res) => { res.json(sm.stats()); });

// --- Graph & Audit ---

app.get("/api/graph", (req, res) => { sm.applyEbbinghausDecay(); res.json({ nodes: sm.nodes, edges: sm.edges }); });

app.get("/api/audit", (req, res) => { res.json({ audit: sm.auditLog }); });

// --- Ingestion & Search ---

app.post("/api/ingest", async (req, res) => {
  const { text, scope, forgetAfter, conversationContext } = req.body;
  if (!text) return res.status(400).json({ error: "Missing required text content field" });
  try { const result = await sm.addMemory(text, scope || sm.currentScope || "work", { forgetAfter, conversationContext }); res.json({ success: true, ...result }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/search", async (req, res) => {
  const { query, scope, maxDepth, filters } = req.body;
  if (!query) return res.status(400).json({ error: "Missing required query content field" });
  try { const result = await sm.search(query, scope || "all", { maxDepth, filters }); res.json(result); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/search/hybrid", async (req, res) => {
  const { query, scope, signals, rerank, threshold, limit, filters } = req.body;
  try { const result = await sm.searchHybrid(query, scope || "all", { signals, rerank, threshold, limit, filters }); res.json(result); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Context Packing ---

app.post("/api/context", async (req, res) => {
  const { query, maxTokens = 4000, includeProfile, includeRelations, scope } = req.body;
  try { const { getContext } = await import('./alekhdb-context.js'); const ctx = await getContext(sm, { query, maxTokens, includeProfile, includeRelations, scope: scope || "all" }); res.json(ctx); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Profile ---

app.get("/api/profile", (req, res) => { res.json({ profile: sm.profile({ scope: req.query.scope }) }); });

app.get("/api/profile/structured", (req, res) => { res.json(sm.profileStructured({ scope: req.query.scope })); });

app.get("/api/profile/buckets", (req, res) => { res.json(sm.getProfileBuckets()); });

app.post("/api/profile/buckets", (req, res) => { sm.setProfileBuckets(req.body); res.json({ success: true }); });

app.post("/api/profile/suggest-buckets", (req, res) => { res.json(sm.suggestProfileBuckets(req.body.context || '')); });

// --- AST & Compaction & Pruning ---

app.post("/api/ast-chunk", (req, res) => {
  const { code, fileName } = req.body;
  if (!code) return res.status(400).json({ error: "Missing required code content field" });
  try { const result = sm.astChunkCode(code, fileName || "code.js"); res.json(result); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/compact", (req, res) => { try { const summaryId = sm.compaction(); res.json({ success: true, summaryId }); } catch (err) { res.status(500).json({ error: err.message }); } });

app.post("/api/prune", (req, res) => {
  const { nodeIds } = req.body;
  if (!Array.isArray(nodeIds)) return res.status(400).json({ error: "Missing required nodeIds array" });
  try { const count = sm.pruneNodes(nodeIds); res.json({ success: true, prunedCount: count }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Cluster ---

app.post("/api/cluster", async (req, res) => {
  try {
    const activeNodes = sm.nodes.filter(n => !n.properties?.compacted && !n.properties?.archived);
    const activeEdges = sm.edges.filter(e => e.active);
    if (activeNodes.length === 0) return res.json({ success: false, message: "No active nodes to cluster" });
    const response = await fetch(`${multimodalUrl}/cluster`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nodes: activeNodes, edges: activeEdges }) });
    if (!response.ok) throw new Error(`Python clustering service offline or returned error: ${response.statusText}`);
    const clusters = await response.json();
    let summariesCreated = 0;
    for (const [communityId, nodeIds] of Object.entries(clusters)) {
      if (nodeIds.length < 2) continue;
      const subNodes = sm.nodes.filter(n => nodeIds.includes(n.id));
      const subEdges = sm.edges.filter(e => nodeIds.includes(e.source) || nodeIds.includes(e.target));
      let summaryText = `Community of elements: ${subNodes.map(n => n.label).join(", ")}.`;
      if (sm.llmConfig.provider !== "rules") {
        try { const systemPrompt = `You are a high-performance GraphRAG community analyzer.\nWrite a concise, one-paragraph global summary representing this community.\n\nCommunity Context:\nNodes: ${JSON.stringify(subNodes)}\nEdges: ${JSON.stringify(subEdges)}`; const llmSummary = await sm.llmClient.chat(systemPrompt, "Summarize this community of nodes", sm.llmConfig); if (llmSummary) summaryText = llmSummary.trim(); } catch (e) {}
      }
      const summaryNodeId = `community-summary-${communityId}`;
      sm.addNode(summaryNodeId, `Community Summary #${communityId}`, "community-summary", { contents: summaryText, nodeCount: nodeIds.length, nodeIds }, "work");
      nodeIds.forEach(id => sm.addEdge(sm.generateId("e-comm"), id, summaryNodeId, "part_of_community", 1.0, true));
      summariesCreated++;
    }
    res.json({ success: true, communitiesFound: Object.keys(clusters).length, summariesCreated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Multimodal Upload ---

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const { scope } = req.body;
  if (!req.file) return res.status(400).json({ error: "No file was attached to the request" });
  const fileName = req.file.originalname, mimeType = req.file.mimetype, fileBuffer = req.file.buffer;
  try {
    sm.logAudit("UPLOAD_START", `Receiving raw uploaded file: ${fileName} (${mimeType})`);
    if (mimeType === "application/pdf" && !process.env.DOCKER_CONTAINER) { try { const pdfData = await sm.parsePdfFile(fileBuffer); return res.json({ success: true, source: "local-pdf-parse", ...pdfData }); } catch (e) {} }
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append("file", blob, fileName);
    let route = "/ocr";
    if (mimeType.startsWith("audio/") || fileName.endsWith(".mp3") || fileName.endsWith(".wav")) route = "/transcribe";
    else if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) route = "/parse-pdf";
    const response = await fetch(`${multimodalUrl}${route}`, { method: "POST", body: formData });
    if (!response.ok) throw new Error(`Python multimodal service returned error: ${response.statusText}`);
    const result = await response.json();
    const extractedText = result.text || "";
    if (!extractedText.trim()) throw new Error("Multimodal service returned empty text extraction");
    const docText = `File Ingest [${fileName}]: ${extractedText.trim()}`;
    const ingestResult = await sm.addMemory(docText, scope || sm.currentScope || "work");
    const fileId = "file-" + fileName.toLowerCase().replace(/[^a-z0-9]/g, "");
    sm.addNode(fileId, fileName, "file", { path: fileName, mimeType, extractedSize: extractedText.length });
    sm.addEdge(sm.generateId("e-file"), fileId, ingestResult.nodes[0], "contains_document_content", 1.0, true);
    res.json({ success: true, source: "multimodal-fastapi", fileName, extractedLength: extractedText.length, ...ingestResult });
  } catch (err) { sm.logAudit("UPLOAD_FAIL", `Upload parse failed for ${fileName}: ${err.message}`); res.status(500).json({ error: err.message }); }
});

// --- Batch Operations ---

app.post("/api/memories/batch", async (req, res) => {
  try { const result = await sm.batchAdd(req.body.items); res.json({ success: true, results: result }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/memories/batch-delete", (req, res) => { const count = sm.batchDelete(req.body.ids); res.json({ success: true, deleted: count }); });

app.post("/api/memories/batch-update", (req, res) => { const count = sm.batchUpdate(req.body.updates); res.json({ success: true, updated: count }); });

// --- Export/Import ---

app.post("/api/memories/export", (req, res) => { const data = sm.export(req.body || {}); res.setHeader('Content-Type', 'application/json'); res.send(data); });

app.post("/api/memories/import", (req, res) => {
  const jsonStr = typeof req.body === 'string' ? req.body : (req.body.data || JSON.stringify(req.body));
  const result = sm.import(jsonStr, { merge: req.body.merge });
  res.json({ success: true, ...result });
});

// --- Memory History ---

app.get("/api/memories/:id/history", (req, res) => {
  try { res.json({ history: sm.getHistory(req.params.id) }); }
  catch (err) { res.status(404).json({ error: err.message }); }
});

// --- Inferred Memory Review ---

app.get("/api/inferred", (req, res) => { res.json({ memories: sm.review.list({ scope: req.query.scope, limit: parseInt(req.query.limit) || 50 }) }); });

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

// --- Agentic Mass-Forget ---

app.post("/api/forget-match", async (req, res) => {
  const { query, scope, dryRun, limit } = req.body;
  const result = await sm.forgetMatch({ query, scope, dryRun, limit });
  res.json(result);
});

// --- Events (SSE) ---

app.get("/api/events", (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const events = ['memory:added', 'memory:updated', 'memory:forgotten', 'memory:reviewed', 'compaction:complete', 'git:branch-switched'];
  const unsubscribers = events.map(e => sm.on(e, (payload) => sendEvent({ event: e, payload })));
  req.on('close', () => unsubscribers.forEach(unsub => unsub()));
});

// --- Git Integration ---

app.get("/api/git/status", (req, res) => { if (sm._gitApi) res.json({ status: sm._gitApi.getStatus() }); else res.status(400).json({ error: 'git module not enabled' }); });

app.post("/api/git/branch", (req, res) => { if (sm._gitApi) { sm._gitApi.setBranch(req.body.branch); res.json({ success: true, branch: sm._gitApi.getBranch() }); } else res.status(400).json({ error: 'git module not enabled' }); });

app.post("/api/git/merge", (req, res) => { if (sm._gitApi) { sm._gitApi.mergeBranch(req.body.from, req.body.to, { dryRun: req.body.dryRun }).then(r => res.json(r)).catch(e => res.status(500).json({ error: e.message })); } else res.status(400).json({ error: 'git module not enabled' }); });

// --- Privacy Audit Log ---

app.get("/api/privacy/log", (req, res) => { res.json({ log: sm.getPrivacyLog ? sm.getPrivacyLog() : [] }); });

// --- Embed All (Re-embed) ---

app.post("/api/embed/all", async (req, res) => { if (sm.embedAll) { const count = await sm.embedAll(); res.json({ success: true, embedded: count }); } else res.status(400).json({ error: 'embed module not enabled' }); });

// --- Watcher Control ---

app.post("/api/watch/start", (req, res) => { if (sm._watcherApi) { sm._watcherApi.start(); res.json({ success: true }); } else res.status(400).json({ error: 'watcher module not enabled' }); });

app.post("/api/watch/stop", (req, res) => { if (sm._watcherApi) { sm._watcherApi.stop(); res.json({ success: true }); } else res.status(400).json({ error: 'watcher module not enabled' }); });

// --- Episodic Trace Endpoints ---

app.post("/api/trace/start", (req, res) => {
  const { traceId, agentId, sessionId, taskId } = req.body;
  try { const trace = sm.startTrace(traceId, agentId, sessionId, taskId); res.json({ success: true, trace }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/trace/:traceId/append", (req, res) => {
  const { traceId } = req.params;
  try { const frame = sm.appendEventFrame(traceId, req.body); res.json({ success: true, frame }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/trace/:traceId/finalize", (req, res) => {
  const { traceId } = req.params;
  const { outcome, summaryJson } = req.body;
  try { const trace = sm.finalizeTrace(traceId, outcome, summaryJson); res.json({ success: true, trace }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/trace/:traceId/replay", (req, res) => {
  const { traceId } = req.params;
  try { const data = sm.replayTrace(traceId); res.json({ success: true, ...data }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/trace/:traceId/ingest", async (req, res) => {
  const { traceId } = req.params;
  try { const result = await sm.ingestTraceAsMemory(traceId); res.json({ success: true, ...result }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/traces", (req, res) => { try { res.json({ success: true, traces: sm.traces }); } catch (err) { res.status(500).json({ error: err.message }); } });

app.post("/api/trace/:traceId/quarantine", (req, res) => {
  const { traceId } = req.params;
  try { const trace = sm.quarantineTrace(traceId); res.json({ success: true, trace }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Decision / Failure / Change Memory ---

app.post("/api/memories/decision", (req, res) => {
  const { id, context, alternatives, chosen, rationale, scope } = req.body;
  if (!id || !chosen) return res.status(400).json({ error: "Missing required id or chosen fields" });
  try { sm.addDecision(id, { context, alternatives: alternatives || [], chosen, rationale, scope: scope || sm.currentScope }); res.json({ success: true, id }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/memories/failure", (req, res) => {
  const { id, approach, error, errorSignature, context, scope } = req.body;
  if (!id || !approach) return res.status(400).json({ error: "Missing required id or approach fields" });
  try { sm.addFailure(id, { approach, error, errorSignature, context, scope: scope || sm.currentScope }); res.json({ success: true, id }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/memories/change", (req, res) => {
  const { id, removed, removedReason, added, addedReason, justification, scope } = req.body;
  if (!id || !removed || !added) return res.status(400).json({ error: "Missing required id, removed, or added fields" });
  try { sm.addChange(id, { removed, removedReason, added, addedReason, justification, scope: scope || sm.currentScope }); res.json({ success: true, id }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Briefing & Temporal Queries ---

app.get("/api/briefing", (req, res) => {
  try { const briefing = sm.getBriefing({ since: req.query.since, until: req.query.until, sessionIds: req.query.sessionIds }); res.json(briefing); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/evolution", (req, res) => {
  try { const evo = sm.getEvolution({ since: req.query.since, until: req.query.until, bucket: req.query.bucket || "day", scope: req.query.scope }); res.json(evo); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/temporal-series", (req, res) => {
  const { field, since, until, bucket } = req.query;
  if (!field) return res.status(400).json({ error: "Missing required field query parameter" });
  try { const series = sm.getTemporalSeries(field, { since, until, bucket: bucket || "day" }); res.json(series); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Knowledge Graph Endpoints ---

app.post("/api/knowledge", (req, res) => {
  const { id, type, ...data } = req.body;
  if (!id || !type) return res.status(400).json({ error: "Missing required id or type fields" });
  try { sm.addKnowledge(type, id, data); res.json({ success: true, id, type }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/knowledge/search", (req, res) => {
  try { const results = sm.searchKnowledge(req.query); res.json({ results }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/knowledge/check-conflict", (req, res) => {
  const { type, ...data } = req.body;
  if (!type) return res.status(400).json({ error: "Missing required type field" });
  try { const warnings = sm.checkConflict({ type, data }); res.json({ success: true, warnings }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Start Express Listener
app.listen(port, () => {
  console.log(`⚡ AlekhDB Enterprise API active on port ${port}`);
  console.log(`🔗 Peered with Multimodal service on ${multimodalUrl}`);
});
