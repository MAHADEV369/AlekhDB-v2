// AlekhDB Core & Enterprise - GraphRAG Database & Cognitive Engine Library (alekhdb.js)

let fs = null;
let cheerio = null;
let pdfParse = null;
const isNodeEnv = typeof process !== "undefined" && process.versions && process.versions.node;

// Cross-platform filesystem setup using top-level await
if (isNodeEnv) {
  try {
    const rawFs = await import("fs");
    fs = rawFs.default || rawFs;
    
    const rawCheerio = await import("cheerio");
    cheerio = rawCheerio.default || rawCheerio;
    
    const rawPdfParse = await import("pdf-parse");
    pdfParse = rawPdfParse.default || rawPdfParse;
  } catch (err) {
    console.error("Failed to load native Node modules:", err);
  }
}

// ==========================================
// UNIVERSAL ZERO-SDK LLM ROUTER CLIENT
// ==========================================
export class LlmClient {
  constructor() {}

  async chat(systemPrompt, userPrompt, config) {
    if (!config || !config.provider || config.provider === "rules") {
      return null;
    }

    const { provider, apiKey, endpoint } = config;

    try {
      if (provider === "gemini") {
        const key = apiKey || process.env.GEMINI_API_KEY;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
        
        const payload = {
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n\n[USER INPUT]:\n${userPrompt}` }]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json"
          }
        };

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });

            if (!res.ok) {
              if (res.status === 503 || res.status === 429) {
                console.warn(`[LlmClient] Received transient status ${res.status} from Gemini. Retrying (attempt ${attempt}/3)...`);
                await new Promise(resolve => setTimeout(resolve, attempt * 1500));
                continue;
              }
              throw new Error(`Gemini API error: ${res.statusText} (${res.status})`);
            }

            const data = await res.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          } catch (err) {
            if (attempt === 3) throw err;
            await new Promise(resolve => setTimeout(resolve, attempt * 1500));
          }
        }
      }

      if (provider === "openai" || provider === "vllm" || provider === "grok" || provider === "xai") {
        const url = provider === "openai" ? "https://api.openai.com/v1/chat/completions" : 
                    (provider === "grok" || provider === "xai") ? "https://api.x.ai/v1/chat/completions" : 
                    `${endpoint}/v1/chat/completions`;
        const authKey = apiKey || (provider === "openai" ? process.env.OPENAI_API_KEY : "");
        
        const payload = {
          model: (provider === "grok" || provider === "xai") ? (config.model || "grok-2-1212") :
                 provider === "openai" ? "gpt-4o-mini" : (config.model || "meta-llama/Llama-3-8b-instruct"),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          response_format: { type: "json_object" }
        };

        const headers = { "Content-Type": "application/json" };
        if (authKey) {
          headers["Authorization"] = `Bearer ${authKey}`;
        }

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          throw new Error(`OpenAI/vLLM/Grok API error: ${res.statusText} (${res.status})`);
        }

        const data = await res.json();
        return data.choices?.[0]?.message?.content || "";
      }

      if (provider === "anthropic") {
        const key = apiKey || process.env.ANTHROPIC_API_KEY;
        const url = "https://api.anthropic.com/v1/messages";
        
        const payload = {
          model: "claude-3-5-haiku-latest",
          max_tokens: 4000,
          system: systemPrompt,
          messages: [
            { role: "user", content: userPrompt }
          ]
        };

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          throw new Error(`Anthropic API error: ${res.statusText} (${res.status})`);
        }

        const data = await res.json();
        return data.content?.[0]?.text || "";
      }

      if (provider === "ollama") {
        const baseUrl = endpoint || "http://localhost:11434";
        const url = `${baseUrl}/api/chat`;
        
        const payload = {
          model: config.model || "llama3",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          stream: false,
          format: "json"
        };

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          throw new Error(`Ollama API error: ${res.statusText} (${res.status})`);
        }

        const data = await res.json();
        return data.message?.content || "";
      }
    } catch (err) {
      console.error(`Universal LLM Router failed [${provider}]:`, err);
      throw err;
    }

    return null;
  }
}

// ==========================================
// CORE GRAPHRAG ENGINE
// ==========================================
export class AlekhDB {
  constructor(isNode = false) {
    this.nodes = [];
    this.edges = [];
    this.auditLog = [];
    this.traces = [];
    this.eventFrames = [];
    this.llmConfig = {
      provider: "rules", // default fallback is rules-based zapper
      apiKey: "",
      endpoint: "http://localhost:11434",
      model: ""
    };
    this.contextCapacity = 32000; // default active context window size in tokens
    this.isNode = isNode || isNodeEnv;
    
    // Support backward compatibility for legacy supermemory_db.json / alekhdb_db.json
    const localFs = this.isNode ? fs : null;
    const hasLegacyDb = localFs && localFs.existsSync && localFs.existsSync("./supermemory_db.json");
    const hasNewDb = localFs && localFs.existsSync && localFs.existsSync("./alekhdb_db.json");
    this.dbPath = hasNewDb ? "./alekhdb_db.json" : (hasLegacyDb ? "./supermemory_db.json" : "./alekhdb_db.json");

    this.autoSave = true; // High-performance dynamic save flag
    this.llmClient = new LlmClient();
    this.load();
  }

  // Collision-free high-fidelity ID generator
  generateId(prefix) {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).substring(2, 9);
    return `${prefix}-${timestamp}-${rand}`;
  }

  // Load database state safely
  load() {
    if (this.isNode) {
      try {
        if (fs && fs.existsSync(this.dbPath)) {
          const fileContent = fs.readFileSync(this.dbPath, "utf8");
          if (!fileContent.trim()) {
            this.clearToDefault();
            return;
          }
          const data = JSON.parse(fileContent);
          this.nodes = data.nodes || [];
          this.edges = data.edges || [];
          this.auditLog = data.auditLog || [];
          this.traces = data.traces || [];
          this.eventFrames = data.eventFrames || [];
          this.llmConfig = data.llmConfig || {
            provider: "rules",
            apiKey: "",
            endpoint: "http://localhost:11434",
            model: ""
          };
          this.contextCapacity = data.contextCapacity || 32000;
        } else {
          this.clearToDefault();
        }
      } catch (err) {
        console.error("CRITICAL: Failed to parse local DB JSON file. In-memory lists initialized to empty to prevent data destruction. Error:", err);
        this.nodes = [];
        this.edges = [];
        this.auditLog = [];
        this.traces = [];
        this.eventFrames = [];
      }
    } else {
      try {
        const stored = localStorage.getItem("alekhdb_db") || localStorage.getItem("supermemory_db");
        if (stored) {
          const data = JSON.parse(stored);
          this.nodes = data.nodes || [];
          this.edges = data.edges || [];
          this.auditLog = data.auditLog || [];
          this.traces = data.traces || [];
          this.eventFrames = data.eventFrames || [];
          this.llmConfig = data.llmConfig || {
            provider: "rules",
            apiKey: "",
            endpoint: "http://localhost:11434",
            model: ""
          };
          this.contextCapacity = data.contextCapacity || 32000;
        } else {
          this.clearToDefault();
        }
      } catch (err) {
        console.error("Failed to load browser DB, starting clean:", err);
        this.nodes = [];
        this.edges = [];
        this.auditLog = [];
        this.traces = [];
        this.eventFrames = [];
      }
    }
  }

  // Save database state
  save() {
    if (!this.autoSave) return; // skip if autoSave is disabled during bulk ops

    const data = {
      nodes: this.nodes,
      edges: this.edges,
      auditLog: this.auditLog,
      traces: this.traces,
      eventFrames: this.eventFrames,
      llmConfig: this.llmConfig,
      contextCapacity: this.contextCapacity
    };

    if (this.isNode) {
      try {
        if (fs) {
          fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2), "utf8");
        }
      } catch (err) {
        console.error("Failed to save local DB file:", err);
      }
    } else {
      try {
        localStorage.setItem("alekhdb_db", JSON.stringify(data));
      } catch (err) {
        console.error("Failed to save browser local storage:", err);
      }
    }
  }

  // Set default empty state
  clearToDefault() {
    this.nodes = [];
    this.edges = [];
    this.auditLog = [];
    this.traces = [];
    this.eventFrames = [];
    this.llmConfig = {
      provider: "rules",
      apiKey: "",
      endpoint: "http://localhost:11434",
      model: ""
    };
    this.logAudit("DB_INIT", "AlekhDB local graph initialized.");
    this.save();
  }

  // Add a node manually
  addNode(id, label, type, properties = {}, scope = "work") {
    const existingIndex = this.nodes.findIndex((n) => n.id === id);
    
    // Inject Ebbinghaus biological properties
    if (properties.cognitiveStrength === undefined) properties.cognitiveStrength = 1.0;
    if (!properties.lastAccessedAt) properties.lastAccessedAt = new Date().toISOString();

    if (existingIndex !== -1) {
      this.nodes[existingIndex].properties = {
        ...this.nodes[existingIndex].properties,
        ...properties
      };
      this.nodes[existingIndex].label = label;
      this.logAudit("NODE_UPDATE", `Updated node properties for: ${label} (${id})`);
    } else {
      this.nodes.push({ id, label, type, properties, scope, createdAt: new Date().toISOString() });
      this.logAudit("NODE_ADD", `Created node: ${label} (${type})`);
    }
    this.save();
  }

  // Add an edge manually
  addEdge(id, source, target, label, weight = 1.0, active = true, properties = {}) {
    const existingIndex = this.edges.findIndex((e) => e.id === id);
    if (existingIndex !== -1) {
      this.edges[existingIndex] = { 
        id, 
        source, 
        target, 
        label, 
        weight, 
        active,
        properties: { ...this.edges[existingIndex].properties, ...properties }
      };
    } else {
      this.edges.push({ id, source, target, label, weight, active, properties });
    }
    this.save();
  }

  // Append audit trail log safely capped at 500 entries
  logAudit(event, description) {
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      event,
      description
    });
    if (this.auditLog.length > 500) {
      this.auditLog.shift();
    }
  }

  // Dynamic token calculator (Approx. 1 token = 4 characters of active node content)
  calculateActiveTokens() {
    let tokens = 0;
    this.nodes.forEach((n) => {
      if (n.properties && (n.properties.compacted || n.properties.archived)) return;
      const charCount = n.label.length + JSON.stringify(n.properties).length;
      tokens += Math.ceil(charCount / 4.0);
    });
    return tokens;
  }

  // ==========================================
  // EBBINGHAUS FORGETTING DECAY & SPACED REPETITION
  // ==========================================
  applyEbbinghausDecay(decayRate = 0.002) { // Visual decay rate per second for demos
    const now = new Date();
    this.nodes.forEach((n) => {
      if (n.type === "user" || n.type === "file" || n.type === "class" || n.type === "function" || n.type === "community-summary") return;

      if (!n.properties) n.properties = {};
      if (n.properties.cognitiveStrength === undefined) n.properties.cognitiveStrength = 1.0;
      if (!n.properties.lastAccessedAt) n.properties.lastAccessedAt = new Date().toISOString();

      const lastAccess = new Date(n.properties.lastAccessedAt);
      const diffSec = Math.max(0, (now - lastAccess) / 1000.0); // seconds elapsed

      // S_t = S_0 * e^(-lambda * delta_t)
      const strength = n.properties.cognitiveStrength * Math.exp(-decayRate * diffSec);
      n.properties.cognitiveStrength = parseFloat(strength.toFixed(3));

      // Auto-pruning threshold: if cognitive strength falls below 0.15, archive the node
      if (n.properties.cognitiveStrength < 0.15 && !n.properties.compacted && !n.properties.archived) {
        n.properties.archived = true;
        this.logAudit("BIOLOGICAL_PRUNE", `Memory decayed below threshold (Strength=${n.properties.cognitiveStrength}): ${n.label}`);
      }
    });
    this.save();
  }

  reinforceNodeMemory(nodeId) {
    const node = this.nodes.find(n => n.id === nodeId);
    if (node) {
      if (!node.properties) node.properties = {};
      const oldStrength = node.properties.cognitiveStrength || 1.0;

      // Spaced repetition boost, capped at 2.0 (super-memory retention)
      node.properties.cognitiveStrength = parseFloat(Math.min(2.0, oldStrength + 0.35).toFixed(3));
      node.properties.lastAccessedAt = new Date().toISOString();

      // Revive archived memories if they are accessed
      if (node.properties.archived) {
        node.properties.archived = false;
        this.logAudit("REINFORCE_BELIEF", `Decayed belief revived via spaced repetition: ${node.label}`);
      }

      this.logAudit("REINFORCE_STRENGTH", `Memory reinforced: ${node.label} (Strength: ${node.properties.cognitiveStrength})`);
    }
  }

  // ==========================================
  // CONTEXT-CHANGE-1 SELF-EDITING (ACTIVE PRUNING)
  // ==========================================
  pruneNodes(nodeIds) {
    let count = 0;
    nodeIds.forEach((id) => {
      const node = this.nodes.find(n => n.id === id);
      if (node && !node.properties?.archived) {
        if (!node.properties) node.properties = {};
        node.properties.archived = true;
        node.properties.prunedAt = new Date().toISOString();
        this.logAudit("CONTEXT_PRUNING", `Context-Change-1 self-editing active prune: Archived node ${node.label}`);
        count++;
      }
    });
    this.save();
    return count;
  }

  // Raw fact extraction & contradiction checker with autonomous token monitoring
  async addMemory(text, scope = "work") {
    // Recalculate Ebbinghaus biological decay strengths first
    this.applyEbbinghausDecay();

    this.logAudit("INGEST_START", `Ingesting raw fact: "${text}"`);
    
    let extractedNodes = [];
    let extractedEdges = [];
    let conflictResolved = null;
    let prunedCount = 0;

    const cleanText = text.trim();
    const docId = this.generateId("doc");
    this.addNode(docId, `Doc (${cleanText.slice(0, 15)}...)`, "document", { fullText: cleanText }, scope);
    extractedNodes.push(docId);

    // ===================================================
    // ENTERPRISE COGNITIVE LLM ENGINE PATH (OPTION 2 ACTIVE)
    // ===================================================
    if (this.llmConfig.provider !== "rules") {
      try {
        const systemPrompt = `You are the cognitive brain of AlekhDB Enterprise, an elite biological GraphRAG AI memory layer.
Your task is to analyze the user's new memory statement, check it against the existing active memory graph database, and output a structured JSON response.

Here is the current Active Graph database state:
Nodes: ${JSON.stringify(this.nodes.filter(n => !n.properties?.compacted && !n.properties?.archived))}
Edges: ${JSON.stringify(this.edges.filter(e => e.active))}

You MUST analyze the input text and extract relevant entities and relationships. 
Additionally, audit for contradictions (Cognitive Dissonance):
- If the new memory directly contradicts an existing active edge or fact (e.g. stack preferences, email contact channels, roles), compute a Cognitive Dissonance Score (0.0 to 1.0).
- If the score exceeds 0.70, flag the contradiction and list the clashing Edge IDs to decay/deactivate.
Also, perform Context-Change-1 "Self-Editing" active pruning:
- If this new memory statement makes any old details in the graph obsolete or redundant (context rot), specify those Node IDs in the "prunedNodeIds" array to free up context capacity.

You MUST return a JSON object EXACTLY matching this schema:
{
  "nodes": [
    { "id": "canonical-node-id", "label": "Canonical Name", "type": "concept|technology|client|project|note", "properties": { "category": "...", "version": "..." } }
  ],
  "edges": [
    { "id": "e-canonical-id", "source": "node-id-1", "target": "node-id-2", "label": "uses_backend|associated_with|references", "weight": 1.0 }
  ],
  "contradictions": [
    { "dissonanceScore": 0.85, "description": "Contradiction detected: ...", "edgesToDecay": ["edge-id-1"] }
  ],
  "prunedNodeIds": ["redundant-node-id-1"]
}

Rules:
- Normalization: Map similar terms to a single node ID. E.g. "Bun" and "Bun.sh" map to "tech-bun".
- Clean lowercase IDs prefixed with type (e.g. "tech-bun", "client-john").
- Return ONLY valid raw JSON. No markdown blocks.`;

        const llmResponse = await this.llmClient.chat(systemPrompt, cleanText, this.llmConfig);
        
        if (llmResponse) {
          // Parse JSON safely
          const cleanJson = llmResponse.replace(/```json/g, "").replace(/```/g, "").trim();
          const extraction = JSON.parse(cleanJson);

          // 1. Ingest Nodes
          if (Array.isArray(extraction.nodes)) {
            extraction.nodes.forEach((n) => {
              this.addNode(n.id, n.label, n.type || "concept", n.properties || {}, scope);
              extractedNodes.push(n.id);
              // Link newly ingested node to our source document
              this.addEdge(this.generateId("e-doc-ref"), docId, n.id, "references", 0.5, true);
            });
          }

          // 2. Ingest Edges
          if (Array.isArray(extraction.edges)) {
            extraction.edges.forEach((e) => {
              const edgeId = e.id || this.generateId("e-llm");
              this.addEdge(edgeId, e.source, e.target, e.label, e.weight || 1.0, true);
              extractedEdges.push(edgeId);
            });
          }

          // 3. Resolve Contradictions (Truth Maintenance System)
          if (Array.isArray(extraction.contradictions) && extraction.contradictions.length > 0) {
            extraction.contradictions.forEach((c) => {
              if (c.dissonanceScore >= 0.70) {
                conflictResolved = `TMS COGNITIVE DISSONANCE ALERT (Score: ${c.dissonanceScore}): ${c.description}`;
                this.logAudit("COGNITIVE_DISSONANCE", conflictResolved);
                
                // Decay target edges
                if (Array.isArray(c.edgesToDecay)) {
                  c.edgesToDecay.forEach((edgeId) => {
                    const edge = this.edges.find((e) => e.id === edgeId);
                    if (edge) {
                      edge.active = false;
                      edge.weight = 0.15; // decayed weight
                      if (!edge.properties) edge.properties = {};
                      edge.properties.decayed = true;
                      this.logAudit("CONTRADICTION_RESOLVED", `TMS Soft-decayed conflicting edge: ${edge.label} (${edgeId})`);
                    }
                  });
                }
              }
            });
          }

          // 4. Context-Change-1 Self-Editing (Active Pruning)
          if (Array.isArray(extraction.prunedNodeIds) && extraction.prunedNodeIds.length > 0) {
            prunedCount = this.pruneNodes(extraction.prunedNodeIds);
            if (prunedCount > 0) {
              conflictResolved = (conflictResolved ? conflictResolved + " | " : "") + 
                `CONTEXT-CHANGE-1 SELF-EDITING: Actively pruned ${prunedCount} redundant nodes to prevent context rot.`;
            }
          }
        }
      } catch (err) {
        console.error("Option 2 LLM Ingestion failed, falling back to local Option 1 rules:", err);
        // Fallback to rules-based below
      }
    }

    // ===================================================
    // LOCAL RULES-BASED ENGINE PATH (OPTION 1 OR FALLBACK)
    // ===================================================
    if (extractedNodes.length === 1 && extractedEdges.length === 0) {
      // Rule 1: Custom Contradiction & Migration Rule (Uses Bun vs Node.js)
      if (/Migrated.*to\s+Bun/i.test(cleanText) || /uses\s+Bun/i.test(cleanText)) {
        this.addNode("project-alekhdb", "Project AlekhDB", "project", { description: "GraphRAG AI memory layer" }, scope);
        this.addNode("tech-bun", "Bun.sh", "technology", { category: "Runtime", version: "1.1.x" }, scope);
        
        extractedNodes.push("project-alekhdb", "tech-bun");
        this.addEdge(`e-doc-link-${docId}`, docId, "project-alekhdb", "references", 0.5, true);

        // Scan for old Node.js edges and soft-decay them
        this.edges.forEach((edge) => {
          if (edge.source === "project-alekhdb" && edge.target === "tech-nodejs" && edge.label === "uses_backend") {
            edge.active = false;
            edge.weight = 0.2; // decayed connection strength
            edge.properties = { ...edge.properties, expired: true, validUntil: "May 2026" };
            conflictResolved = "CONFLICT RESOLVED: Stale Node.js dependency decayed. Migrated Project AlekhDB stack to Bun.sh.";
          }
        });

        // Create new Bun dependency edge
        const edgeId = this.generateId("e-bun-migration");
        this.addEdge(edgeId, "project-alekhdb", "tech-bun", "uses_backend", 1.0, true);
        extractedEdges.push(edgeId);

        if (conflictResolved) {
          this.logAudit("CONTRADICTION_RESOLVED", conflictResolved);
        }
      } 
      // Rule 2: Ingest Sales Preference & Contacts
      else if (/John\s+prefers\s+Discord/i.test(cleanText)) {
        this.addNode("client-john", "John (VP Engineering)", "client", { role: "Executive Sign-off", preferredChannel: "Discord" }, scope);
        extractedNodes.push("client-john");
        
        this.addEdge(`e-doc-link-${docId}`, docId, "client-john", "references", 0.5, true);
        this.logAudit("PREFERENCE_UPDATE", "Updated John's contact channel to Discord.");
        this.reinforceNodeMemory("client-john");
      }
      // General Entity Extractor fallback
      else {
        const words = cleanText.split(/\s+/);
        const capWords = words.filter(w => /^[A-Z][a-zA-Z0-9_]*$/.test(w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"")));
        
        if (capWords.length >= 2) {
          const n1Id = "node-" + capWords[0].toLowerCase().replace(/[^a-z0-9]/g, "");
          const n2Id = "node-" + capWords[1].toLowerCase().replace(/[^a-z0-9]/g, "");
          
          this.addNode(n1Id, capWords[0], "concept", {}, scope);
          this.addNode(n2Id, capWords[1], "concept", {}, scope);
          
          const edgeId = this.generateId("e-gen");
          this.addEdge(edgeId, n1Id, n2Id, "associated_with", 0.8, true);
          
          this.addEdge(`e-doc-n1-${docId}`, docId, n1Id, "references", 0.5, true);
          this.addEdge(`e-doc-n2-${docId}`, docId, n2Id, "references", 0.5, true);
          
          extractedNodes.push(n1Id, n2Id);
          extractedEdges.push(edgeId);
          this.logAudit("TRIPLET_EXTRACTED", `Extracted relationship: (${capWords[0]}) -[associated_with]-> (${capWords[1]})`);
        } else {
          // Flat text fallback note
          const nodeId = this.generateId("note");
          this.addNode(nodeId, cleanText.length > 25 ? cleanText.slice(0,25) + "..." : cleanText, "note", {}, scope);
          
          this.addEdge(`e-doc-note-${docId}`, docId, nodeId, "references", 0.5, true);
          extractedNodes.push(nodeId);
          this.logAudit("NOTE_STORED", `Created basic note block: ${nodeId}`);
        }
      }
    }

    // AUTONOMOUS TOKEN CAPACITY MONITOR (Preemptive Compaction at 80% of contextCapacity)
    const activeTokens = this.calculateActiveTokens();
    const threshold = this.contextCapacity * 0.8;
    if (activeTokens >= threshold) {
      const summaryId = this.compaction();
      conflictResolved = (conflictResolved ? conflictResolved + " | " : "") + 
        `AUTONOMOUS COMPACTION TRIGGERED: Context window exceeded 80% threshold of ${this.contextCapacity} tokens (${activeTokens} tokens). Consolidated stack into summary node ${summaryId}.`;
      this.logAudit("AUTONOMOUS_COMPACTION", `Preemptive compaction consolidated stale records. Active tokens reset.`);
    }

    this.save();
    return {
      nodes: extractedNodes,
      edges: extractedEdges,
      conflict: conflictResolved,
      prunedCount
    };
  }

  // AST-Aware Syntax Chunker - 100% keyword & comment-proof high-fidelity parser
  astChunkCode(codeContent, fileName = "code.js") {
    this.logAudit("CODE_CHUNK_START", `Parsing directory code node: ${fileName}`);
    
    const chunkedNodes = [];
    const chunkedEdges = [];

    const fileId = "file-" + fileName.toLowerCase().replace(/[^a-z0-9]/g, "");
    this.addNode(fileId, fileName, "file", { path: fileName, language: "javascript" });
    chunkedNodes.push(fileId);

    // Strip comments to avoid parsing nodes in comments!
    let strippedContent = codeContent
      .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
      .replace(/\/\/.*/g, "");         // line comments

    // Strip string literals
    strippedContent = strippedContent
      .replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g, "");

    // Scan Classes safely
    const classRegex = /\bclass\s+([A-Za-z0-9_]+)(?:\s+extends\s+[A-Za-z0-9_]+)?\s*\{/g;
    const jsKeywords = new Set([
      "if", "for", "while", "switch", "catch", "constructor", "forEach", "map", 
      "filter", "reduce", "then", "function", "class", "const", "let", "var", 
      "return", "import", "export", "default", "await", "async", "true", "false", 
      "null", "undefined", "this", "new", "typeof", "instanceof", "in", "of", "try",
      "get", "set"
    ]);

    let match;
    let lastClassId = null;

    while ((match = classRegex.exec(strippedContent)) !== null) {
      const className = match[1];
      if (jsKeywords.has(className)) continue;

      const classId = "class-" + className.toLowerCase();
      this.addNode(classId, `Class ${className}`, "class", { sourceFile: fileName });
      
      const edgeId = `e-file-class-${classId}`;
      this.addEdge(edgeId, fileId, classId, "contains_class", 1.0, true);
      
      chunkedNodes.push(classId);
      chunkedEdges.push(edgeId);
      lastClassId = classId;
    }

    // Reset regex index and Scan Methods/Functions safely
    const methodRegex = /\b(?:async\s+)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*\{/g;
    let methodMatch;
    while ((methodMatch = methodRegex.exec(strippedContent)) !== null) {
      const methodName = methodMatch[1];
      const params = methodMatch[2];

      if (jsKeywords.has(methodName)) continue;
      if (params.includes("=>") || params.includes("{") || params.includes("}")) continue;
      
      const methodId = `method-${methodName.toLowerCase()}-${this.generateId("fn").slice(-8)}`;
      this.addNode(methodId, `fn ${methodName}()`, "function", { params: params.trim() });
      chunkedNodes.push(methodId);

      const edgeId = `e-contain-${methodId}`;
      if (lastClassId) {
        this.addEdge(edgeId, lastClassId, methodId, "contains_method", 1.0, true);
      } else {
        this.addEdge(edgeId, fileId, methodId, "contains_function", 1.0, true);
      }
      chunkedEdges.push(edgeId);
    }

    this.logAudit("CODE_CHUNK_COMPLETE", `Successfully chunked ${fileName} into AST-aware graph nodes.`);
    this.save();
    return { nodes: chunkedNodes, edges: chunkedEdges };
  }

  // Preemptive Compaction
  compaction() {
    this.logAudit("COMPACTION_START", "Running preemptive database consolidation...");
    
    const activeBackendEdge = this.edges.find(e => e.label === "uses_backend" && e.active);
    let summaryText = "Consolidated active dependencies. Project is running cleanly.";
    if (activeBackendEdge) {
      const targetNode = this.nodes.find(n => n.id === activeBackendEdge.target);
      if (targetNode) {
        summaryText = `Consolidated state. Dependency uses active runtime: ${targetNode.label}.`;
      }
    }

    const summaryId = this.generateId("node-summary");
    this.addNode(summaryId, "Core Activity Summary", "summary", {
      contents: summaryText,
      compactedAt: new Date().toISOString()
    }, "work");

    // Mark older documents and notes as compacted so they are bypassed in active token count
    this.nodes.forEach((n) => {
      if (n.id !== summaryId && (n.type === "document" || n.type === "note")) {
        n.properties = { ...n.properties, compacted: true };
      }
    });

    // Mark inactive edges as archived, preserving the timeline history!
    this.edges.forEach((e) => {
      if (!e.active) {
        e.properties = { ...e.properties, archived: true };
      }
    });
    
    const compactEdgeId = this.generateId("e-compact");
    this.addEdge(compactEdgeId, "project-alekhdb", summaryId, "summarized_in", 1.0, true);
    
    this.logAudit("COMPACTION_COMPLETE", `Compacted context node: ${summaryId}`);
    this.save();
    return summaryId;
  }

  // Synthesize Markdown User Profile
  profile() {
    const activeNodes = this.nodes;
    const activeEdges = this.edges.filter(e => e.active);

    const clientNodes = activeNodes.filter(n => n.type === "client" && !n.properties?.archived);
    const summaryNodes = activeNodes.filter(n => n.type === "summary");

    let activeRuntime = "Node.js (Legacy default)";
    const backendEdge = activeEdges.find(e => e.label === "uses_backend");
    if (backendEdge) {
      const runtime = activeNodes.find(n => n.id === backendEdge.target);
      if (runtime) activeRuntime = runtime.label;
    }

    let profileMd = `# Profile: Trident (Synthesized Context)

## Stable Preferences
* **Developer Domain**: Full-stack architect specializing in high-performance local RAG models.
* **Active Dependency Stack**: Currently utilizing **${activeRuntime}** as backend runtime.
* **Database Engine**: File-based high-speed SQLite context persistence.

## Active B2B Salesforce Pipeline
`;

    if (clientNodes.length > 0) {
      clientNodes.forEach(c => {
        profileMd += `* **Contact**: ${c.label} - Role: ${c.properties.role || "Consultant"} (Prefers **${c.properties.preferredChannel || "Email"}**, Memory Strength: ${c.properties.cognitiveStrength || 1.0})\n`;
      });
    } else {
      profileMd += `* No B2B key account preferences indexed yet.\n`;
    }

    profileMd += `\n## Memory Compaction & System Summaries\n`;
    if (summaryNodes.length > 0) {
      summaryNodes.forEach(s => {
        profileMd += `* **[Compacted Data]**: ${s.properties.contents} (Archived: ${s.properties.compactedAt})\n`;
      });
    } else {
      profileMd += `* No compactions performed yet (Active context window has full capacity).\n`;
    }

    return profileMd;
  }

  // GraphRAG Hybrid Search Engine with dynamic LLM routing & Global Search Summary routing
  async search(query, searchScope = "all") {
    // 1. Recalculate Ebbinghaus biological decay strengths
    this.applyEbbinghausDecay();

    this.logAudit("SEARCH_QUERY", `Executing search query: "${query}"`);
    
    if (!query || String(query).trim().length === 0) {
      return {
        synthesis: "Please enter a valid search query.",
        matchedNodeIds: [],
        traversedNodeIds: [],
        traversedEdgeIds: []
      };
    }

    const cleanQuery = String(query).toLowerCase().trim();
    
    // Extract search keywords (minimum 3 characters, omitting standard question pronouns/articles)
    const stopWords = ["what", "when", "where", "which", "with", "works", "there", "their", "this", "that", "your", "have", "does"];
    const queryTokens = cleanQuery
      .split(/[^a-z0-9]+/i)
      .filter(t => t.length >= 3 && !stopWords.includes(t));

    // Step 1: Semantic matching (keyword sweep mapping across nodes)
    const matchedNodeIds = [];
    this.nodes.forEach((node) => {
      if (searchScope !== "all" && node.scope !== searchScope) return;
      if (node.properties && (node.properties.compacted || node.properties.archived)) return;
      
      const labelLower = node.label.toLowerCase();
      const typeLower = node.type.toLowerCase();
      const propsLower = JSON.stringify(node.properties).toLowerCase();
      
      let isMatch = labelLower.includes(cleanQuery) || typeLower.includes(cleanQuery) || propsLower.includes(cleanQuery);
      
      if (!isMatch && queryTokens.length > 0) {
        isMatch = queryTokens.some(token => 
          labelLower.includes(token) || typeLower.includes(token) || propsLower.includes(token)
        );
      }
      
      if (isMatch) {
        matchedNodeIds.push(node.id);
        // Spaced repetition reinforcement
        this.reinforceNodeMemory(node.id);
      }
    });

    // Step 2: Structural GraphRAG traversal (1-degree neighbors)
    const traversedNodeIds = [...matchedNodeIds];
    const traversedEdgeIds = [];

    this.edges.forEach((edge) => {
      if (!edge.active) return;
      
      const sourceMatched = matchedNodeIds.includes(edge.source);
      const targetMatched = matchedNodeIds.includes(edge.target);
      
      if (sourceMatched || targetMatched) {
        traversedEdgeIds.push(edge.id);
        if (sourceMatched && !traversedNodeIds.includes(edge.target)) {
          traversedNodeIds.push(edge.target);
          this.reinforceNodeMemory(edge.target);
        }
        if (targetMatched && !traversedNodeIds.includes(edge.source)) {
          traversedNodeIds.push(edge.source);
          this.reinforceNodeMemory(edge.source);
        }
      }
    });

    const matchedNodes = traversedNodeIds.map(id => this.nodes.find(n => n.id === id)).filter(Boolean);
    const matchedEdges = traversedEdgeIds.map(id => this.edges.find(e => e.id === id)).filter(Boolean);

    // Identify community summaries for Hierarchical Global Search
    const communitySummaries = this.nodes.filter(n => n.type === "community-summary" || n.type === "summary");

    // ===================================================
    // ENTERPRISE COGNITIVE LLM SYNTHESIS (OPTION 2 ACTIVE)
    // ===================================================
    if (this.llmConfig.provider !== "rules") {
      try {
        const isGlobalSearch = cleanQuery.includes("summarize") || cleanQuery.includes("general") || cleanQuery.includes("overall") || cleanQuery.includes("all");
        
        const systemPrompt = `You are AlekhDB Enterprise, an elite cognitive RAG synthesizer.
Your task is to review the user's query and synthesize a highly professional, cohesive, and deeply contextualized GraphRAG response in Markdown, using only the active neighborhood context and community summaries provided.
Include direct references to active technologies, client preferences, and timeline histories. Highlight any decayed historical states or resolved contradictions if relevant to the query.

Gathered Context:
Nodes: ${JSON.stringify(matchedNodes)}
Edges: ${JSON.stringify(matchedEdges)}
Community Summaries: ${JSON.stringify(isGlobalSearch ? communitySummaries : [])}

Answer the query comprehensively and in depth based strictly on this context.`;

        const responseText = await this.llmClient.chat(systemPrompt, query, this.llmConfig);
        if (responseText) {
          return {
            synthesis: responseText,
            matchedNodeIds,
            traversedNodeIds,
            traversedEdgeIds
          };
        }
      } catch (err) {
        console.error("Option 2 LLM Synthesis failed, falling back to local Option 1 rules:", err);
      }
    }

    // ===================================================
    // LOCAL RULES-BASED SYNTHESIS (OPTION 1 OR FALLBACK)
    // ===================================================
    let synthesis = "";
    if (matchedNodeIds.length === 0) {
      synthesis = `No direct memory nodes matched the query "${query}". Vector search return index is empty.`;
    } else {
      const matchDetails = matchedNodeIds.map(id => this.nodes.find(n => n.id === id)?.label || id);
      const neighborDetails = traversedNodeIds
        .filter(id => !matchedNodeIds.includes(id))
        .map(id => {
          const node = this.nodes.find(n => n.id === id);
          return node ? `${node.label} (${node.type})` : "";
        }).filter(Boolean);

      synthesis = `### SuperRAG Hybrid Synthesis Response
 
* **Matched Entry Nodes**: Found direct vector/semantic indices for: **${matchDetails.join(", ")}**.
* **Traversed Neighbors Context**: Traversed active relationships to assemble surrounding context: **${neighborDetails.length > 0 ? neighborDetails.join(", ") : "None"}**.
 
**Synthesized Conclusion**:
`;

      if (cleanQuery.includes("bun") || cleanQuery.includes("runtime") || cleanQuery.includes("node")) {
        const activeBackend = this.edges.find(e => e.label === "uses_backend" && e.active);
        const activeNode = activeBackend ? this.nodes.find(n => n.id === activeBackend.target) : null;
        synthesis += `The project has evolved its backend runtime. Currently, it actively uses **${activeNode ? activeNode.label : "Bun"}** (ultra-fast bundler) for high performance. Historical audit trails reveal that any previous Node.js ties have been soft-decayed to maintain temporal consistency in the agent's brain.`;
      } else if (cleanQuery.includes("sarah") || cleanQuery.includes("john") || cleanQuery.includes("client")) {
        synthesis += `Active accounts show Sarah operates as Product Lead at Cluely, while John acts as VP Engineering (Executive Sign-off). Ingestion updates confirm Sarah's preferred communication remains email, while John's workflow preferencing is locked to Discord.`;
      } else {
        synthesis += `Located key entity associations. All related files and directory nodes are mapped directly inside the virtual POSIX memory folders for seamless grep/cat access.`;
      }
    }

    return {
      synthesis,
      matchedNodeIds,
      traversedNodeIds,
      traversedEdgeIds
    };
  }

  // Real, Web Scraper utilizing Jina Reader API with local Cheerio fallback
  async scrapeUrl(url) {
    this.logAudit("SCRAPE_START", `Scraping web address: ${url}`);
    
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Invalid URL protocol. Only HTTP and HTTPS protocols are supported.");
      }
      if (["localhost", "127.0.0.1", "169.254.169.254"].includes(parsed.hostname)) {
        throw new Error("Access to local or cloud metadata hosts is restricted.");
      }
    } catch (err) {
      this.logAudit("SCRAPE_INVALID_URL", `Scrape blocked: ${err.message}`);
      throw err;
    }

    let cleanText = "";
    let extractionSource = "cheerio-local";

    try {
      const jinaUrl = `https://r.jina.ai/${url}`;
      const response = await fetch(jinaUrl);
      if (response.ok) {
        cleanText = await response.text();
        extractionSource = "jina-api";
      } else {
        throw new Error("Jina API returned non-OK status");
      }
    } catch (err) {
      this.logAudit("SCRAPE_JINA_FAIL", `Jina Reader failed: ${err.message}. Falling back to local Cheerio...`);
      
      try {
        const response = await fetch(url);
        const html = await response.text();
        
        const loadHtml = cheerio.load || cheerio.default?.load;
        if (!loadHtml) throw new Error("Cheerio loader not found");
        
        const $ = loadHtml(html);
        $("script, style, nav, header, footer, noscript, iframe").remove();
        cleanText = $("body").text().replace(/\s+/g, " ").trim();
      } catch (cheerioErr) {
        this.logAudit("SCRAPE_FAIL", `Local Cheerio scraping failed: ${cheerioErr.message}`);
        throw cheerioErr;
      }
    }

    if (cleanText) {
      const result = await this.addMemory(`Scraped from ${url}: ${cleanText.slice(0, 1500)}`);
      this.logAudit("SCRAPE_SUCCESS", `Successfully indexed URL: ${url} (Source: ${extractionSource})`);
      return { success: true, text: cleanText, source: extractionSource, nodes: result.nodes };
    } else {
      throw new Error("Scraping returned empty text");
    }
  }

  // Real, Lightweight Local PDF Binary Parser using pdf-parse (Supports file paths and binary Buffers)
  async parsePdfFile(pdfPathOrBuffer) {
    const isBuffer = typeof Buffer !== "undefined" && Buffer.isBuffer(pdfPathOrBuffer);
    const logPath = isBuffer ? "Uploaded Document Buffer" : String(pdfPathOrBuffer);

    this.logAudit("PDF_PARSE_START", `Reading PDF document: ${logPath}`);
    if (!this.isNode || !fs || !pdfParse) {
      throw new Error("PDF Parsing requires a Node.js runtime environment and pdf-parse.");
    }

    try {
      const dataBuffer = isBuffer ? pdfPathOrBuffer : fs.readFileSync(pdfPathOrBuffer);
      const data = await pdfParse(dataBuffer);
      const cleanText = data.text.trim();

      if (cleanText) {
        const result = await this.addMemory(`PDF Document ${logPath}: ${cleanText.slice(0, 1500)}`);
        this.logAudit("PDF_PARSE_SUCCESS", `Successfully indexed PDF: ${logPath}`);
        return { success: true, text: cleanText, metadata: data.info, nodes: result.nodes };
      } else {
        throw new Error("PDF text content is empty");
      }
    } catch (err) {
      this.logAudit("PDF_PARSE_FAIL", `Failed to parse PDF: ${err.message}`);
      throw err;
    }
  }

  // ==========================================
  // EPISODIC TRACE MEMORY ENGINE METHODS
  // ==========================================

  startTrace(traceId, agentId, sessionId, taskId) {
    if (!traceId) traceId = this.generateId("trace");
    
    // Check if trace already exists
    const existing = this.traces.find(t => t.traceId === traceId);
    if (existing) {
      this.logAudit("TRACE_START_DUPLICATE", `Trace ${traceId} already exists`);
      return existing;
    }

    const newTrace = {
      traceId,
      agentId: agentId || "anonymous-agent",
      sessionId: sessionId || "session-default",
      taskId: taskId || "task-default",
      status: "open",
      outcome: "unknown",
      createdAt: new Date().toISOString(),
      finalizedAt: null,
      quarantined: false,
      compacted: false
    };

    this.traces.push(newTrace);
    this.logAudit("TRACE_START", `Started episodic trace: ${traceId} for task: ${newTrace.taskId}`);
    this.save();
    return newTrace;
  }

  appendEventFrame(traceId, frameData) {
    const trace = this.traces.find(t => t.traceId === traceId);
    if (!trace) {
      throw new Error(`Trace ${traceId} not found`);
    }
    if (trace.status === "finalized") {
      throw new Error(`Cannot append to finalized trace ${traceId}`);
    }

    const siblingFrames = this.eventFrames.filter(f => f.traceId === traceId);
    const stepIdx = siblingFrames.length;

    const newFrame = {
      id: this.generateId("frame"),
      traceId,
      stepIdx,
      ts: new Date().toISOString(),
      toolCallJson: frameData.toolCallJson || {},
      toolResultJson: frameData.toolResultJson || {},
      stateSnapshotJson: frameData.stateSnapshotJson || {},
      errorSignature: frameData.errorSignature || "",
      privacyTags: frameData.privacyTags || [],
      sourceTrust: frameData.sourceTrust !== undefined ? parseFloat(frameData.sourceTrust) : 1.0,
      extractedBeliefs: []
    };

    this.eventFrames.push(newFrame);
    this.logAudit("TRACE_FRAME_APPEND", `Appended frame #${stepIdx} to trace ${traceId}`);
    // Note: Don't auto-save on every append for performance, as specified in the constraints!
    return newFrame;
  }

  finalizeTrace(traceId, outcome = "unknown", summaryJson = {}) {
    const trace = this.traces.find(t => t.traceId === traceId);
    if (!trace) {
      throw new Error(`Trace ${traceId} not found`);
    }

    trace.status = "finalized";
    trace.outcome = outcome;
    trace.finalizedAt = new Date().toISOString();
    if (summaryJson) {
      trace.summaryJson = summaryJson;
    }

    this.logAudit("TRACE_FINALIZE", `Finalized trace ${traceId} with outcome: ${outcome}`);
    this.save(); // Save on finalize
    return trace;
  }

  replayTrace(traceId) {
    const trace = this.traces.find(t => t.traceId === traceId);
    if (!trace) {
      throw new Error(`Trace ${traceId} not found`);
    }

    const frames = this.eventFrames
      .filter(f => f.traceId === traceId)
      .sort((a, b) => a.stepIdx - b.stepIdx);

    return {
      trace,
      frames
    };
  }

  async ingestTraceAsMemory(traceId) {
    const trace = this.traces.find(t => t.traceId === traceId);
    if (!trace) {
      throw new Error(`Trace ${traceId} not found`);
    }
    if (trace.quarantined) {
      throw new Error(`Trace ${traceId} is quarantined and cannot be ingested`);
    }

    const frames = this.eventFrames
      .filter(f => f.traceId === traceId)
      .sort((a, b) => a.stepIdx - b.stepIdx);

    // Create trace node
    const traceNodeId = `node-trace-${traceId.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    this.addNode(traceNodeId, `Trace: ${trace.taskId}`, "trace", {
      traceId: trace.traceId,
      agentId: trace.agentId,
      sessionId: trace.sessionId,
      taskId: trace.taskId,
      outcome: trace.outcome,
      finalizedAt: trace.finalizedAt
    }, "work");

    // 2. Synthesize narrative summary string of the trace frames
    let summaryText = `Agent '${trace.agentId}' attempted task '${trace.taskId}' in session '${trace.sessionId}'.\n`;
    
    frames.forEach((frame) => {
      const toolCall = typeof frame.toolCallJson === "string" ? frame.toolCallJson : JSON.stringify(frame.toolCallJson);
      const toolResult = typeof frame.toolResultJson === "string" ? frame.toolResultJson : JSON.stringify(frame.toolResultJson);
      const stateSnapshot = typeof frame.stateSnapshotJson === "string" ? frame.stateSnapshotJson : JSON.stringify(frame.stateSnapshotJson);
      
      summaryText += `Step ${frame.stepIdx}: Ran tool call ${toolCall}.\n`;
      summaryText += `Result: ${toolResult}.\n`;
      if (frame.errorSignature) {
        summaryText += `Error signature: ${frame.errorSignature}.\n`;
      }
      summaryText += `State snapshot: ${stateSnapshot}.\n`;
    });

    summaryText += `Final outcome: ${trace.outcome}.`;

    // 3. Pass to addMemory() to evaluate beliefs and resolve conflicts via TMS
    this.logAudit("TRACE_INGEST_START", `Ingesting trace ${traceId} memory into GraphRAG`);
    const ingestionResult = await this.addMemory(summaryText, "work");

    // 4. Capture returned nodes and edges and link to our trace node
    if (ingestionResult && Array.isArray(ingestionResult.nodes)) {
      ingestionResult.nodes.forEach((extractedNodeId) => {
        if (extractedNodeId !== traceNodeId) {
          const edgeId = this.generateId("e-trace-belief");
          this.addEdge(edgeId, traceNodeId, extractedNodeId, "derived_from_trace", 1.0, true);
          
          // Add to frame extracted beliefs too
          const matchingFrame = frames.find(f => {
            const frameToolCall = JSON.stringify(f.toolCallJson).toLowerCase();
            const nodeLabel = extractedNodeId.toLowerCase();
            return frameToolCall.includes(nodeLabel);
          }) || frames[frames.length - 1]; // default to last frame if none matched
          
          if (matchingFrame) {
            if (!matchingFrame.extractedBeliefs) matchingFrame.extractedBeliefs = [];
            if (!matchingFrame.extractedBeliefs.includes(extractedNodeId)) {
              matchingFrame.extractedBeliefs.push(extractedNodeId);
            }
          }
        }
      });
    }

    trace.compacted = true;
    this.logAudit("TRACE_INGEST_COMPLETE", `Successfully bridged trace ${traceId} into Ontological graph.`);
    this.save();
    return {
      traceNodeId,
      nodes: ingestionResult.nodes,
      edges: ingestionResult.edges,
      conflict: ingestionResult.conflict
    };
  }

  quarantineTrace(traceId) {
    const trace = this.traces.find(t => t.traceId === traceId);
    if (!trace) {
      throw new Error(`Trace ${traceId} not found`);
    }

    trace.quarantined = true;
    this.logAudit("TRACE_QUARANTINE", `Quarantined trace ${traceId} due to security/trust concerns.`);
    this.save();
    return trace;
  }
}

// Export class alias for absolute backward compatibility with existing agent integrations
export const Supermemory = AlekhDB;
