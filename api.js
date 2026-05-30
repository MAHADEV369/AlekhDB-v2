// AlekhDB Enterprise Node.js API Gateway (api.js)

import express from "express";
import cors from "cors";
import multer from "multer";
import { AlekhDB } from "./alekhdb.js";

const app = express();
const port = process.env.PORT || 3000;
const multimodalUrl = process.env.MULTIMODAL_URL || "http://localhost:8000";

app.use(cors());
app.use(express.json());

// Initialize AlekhDB engine in Node environment
const sm = new AlekhDB(true);

// Multer in-memory storage for raw multimodal file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Interval to automatically recalculate Ebbinghaus decay on the active graph state
setInterval(() => {
  sm.applyEbbinghausDecay();
}, 10000); // Decays every 10 seconds in the background

// ==========================================
// REST ENDPOINT ROUTING
// ==========================================

// Get Server health & configuration state
app.get("/api/status", async (req, res) => {
  try {
    let multimodalLive = false;
    try {
      const response = await fetch(`${multimodalUrl}/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) multimodalLive = true;
    } catch (e) {
      // Multimodal service offline
    }

    res.json({
      status: "healthy",
      engineMode: sm.llmConfig.provider === "rules" ? "rules-based" : "llm-cognitive",
      provider: sm.llmConfig.provider,
      endpoint: sm.llmConfig.endpoint,
      model: sm.llmConfig.model,
      multimodalLive,
      activeTokens: sm.calculateActiveTokens(),
      totalNodes: sm.nodes.length,
      totalEdges: sm.edges.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get LLM & Context Settings
app.get("/api/settings", (req, res) => {
  res.json({
    success: true,
    settings: sm.llmConfig,
    contextCapacity: sm.contextCapacity
  });
});

// Configure LLM & Context Settings
app.post("/api/settings", (req, res) => {
  const { provider, apiKey, endpoint, model, contextCapacity } = req.body;
  if (!provider) {
    return res.status(400).json({ error: "Missing required provider field" });
  }

  sm.llmConfig = {
    provider,
    apiKey: apiKey || "",
    endpoint: endpoint || "http://localhost:11434",
    model: model || ""
  };

  if (contextCapacity !== undefined) {
    sm.contextCapacity = parseInt(contextCapacity) || 32000;
  }

  sm.save();

  sm.logAudit("SETTINGS_UPDATE", `AI Brain toggled to provider: ${provider}, context capacity: ${sm.contextCapacity}`);
  res.json({ success: true, settings: sm.llmConfig, contextCapacity: sm.contextCapacity });
});

// Get Visual Graph dataset
app.get("/api/graph", (req, res) => {
  // Recalculate Ebbinghaus biological decay strengths first
  sm.applyEbbinghausDecay();
  res.json({
    nodes: sm.nodes,
    edges: sm.edges
  });
});

// Get Audit Logs
app.get("/api/audit", (req, res) => {
  res.json({ audit: sm.auditLog });
});

// Ingest fact node
app.post("/api/ingest", async (req, res) => {
  const { text, scope } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Missing required text content field" });
  }

  try {
    const result = await sm.addMemory(text, scope || "work");
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RAG Search Query Synthesis
app.post("/api/search", async (req, res) => {
  const { query, scope } = req.body;
  if (!query) {
    return res.status(400).json({ error: "Missing required query content field" });
  }

  try {
    const result = await sm.search(query, scope || "all");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AST Code Chunker
app.post("/api/ast-chunk", (req, res) => {
  const { code, fileName } = req.body;
  if (!code) {
    return res.status(400).json({ error: "Missing required code content field" });
  }

  try {
    const result = sm.astChunkCode(code, fileName || "code.js");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preemptive Compaction
app.post("/api/compact", (req, res) => {
  try {
    const summaryId = sm.compaction();
    res.json({ success: true, summaryId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chroma Context-1 Self-Editing (Active Pruning)
app.post("/api/prune", (req, res) => {
  const { nodeIds } = req.body;
  if (!Array.isArray(nodeIds)) {
    return res.status(400).json({ error: "Missing required nodeIds array" });
  }

  try {
    const count = sm.pruneNodes(nodeIds);
    res.json({ success: true, prunedCount: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Community Trigger Clustering & Summarization
app.post("/api/cluster", async (req, res) => {
  try {
    // 1. Gather active graph state
    const activeNodes = sm.nodes.filter(n => !n.properties?.compacted && !n.properties?.archived);
    const activeEdges = sm.edges.filter(e => e.active);

    if (activeNodes.length === 0) {
      return res.json({ success: false, message: "No active nodes to cluster" });
    }

    // 2. POST graph data to the python FastAPI clustering service
    const response = await fetch(`${multimodalUrl}/cluster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes: activeNodes, edges: activeEdges })
    });

    if (!response.ok) {
      throw new Error(`Python clustering service offline or returned error: ${response.statusText}`);
    }

    const clusters = await response.json(); // Map of { community_id: [nodeIds] }

    let summariesCreated = 0;

    // 3. For each cluster community, generate an LLM community summary if we have active LLM config
    for (const [communityId, nodeIds] of Object.entries(clusters)) {
      if (nodeIds.length < 2) continue; // skip singletons

      const subNodes = sm.nodes.filter(n => nodeIds.includes(n.id));
      const subEdges = sm.edges.filter(e => nodeIds.includes(e.source) || nodeIds.includes(e.target));
      
      let summaryText = `Community of elements: ${subNodes.map(n => n.label).join(", ")}.`;

      if (sm.llmConfig.provider !== "rules") {
        try {
          const systemPrompt = `You are a high-performance GraphRAG community analyzer.
Your task is to write a concise, one-paragraph global summary representing the unified context of this community of nodes and edges in our memory graph.
Focus on identifying their shared category, technology stack preference, project relationship, or client requirements.

Community Context:
Nodes: ${JSON.stringify(subNodes)}
Edges: ${JSON.stringify(subEdges)}`;

          const llmSummary = await sm.llmClient.chat(systemPrompt, "Summarize this community of nodes", sm.llmConfig);
          if (llmSummary) summaryText = llmSummary.trim();
        } catch (e) {
          // LLM fail fallback
        }
      }

      // Ingest the community summary node
      const summaryNodeId = `community-summary-${communityId}`;
      sm.addNode(summaryNodeId, `Community Summary #${communityId}`, "community-summary", {
        contents: summaryText,
        nodeCount: nodeIds.length,
        nodeIds
      }, "work");

      // Connect nodes in community to the summary
      nodeIds.forEach(id => {
        sm.addEdge(sm.generateId("e-comm"), id, summaryNodeId, "part_of_community", 1.0, true);
      });

      summariesCreated++;
    }

    res.json({ success: true, communitiesFound: Object.keys(clusters).length, summariesCreated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Multimodal Binary File Upload Ingestion Hub
app.post("/api/upload", upload.single("file"), async (req, res) => {
  const { scope } = req.body;
  if (!req.file) {
    return res.status(400).json({ error: "No file was attached to the request" });
  }

  const fileName = req.file.originalname;
  const mimeType = req.file.mimetype;
  const fileBuffer = req.file.buffer;

  try {
    sm.logAudit("UPLOAD_START", `Receiving raw uploaded file: ${fileName} (${mimeType})`);

    let extractedText = "";

    // 1. If it's a PDF and python is offline, check if we can parse it locally
    if (mimeType === "application/pdf" && !process.env.DOCKER_CONTAINER) {
      try {
        // Local fallback parsing using pdf-parse if running locally
        const pdfData = await sm.parsePdfFile(fileBuffer);
        return res.json({ success: true, source: "local-pdf-parse", ...pdfData });
      } catch (e) {
        // Fallback to FastAPI
      }
    }

    // 2. Delegate file parsing to the Python FastAPI container
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append("file", blob, fileName);

    let route = "/ocr";
    if (mimeType.startsWith("audio/") || fileName.endsWith(".mp3") || fileName.endsWith(".wav")) {
      route = "/transcribe";
    } else if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
      route = "/parse-pdf";
    }

    const response = await fetch(`${multimodalUrl}${route}`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Python multimodal service returned error: ${response.statusText}`);
    }

    const result = await response.json();
    extractedText = result.text || "";

    if (!extractedText.trim()) {
      throw new Error("Multimodal service returned empty text extraction");
    }

    // 3. Ingest the extracted text as a Document block in GraphRAG
    const docText = `File Ingest [${fileName}]: ${extractedText.trim()}`;
    const ingestResult = await sm.addMemory(docText, scope || "work");

    // Link file parent node
    const fileId = "file-" + fileName.toLowerCase().replace(/[^a-z0-9]/g, "");
    sm.addNode(fileId, fileName, "file", { path: fileName, mimeType, extractedSize: extractedText.length });
    sm.addEdge(sm.generateId("e-file"), fileId, ingestResult.nodes[0], "contains_document_content", 1.0, true);

    res.json({
      success: true,
      source: "multimodal-fastapi",
      fileName,
      extractedLength: extractedText.length,
      ...ingestResult
    });
  } catch (err) {
    sm.logAudit("UPLOAD_FAIL", `Upload parse failed for ${fileName}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// EPISODIC TRACE API ROUTER ENDPOINTS
// ==========================================

// Start a new trace
app.post("/api/trace/start", (req, res) => {
  const { traceId, agentId, sessionId, taskId } = req.body;
  try {
    const trace = sm.startTrace(traceId, agentId, sessionId, taskId);
    res.json({ success: true, trace });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Append event frame to trace
app.post("/api/trace/:traceId/append", (req, res) => {
  const { traceId } = req.params;
  const frameData = req.body;
  try {
    const frame = sm.appendEventFrame(traceId, frameData);
    res.json({ success: true, frame });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Finalize a trace
app.post("/api/trace/:traceId/finalize", (req, res) => {
  const { traceId } = req.params;
  const { outcome, summaryJson } = req.body;
  try {
    const trace = sm.finalizeTrace(traceId, outcome, summaryJson);
    res.json({ success: true, trace });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Replay a trace
app.get("/api/trace/:traceId/replay", (req, res) => {
  const { traceId } = req.params;
  try {
    const data = sm.replayTrace(traceId);
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ingest a trace into Ontological GraphRAG
app.post("/api/trace/:traceId/ingest", async (req, res) => {
  const { traceId } = req.params;
  try {
    const result = await sm.ingestTraceAsMemory(traceId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all traces
app.get("/api/traces", (req, res) => {
  try {
    res.json({ success: true, traces: sm.traces });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Quarantine a trace
app.post("/api/trace/:traceId/quarantine", (req, res) => {
  const { traceId } = req.params;
  try {
    const trace = sm.quarantineTrace(traceId);
    res.json({ success: true, trace });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Express Listener
app.listen(port, () => {
  console.log(`⚡ AlekhDB Enterprise API active on port ${port}`);
  console.log(`🔗 Peered with Multimodal service on ${multimodalUrl}`);
});
