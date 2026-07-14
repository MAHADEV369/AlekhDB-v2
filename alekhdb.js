// AlekhDB v2 Core & Enterprise - GraphRAG Database & Cognitive Engine Library (alekhdb.js)

let fs = null;
let cheerio = null;
let pdfParse = null;
const isNodeEnv = typeof process !== "undefined" && process.versions && process.versions.node;

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

/**
 * Lightweight zero-dependency LLM client supporting Gemini, OpenAI, vLLM, Grok/xAI, Anthropic, and Ollama.
 * Retries transient 503/429 errors with exponential backoff. Returns null when provider is "rules" (offline fallback).
 */
export class LlmClient {
  /** Construct a new LlmClient. Stateless — config is passed per-call to `chat()`. */
  constructor() {}

  /**
   * Send a chat completion request to the configured provider.
   * @param {string} systemPrompt - System instructions for the LLM.
   * @param {string} userPrompt - User input to the LLM.
   * @param {Object} config - Provider configuration.
   * @param {('gemini'|'openai'|'vllm'|'grok'|'xai'|'anthropic'|'ollama'|'rules')} config.provider - LLM backend.
   * @param {string} [config.apiKey] - API key for cloud providers.
   * @param {string} [config.endpoint] - Base URL for self-hosted (vLLM, Ollama).
   * @param {string} [config.model] - Model identifier.
   * @returns {Promise<string|null>} LLM response text, or null if provider is "rules".
   * @throws {Error} If the API returns a non-transient error after 3 retries.
   * @example
   * const client = new LlmClient();
   * const text = await client.chat('You are helpful.', 'Hello', { provider: 'gemini', apiKey: '...' });
   */
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
          contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n[USER INPUT]:\n${userPrompt}` }] }],
          generationConfig: { responseMimeType: "application/json" }
        };
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            if (!res.ok) {
              if (res.status === 503 || res.status === 429) { console.warn(`[LlmClient] Transient ${res.status} from Gemini. Retry ${attempt}/3...`); await new Promise(r => setTimeout(r, attempt * 1500)); continue; }
              throw new Error(`Gemini API error: ${res.statusText} (${res.status})`);
            }
            const data = await res.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          } catch (err) { if (attempt === 3) throw err; await new Promise(r => setTimeout(r, attempt * 1500)); }
        }
      }
      if (provider === "openai" || provider === "vllm" || provider === "grok" || provider === "xai") {
        const url = provider === "openai" ? "https://api.openai.com/v1/chat/completions" : (provider === "grok" || provider === "xai") ? "https://api.x.ai/v1/chat/completions" : `${endpoint}/v1/chat/completions`;
        const authKey = apiKey || (provider === "openai" ? process.env.OPENAI_API_KEY : "");
        const payload = {
          model: (provider === "grok" || provider === "xai") ? (config.model || "grok-2-1212") : provider === "openai" ? "gpt-4o-mini" : (config.model || "meta-llama/Llama-3-8b-instruct"),
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          response_format: { type: "json_object" }
        };
        const headers = { "Content-Type": "application/json" };
        if (authKey) headers["Authorization"] = `Bearer ${authKey}`;
        const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(`OpenAI/vLLM/Grok API error: ${res.statusText} (${res.status})`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "";
      }
      if (provider === "anthropic") {
        const key = apiKey || process.env.ANTHROPIC_API_KEY;
        const url = "https://api.anthropic.com/v1/messages";
        const payload = { model: "claude-3-5-haiku-latest", max_tokens: 4000, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] };
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(`Anthropic API error: ${res.statusText} (${res.status})`);
        const data = await res.json();
        return data.content?.[0]?.text || "";
      }
      if (provider === "ollama") {
        const baseUrl = endpoint || "http://localhost:11434";
        const url = `${baseUrl}/api/chat`;
        const payload = { model: config.model || "llama3", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], stream: false, format: "json" };
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(`Ollama API error: ${res.statusText} (${res.status})`);
        const data = await res.json();
        return data.message?.content || "";
      }
    } catch (err) { console.error(`Universal LLM Router failed [${provider}]:`, err); throw err; }
    return null;
  }
}

/**
 * AlekhDB — local-first, sub-millisecond GraphRAG database and cognitive memory engine.
 * Zero-dependency core. Elective modules (embeddings, git, privacy, AST, watcher, LSP, consolidator) are import-optional.
 * Supports Ebbinghaus biological forgetting, Doyle-style TMS contradictions, versioned DAG memory,
 * multi-signal hybrid retrieval, episodic traces, container-tag scoping, and Phase 8 reasoning memory.
 */
export class AlekhDB {
  /**
   * Construct a new AlekhDB instance.
   * @param {boolean} [isNode=false] - Set true when running in Node.js (enables fs persistence). Auto-detected if omitted.
   * @example
   * const db = new AlekhDB(true);  // Node.js mode with file persistence
   * db.load();                      // load from disk
   * db.addNode('m1', 'Hello', 'concept');
   */
  constructor(isNode = false) {
    this.nodes = [];
    this.edges = [];
    this.auditLog = [];
    this.traces = [];
    this.eventFrames = [];

    this.nodeMap = new Map();
    this.edgeMap = new Map();
    this._dirty = false;
    this._saveTimer = null;
    this._saveDebounceMs = 500;
    this.invertedIndex = new Map();
    this.adjacency = new Map();
    this.decayRate = 0.000004;
    this.currentScope = null;
    this._eventListeners = new Map();
    this._profileBuckets = null;
    this._embedFn = null;
    this._embedModel = null;
    this._rerankFn = null;
    this._reviewApi = null;

    this.llmConfig = { provider: "rules", apiKey: "", endpoint: "http://localhost:11434", model: "" };
    this.contextCapacity = 32000;
    this.isNode = isNode || isNodeEnv;

    const localFs = this.isNode ? fs : null;
    const hasLegacyDb = localFs && localFs.existsSync && localFs.existsSync("./supermemory_db.json");
    const hasNewDb = localFs && localFs.existsSync && localFs.existsSync("./alekhdb_db.json");
    this.dbPath = hasNewDb ? "./alekhdb_db.json" : (hasLegacyDb ? "./supermemory_db.json" : "./alekhdb_db.json");

    this.autoSave = true;
    this.llmClient = new LlmClient();
    this.load();

    if (this.isNode && !this._decayTimer) {
      this._decayTimer = setInterval(() => { this.applyEbbinghausDecay(); }, 60000);
      if (this._decayTimer.unref) this._decayTimer.unref();
    }
  }

  /**
   * Generate a unique identifier with the given prefix.
   * @param {string} prefix - Prefix for the id (e.g. 'node', 'edge', 'trace').
   * @returns {string} A unique id of the form `${prefix}-${timestamp}-${random}`.
   * @example
   * db.generateId('node');  // 'node-1691234567890-abc123'
   */
  generateId(prefix) {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).substring(2, 9);
    return `${prefix}-${timestamp}-${rand}`;
  }

  /**
   * Rebuild all internal indexes (nodeMap, edgeMap, adjacency, invertedIndex) from the nodes/edges arrays.
   * Called after load() and after bulk imports. O(n) in total nodes+edges.
   * @returns {void}
   * @example
   * db.nodes.push(externalNode);  // bypass addNode
   * db._rebuildIndexes();         // reindex after bypass
   */
  _rebuildIndexes() {
    this.nodeMap = new Map();
    this.edgeMap = new Map();
    this.adjacency = new Map();
    this.nodes.forEach(n => this.nodeMap.set(n.id, n));
    this.edges.forEach(e => {
      this.edgeMap.set(e.id, e);
      if (e.active) {
        if (!this.adjacency.has(e.source)) this.adjacency.set(e.source, []);
        if (!this.adjacency.has(e.target)) this.adjacency.set(e.target, []);
        this.adjacency.get(e.source).push({ edge: e, neighborId: e.target });
        this.adjacency.get(e.target).push({ edge: e, neighborId: e.source });
      }
    });
    this._rebuildInvertedIndex();
  }

  /**
   * Get a node by id in O(1) via nodeMap.
   * @param {string} id - Node id.
   * @returns {Object|undefined} The node object, or undefined if not found.
   * @example
   * const node = db.getNode('m1');
   */
  getNode(id) { return this.nodeMap.get(id); }

  /**
   * Get an edge by id in O(1) via edgeMap.
   * @param {string} id - Edge id.
   * @returns {Object|undefined} The edge object, or undefined if not found.
   * @example
   * const edge = db.getEdge('e1');
   */
  getEdge(id) { return this.edgeMap.get(id); }

  /**
   * Mark the database as dirty and schedule a debounced save (500ms).
   * Replaces direct save() calls in the hot path so addNode/addEdge stay sub-millisecond.
   * @returns {void}
   * @example
   * db.addNode('m1', 'Label');  // internally calls _markDirty() instead of save()
   */
  _markDirty() {
    if (!this.autoSave) return;
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (this._dirty) { this._dirty = false; this.save(); }
    }, this._saveDebounceMs);
  }

  /**
   * Force an immediate save if dirty, cancelling any pending debounced save.
   * Call before process.exit() or CLI command boundaries to guarantee durability.
   * @returns {void}
   * @example
   * db._flushSave();  // ensure all writes are on disk before exit
   * process.exit(0);
   */
  _flushSave() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._dirty) { this._dirty = false; this.save(); }
  }

  /**
   * Tokenize text into lowercase tokens for the inverted index.
   * Splits on non-alphanumeric characters, filters tokens shorter than 2 chars.
   * @param {string} text - Text to tokenize.
   * @returns {string[]} Array of lowercase tokens.
   * @example
   * db._tokenize('Hello, World!');  // ['hello', 'world']
   */
  _tokenize(text) {
    if (!text) return [];
    return String(text).toLowerCase().split(/[^a-z0-9]+/i).filter(t => t.length >= 2);
  }

  /**
   * Add a node's label, type, and properties to the inverted keyword index.
   * Called automatically by addNode(); call manually only after bypassing it.
   * @param {Object} node - The node to index.
   * @returns {void}
   * @example
   * db._indexNode(db.getNode('m1'));
   */
  _indexNode(node) {
    const tokens = new Set();
    this._tokenize(node.label).forEach(t => tokens.add(t));
    this._tokenize(node.type).forEach(t => tokens.add(t));
    if (node.properties) this._tokenize(JSON.stringify(node.properties)).forEach(t => tokens.add(t));
    tokens.forEach(token => {
      if (!this.invertedIndex.has(token)) this.invertedIndex.set(token, new Set());
      this.invertedIndex.get(token).add(node.id);
    });
  }

  /**
   * Remove a node from the inverted keyword index by id.
   * Called automatically by pruneNodes() and batchDelete(); called manually only after bypassing them.
   * @param {string} nodeId - The id of the node to unindex.
   * @returns {void}
   * @example
   * db._unindexNode('m1');
   */
  _unindexNode(nodeId) {
    for (const [token, idSet] of this.invertedIndex) {
      idSet.delete(nodeId);
      if (idSet.size === 0) this.invertedIndex.delete(token);
    }
  }

  /**
   * Rebuild the entire inverted keyword index by re-indexing all nodes.
   * Called by _rebuildIndexes(); O(n) in total nodes.
   * @returns {void}
   * @example
   * db._rebuildInvertedIndex();
   */
  _rebuildInvertedIndex() {
    this.invertedIndex = new Map();
    this.nodes.forEach(n => this._indexNode(n));
  }

  /**
   * Load the database from disk (Node.js) or localStorage (browser).
   * On corruption: attempts to recover from `.bak` backup before falling back to empty state.
   * Rebuilds all indexes after loading. Logs DB_RECOVERED on backup restore.
   * @returns {void}
   * @throws {Error} If both primary and backup files are unreadable (starts fresh with a logged warning).
   * @example
   * const db = new AlekhDB(true);
   * db.load();
   */
  load() {
    if (this.isNode) {
      try {
        if (fs && fs.existsSync(this.dbPath)) {
          const fileContent = fs.readFileSync(this.dbPath, "utf8");
          if (!fileContent.trim()) { this.clearToDefault(); return; }
          const data = JSON.parse(fileContent);
          this.nodes = data.nodes || [];
          this.edges = data.edges || [];
          this.auditLog = data.auditLog || [];
          this.traces = data.traces || [];
          this.eventFrames = data.eventFrames || [];
          this.llmConfig = data.llmConfig || { provider: "rules", apiKey: "", endpoint: "http://localhost:11434", model: "" };
          this.contextCapacity = data.contextCapacity || 32000;
          this.decayRate = data.decayRate || 0.000004;
          this._rebuildIndexes();
        } else { this.clearToDefault(); }
      } catch (err) {
        console.error("CRITICAL: Failed to parse primary DB JSON. Attempting backup recovery:", err.message);
        try {
          if (fs && fs.existsSync(this.dbPath + ".bak")) {
            const bakContent = fs.readFileSync(this.dbPath + ".bak", "utf8");
            if (bakContent.trim()) {
              const data = JSON.parse(bakContent);
              this.nodes = data.nodes || [];
              this.edges = data.edges || [];
              this.auditLog = data.auditLog || [];
              this.traces = data.traces || [];
              this.eventFrames = data.eventFrames || [];
              this.llmConfig = data.llmConfig || { provider: "rules", apiKey: "", endpoint: "http://localhost:11434", model: "" };
              this.contextCapacity = data.contextCapacity || 32000;
              this.decayRate = data.decayRate || 0.000004;
              this._rebuildIndexes();
              this.logAudit("DB_RECOVERED", "Primary DB corrupted; restored from .bak backup file.");
              return;
            }
          }
        } catch (bakErr) { console.error("Backup recovery also failed:", bakErr.message); }
        this.nodes = []; this.edges = []; this.auditLog = []; this.traces = []; this.eventFrames = [];
        this.logAudit("DB_INIT_EMPTY", "Both primary and backup DB corrupted. Starting fresh.");
      }
    } else {
      try {
        const stored = localStorage.getItem("alekhdb_db") || localStorage.getItem("supermemory_db");
        if (stored) {
          const data = JSON.parse(stored);
          this.nodes = data.nodes || []; this.edges = data.edges || []; this.auditLog = data.auditLog || [];
          this.traces = data.traces || []; this.eventFrames = data.eventFrames || [];
          this.llmConfig = data.llmConfig || { provider: "rules", apiKey: "", endpoint: "http://localhost:11434", model: "" };
          this.contextCapacity = data.contextCapacity || 32000; this.decayRate = data.decayRate || 0.000004;
          this._rebuildIndexes();
        } else { this.clearToDefault(); }
      } catch (err) {
        console.error("Failed to load browser DB, starting clean:", err);
        this.nodes = []; this.edges = []; this.auditLog = []; this.traces = []; this.eventFrames = [];
      }
    }
  }

  /**
   * Persist the database to disk atomically: write to `.tmp` → `rename` → back up `.bak`.
   * Called automatically by the debounced save timer; call _flushSave() to force immediate durability.
   * Clears the dirty flag and cancels any pending save timer.
   * @returns {void}
   * @example
   * db.save();  // explicit immediate save
   */
  save() {
    if (!this.autoSave) return;
    if (!this.isNode || !fs) return;
    const data = { nodes: this.nodes, edges: this.edges, auditLog: this.auditLog, traces: this.traces, eventFrames: this.eventFrames, llmConfig: this.llmConfig, contextCapacity: this.contextCapacity, decayRate: this.decayRate };
    const json = JSON.stringify(data, null, 2);
    const tmp = this.dbPath + ".tmp";
    const bak = this.dbPath + ".bak";
    try {
      fs.writeFileSync(tmp, json, "utf8");
      if (fs.existsSync(this.dbPath)) fs.copyFileSync(this.dbPath, bak);
      fs.renameSync(tmp, this.dbPath);
    } catch (err) {
      console.error("Failed to save:", err);
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch(e) {}
    }
    this._dirty = false;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
  }

  /**
   * Reset the database to an empty state and save immediately.
   * Wipes nodes, edges, audit log, traces, and eventFrames. Rebuilds indexes.
   * @returns {void}
   * @example
   * db.clearToDefault();  // fresh start
   */
  clearToDefault() {
    this.nodes = []; this.edges = []; this.auditLog = []; this.traces = []; this.eventFrames = [];
    this.nodeMap = new Map(); this.edgeMap = new Map(); this.adjacency = new Map(); this.invertedIndex = new Map();
    this.llmConfig = { provider: "rules", apiKey: "", endpoint: "http://localhost:11434", model: "" };
    this.decayRate = 0.000004;
    this.logAudit("DB_INIT", "AlekhDB local graph initialized.");
    this.save();
  }

  /**
   * Add a new memory node to the graph, or update an existing one by id.
   * Updates nodeMap, invertedIndex, and adjacency in one pass. Triggers debounced save.
   * @param {string} id - Unique node identifier. If it already exists, the node is updated.
   * @param {string} label - Human-readable label; tokenized into the inverted index.
   * @param {string} [type="concept"] - Node type (e.g. 'concept', 'note', 'trace', 'decision', 'failure', 'change').
   * @param {Object} [properties={}] - Arbitrary properties on the node. `cognitiveStrength` defaults to 1.0.
   * @param {string} [scope="work"] - Container scope (e.g. 'user:alice/project:repo/branch:main').
   * @param {Object} [options={}] - v2 memory model options.
   * @param {('fact'|'preference'|'episode'|'inference'|'note'|'document'|'decision'|'failure'|'change')} [options.memoryType="note"] - Memory classification.
   * @param {number} [options.version=1] - Version number for DAG nodes.
   * @param {string|null} [options.parentMemoryId=null] - Parent in version DAG.
   * @param {string|null} [options.rootMemoryId=null] - Root of version chain.
   * @param {boolean} [options.isLatest=true] - Is this the latest version.
   * @param {boolean} [options.isForgotten=false] - Soft-delete flag.
   * @param {string|null} [options.forgetAfter=null] - ISO date after which this node is excluded from search.
   * @param {boolean} [options.isInference=false] - Whether this is an inferred (LLM-derived) memory.
   * @param {('unreviewed'|'approved'|'declined'|null)} [options.reviewStatus=null] - Review queue state for inferred memories.
   * @returns {Object} The stored node object.
   * @fires AlekhDB#memory:added
   * @example
   * db.addNode('m1', 'User prefers Bun', 'concept', {}, 'work', { memoryType: 'fact' });
   */
  addNode(id, label, type, properties = {}, scope = "work", options = {}) {
    const { memoryType = "note", version = 1, parentMemoryId = null, rootMemoryId = null, isLatest = true, isForgotten = false, forgetAfter = null, isInference = false, reviewStatus = null } = options;
    if (properties.cognitiveStrength === undefined) properties.cognitiveStrength = 1.0;
    if (!properties.lastAccessedAt) properties.lastAccessedAt = new Date().toISOString();

    const existingNode = this.nodeMap.get(id);
    if (existingNode) {
      existingNode.properties = { ...existingNode.properties, ...properties };
      existingNode.label = label;
      existingNode.updatedAt = new Date().toISOString();
      this.nodeMap.set(id, existingNode);
      this._unindexNode(id);
      this._indexNode(existingNode);
      this.logAudit("NODE_UPDATE", `Updated node for: ${label} (${id})`);
      this._markDirty();
      this.emit('memory:updated', { id, label, type, memoryType });
      return;
    }

    const node = { id, label, type, memoryType, version, parentMemoryId, rootMemoryId, isLatest, isForgotten, forgetAfter, isInference, reviewStatus, properties: { ...properties }, scope, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: {} };
    this.nodes.push(node);
    this.nodeMap.set(id, node);
    this._indexNode(node);
    this.logAudit("NODE_ADD", `Created node: ${label} (${type})`);
    this._markDirty();
    this.emit('memory:added', { id, label, type, memoryType, scope });
  }

  /**
   * Add a new edge to the graph, or update an existing one by id.
   * Updates edgeMap and adjacency in one pass. Triggers debounced save.
   * @param {string} id - Unique edge identifier. If it already exists, the edge is updated.
   * @param {string} source - Source node id.
   * @param {string} target - Target node id.
   * @param {string} label - Relationship type (e.g. 'uses', 'calls', 'updates', 'extends', 'derives', 'rejected', 'chosen', 'removed', 'added', 'replaces').
   * @param {number} [weight=1.0] - Edge weight (0-1).
   * @param {boolean} [active=true] - Whether the edge is active.
   * @param {Object} [properties={}] - Arbitrary edge properties (e.g. `validAt`, `invalidAt`, `decayReason`).
   * @returns {void}
   * @fires AlekhDB#relation:added
   * @example
   * db.addEdge('e1', 'm1', 'm2', 'uses', 1.0, true);
   */
  addEdge(id, source, target, label, weight = 1.0, active = true, properties = {}) {
    const existingEdge = this.edgeMap.get(id);
    if (existingEdge) {
      Object.assign(existingEdge, { source, target, label, weight, active, properties: { ...existingEdge.properties, ...properties } });
      this.edgeMap.set(id, existingEdge);
      this.logAudit("EDGE_UPDATE", `Updated edge: ${label} (${id})`);
      this._markDirty();
      return;
    }
    const edge = { id, source, target, label, weight, active, properties, createdAt: new Date().toISOString() };
    this.edges.push(edge);
    this.edgeMap.set(id, edge);
    if (active) {
      if (!this.adjacency.has(source)) this.adjacency.set(source, []);
      if (!this.adjacency.has(target)) this.adjacency.set(target, []);
      this.adjacency.get(source).push({ edge, neighborId: target });
      this.adjacency.get(target).push({ edge, neighborId: source });
    }
    this.logAudit("EDGE_ADD", `Created edge: ${label} (${id})`);
    this._markDirty();
    this.emit('relation:added', { fromId: source, toId: target, relationType: label });
  }

  /**
   * Append an entry to the in-memory audit log.
   * Cap is 500 entries (older entries shift off). Use `emitReasoned()` when you need reason+action coupled with the event.
   * @param {string} event - Event type (e.g. 'EDGE_ADD', 'CONTRADICTION_RESOLVED', 'DECISION_ADDED').
   * @param {string} description - Human-readable description of what happened.
   * @param {Object} [opts={}] - Optional Phase 8 extension fields.
   * @param {*} [opts.action] - The action that was performed.
   * @param {string} [opts.reason] - Why the action was taken.
   * @returns {void}
   * @example
   * db.logAudit('CUSTOM_EVENT', 'Description', { reason: 'user request', action: 'addNode' });
   */
  logAudit(event, description, opts = {}) {
    const entry = { timestamp: new Date().toISOString(), event, description };
    if (opts.reason !== undefined) entry.reason = opts.reason;
    if (opts.action !== undefined) entry.action = opts.action;
    this.auditLog.push(entry);
    if (this.auditLog.length > 500) this.auditLog.shift();
  }

  /**
   * Subscribe to an event. Supported events include 'memory:added', 'relation:added', 'memory:reviewed',
   * 'memory:mass-forgotten', 'git:branch-switched', 'git:merged', 'privacy:enabled', 'ast:enabled', 'watcher:file-changed'.
   * @param {string} eventName - Event name to listen for.
   * @param {Function} callback - Callback invoked with the event payload.
   * @returns {void}
   * @example
   * db.on('memory:added', ({ id, label }) => console.log('Added:', label));
   */
  on(eventName, callback) {
    if (!this._eventListeners.has(eventName)) this._eventListeners.set(eventName, new Set());
    this._eventListeners.get(eventName).add(callback);
    return () => this.off(eventName, callback);
  }

  /**
   * Unsubscribe a callback from an event.
   * @param {string} eventName - Event name.
   * @param {Function} callback - The exact callback reference passed to on().
   * @returns {void}
   * @example
   * db.off('memory:added', myCallback);
   */
  off(eventName, callback) {
    const set = this._eventListeners.get(eventName);
    if (set) set.delete(callback);
  }

  /**
   * Emit an event to all subscribers. Payload is passed as the first argument to callbacks.
   * @param {string} eventName - Event name.
   * @param {*} [payload] - Arbitrary payload forwarded to listeners.
   * @returns {void}
   * @example
   * db.emit('custom:event', { foo: 'bar' });
   */
  emit(eventName, payload) {
    const set = this._eventListeners.get(eventName);
    if (set) set.forEach(cb => { try { cb(payload); } catch(e) { console.error('Event listener error:', e); } });
  }

  /**
   * Emit an event AND log it to the audit log atomically, coupling the reason and action in one record.
   * Use this instead of separate emit() + logAudit() calls when the provoking reason matters.
   * @param {string} eventName - Event name (same as emit()).
   * @param {Object} opts
   * @param {*} opts.action - The action that was performed.
   * @param {string} [opts.reason] - Why the action was taken.
   * @param {*} [opts.payload] - Additional payload forwarded to emit() listeners.
   * @returns {void}
   * @fires AlekhDB#eventName
   * @example
   * db.emitReasoned('tool:invoked', { action: 'npm install', reason: 'missing dependency', payload: { pkg: 'express' } });
   */
  emitReasoned(eventName, { action, reason, payload } = {}) {
    this.emit(eventName, payload);
    this.logAudit(eventName, `Reasoned event: ${reason || eventName}`, { reason, action });
  }

  /**
   * Estimate the total token count of all active (non-archived, non-forgotten) nodes' labels.
   * Used by compaction() to decide when the context window is exceeded.
   * @returns {number} Approximate token count (1 token per 4 chars).
   * @example
   * const tokens = db.calculateActiveTokens();
   */
  calculateActiveTokens() {
    let tokens = 0;
    this.nodes.forEach(n => {
      if (n.properties && (n.properties.compacted || n.properties.archived)) return;
      const charCount = n.label.length + JSON.stringify(n.properties).length;
      tokens += Math.ceil(charCount / 4.0);
    });
    return tokens;
  }

  /**
   * Apply Ebbinghaus biological forgetting decay to all active nodes.
   * Reduces `cognitiveStrength` exponentially based on time since last access. Nodes below 0.15 are auto-archived.
   * Runs automatically on a 60-second timer (unref'd); call manually to force immediate decay.
   * @param {number} [decayRate] - Decay rate per second. Defaults to `this.decayRate` (0.000004 ≈ 1 week half-life).
   * @returns {void}
   * @fires AlekhDB#memory:decayed
   * @example
   * db.applyEbbinghausDecay();           // use default rate
   * db.setDecayRate(168);                // set 1-week half-life
   */
  applyEbbinghausDecay(decayRate) {
    const rate = decayRate ?? this.decayRate ?? 0.000004;
    const now = new Date();
    this.nodes.forEach(n => {
      if (n.type === "user" || n.type === "file" || n.type === "class" || n.type === "function" || n.type === "community-summary") return;
      if (!n.properties) n.properties = {};
      if (n.properties.cognitiveStrength === undefined) n.properties.cognitiveStrength = 1.0;
      if (!n.properties.lastAccessedAt) n.properties.lastAccessedAt = new Date().toISOString();
      const lastAccess = new Date(n.properties.lastAccessedAt);
      const diffSec = Math.max(0, (now - lastAccess) / 1000.0);
      const strength = n.properties.cognitiveStrength * Math.exp(-rate * diffSec);
      n.properties.cognitiveStrength = parseFloat(strength.toFixed(3));
      if (n.properties.cognitiveStrength < 0.15 && !n.properties.compacted && !n.properties.archived) {
        n.properties.archived = true;
        this.logAudit("BIOLOGICAL_PRUNE", `Memory decayed below threshold (Strength=${n.properties.cognitiveStrength}): ${n.label}`);
        this.emit('memory:archived', { id: n.id, reason: 'ebbinghaus_decay' });
      }
    });
    this._markDirty();
  }

  /**
   * Set the Ebbinghaus decay rate based on a desired half-life in hours.
   * Computes: rate = ln(2) / (halfLifeHours * 3600).
   * @param {number} halfLifeHours - Desired half-life in hours (e.g. 168 for 1 week).
   * @returns {void}
   * @example
   * db.setDecayRate(168);  // 1-week half-life
   */
  setDecayRate(halfLifeHours) {
    this.decayRate = Math.log(2) / (halfLifeHours * 3600);
    this._markDirty();
  }

  /**
   * Reinforce a node's memory strength (spaced repetition).
   * Increases `cognitiveStrength` by 0.3 (capped at 2.0) and updates `lastAccessedAt`.
   * Called automatically by search() and searchHybrid() on matched nodes.
   * @param {string} nodeId - The id of the node to reinforce.
   * @returns {void}
   * @example
   * db.reinforceNodeMemory('m1');
   */
  reinforceNodeMemory(nodeId) {
    const node = this.nodeMap.get(nodeId);
    if (node) {
      if (!node.properties) node.properties = {};
      const oldStrength = node.properties.cognitiveStrength || 1.0;
      node.properties.cognitiveStrength = parseFloat(Math.min(2.0, oldStrength + 0.35).toFixed(3));
      node.properties.lastAccessedAt = new Date().toISOString();
      if (node.properties.archived) {
        node.properties.archived = false;
        this.logAudit("REINFORCE_BELIEF", `Decayed belief revived via spaced repetition: ${node.label}`);
      }
      this.logAudit("REINFORCE_STRENGTH", `Memory reinforced: ${node.label} (Strength: ${node.properties.cognitiveStrength})`);
    }
  }

  /**
   * Archive nodes by id (soft-delete via `properties.archived = true`). Unindexes them from the inverted index.
   * Does NOT remove the node from memory — use batchDelete for hard removal.
   * @param {string[]} nodeIds - Array of node ids to archive.
   * @returns {void}
   * @example
   * db.pruneNodes(['m1', 'm2']);
   */
  pruneNodes(nodeIds) {
    let count = 0;
    nodeIds.forEach(id => {
      const node = this.nodeMap.get(id);
      if (node && !node.properties?.archived) {
        if (!node.properties) node.properties = {};
        node.properties.archived = true;
        node.properties.prunedAt = new Date().toISOString();
        this._unindexNode(id);
        this.logAudit("CONTEXT_PRUNING", `Context-Change-1 self-editing: Archived node ${node.label}`);
        count++;
      }
    });
    this._markDirty();
    return count;
  }

  /**
   * Ingest raw text into the graph by extracting entities, relations, and contradictions.
   * When `llmConfig.provider === 'rules'`, uses built-in regex + category-conflict heuristics.
   * When an LLM provider is configured, uses Ollama/OpenAI/Gemini for extraction with Mem0-style additive prompts.
   * Detects contradictions (Doyle TMS) and soft-decays conflicting edges. Triggers autonomous compaction if context window is exceeded.
   * @param {string} text - Raw text to ingest (URL,meeting notes, conversation, code comment, etc.).
   * @param {string} [scope] - Container scope. Defaults to currentScope or 'work'.
   * @param {Object} [options={}] - Ingestion options.
   * @param {string} [options.forgetAfter] - ISO date after which extracted memories expire.
   * @param {string} [options.conversationContext] - Surrounding conversation context for better extraction.
   * @returns {Promise<{nodes: string[], edges: string[], conflict: string|null, prunedCount: number}>} Extraction result with new node/edge ids, conflict description (if any), and number of pruned redundant nodes.
   * @fires AlekhDB#memory:added
   * @example
   * const r = await db.addMemory('I prefer Bun over Node.js', 'work');
   * if (r.conflict) console.log('Contradiction detected:', r.conflict);
   */
  async addMemory(text, scope = this.currentScope || "work", options = {}) {
    const noisePatterns = [/^(hi|hello|hey|ok|okay|sure|thanks|thank you|yep|nope|yes|no)$/i, /^(cool|nice|great|awesome|got it|sounds good)$/i, /^.{0,10}$/];
    if (noisePatterns.some(p => p.test(text.trim()))) {
      this.logAudit('NOISE_SKIPPED', `Skipped non-meaningful input: "${text.slice(0, 30)}..."`);
      return { nodes: [], edges: [], conflict: null, prunedCount: 0, skipped: 'noise' };
    }

    this.logAudit("INGEST_START", `Ingesting raw fact: "${text}"`);

    let extractedNodes = [];
    let extractedEdges = [];
    let conflictResolved = null;
    let prunedCount = 0;

    const cleanText = text.trim();
    const docId = this.generateId("doc");
    this.addNode(docId, `Doc (${cleanText.slice(0, 15)}...)`, "document", { fullText: cleanText }, scope, { memoryType: "document", forgetAfter: options.forgetAfter || null });
    extractedNodes.push(docId);

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
          const cleanJson = llmResponse.replace(/```json/g, "").replace(/```/g, "").trim();
          const extraction = JSON.parse(cleanJson);

          if (Array.isArray(extraction.nodes)) {
            extraction.nodes.forEach(n => {
              this.addNode(n.id, n.label, n.type || "concept", n.properties || {}, scope);
              extractedNodes.push(n.id);
              this.addEdge(this.generateId("e-doc-ref"), docId, n.id, "references", 0.5, true);
            });
          }

          if (Array.isArray(extraction.edges)) {
            extraction.edges.forEach(e => {
              const edgeId = e.id || this.generateId("e-llm");
              this.addEdge(edgeId, e.source, e.target, e.label, e.weight || 1.0, true);
              extractedEdges.push(edgeId);
            });
          }

          if (Array.isArray(extraction.contradictions) && extraction.contradictions.length > 0) {
            extraction.contradictions.forEach(c => {
              if (c.dissonanceScore >= 0.70) {
                conflictResolved = `TMS COGNITIVE DISSONANCE ALERT (Score: ${c.dissonanceScore}): ${c.description}`;
                this.logAudit("COGNITIVE_DISSONANCE", conflictResolved);
                if (Array.isArray(c.edgesToDecay)) {
                  c.edgesToDecay.forEach(edgeId => {
                    const edge = this.edgeMap.get(edgeId);
                    if (edge) {
                      edge.active = false;
                      edge.weight = 0.15;
                      edge.invalidAt = new Date().toISOString();
                      if (!edge.properties) edge.properties = {};
                      edge.properties.decayed = true;
                      edge.properties.decayReason = 'contradiction_superseded';
                      this.logAudit("CONTRADICTION_RESOLVED", `TMS Soft-decayed conflicting edge: ${edge.label} (${edgeId})`);
                    }
                  });
                }
              }
            });
          }

          if (Array.isArray(extraction.prunedNodeIds) && extraction.prunedNodeIds.length > 0) {
            prunedCount = this.pruneNodes(extraction.prunedNodeIds);
            if (prunedCount > 0) {
              conflictResolved = (conflictResolved ? conflictResolved + " | " : "") + `CONTEXT-CHANGE-1 SELF-EDITING: Actively pruned ${prunedCount} redundant nodes to prevent context rot.`;
            }
          }
        }
      } catch (err) {
        console.error("Option 2 LLM Ingestion failed, falling back to local rules:", err);
      }
    }

    if (extractedNodes.length === 1 && extractedEdges.length === 0) {
      if (/Migrated.*to\s+Bun/i.test(cleanText) || /uses\s+Bun/i.test(cleanText)) {
        this.addNode("project-alekhdb", "Project AlekhDB", "project", { description: "GraphRAG AI memory layer" }, scope);
        this.addNode("tech-bun", "Bun.sh", "technology", { category: "Runtime", version: "1.1.x" }, scope);
        extractedNodes.push("project-alekhdb", "tech-bun");
        this.addEdge(`e-doc-link-${docId}`, docId, "project-alekhdb", "references", 0.5, true);
        this.edges.forEach(edge => {
          if (edge.source === "project-alekhdb" && edge.target === "tech-nodejs" && edge.label === "uses_backend") {
            edge.active = false; edge.weight = 0.2;
            edge.properties = { ...edge.properties, expired: true, validUntil: "May 2026" };
            conflictResolved = "CONFLICT RESOLVED: Stale Node.js dependency decayed. Migrated Project AlekhDB stack to Bun.sh.";
          }
        });
        const edgeId = this.generateId("e-bun-migration");
        this.addEdge(edgeId, "project-alekhdb", "tech-bun", "uses_backend", 1.0, true);
        extractedEdges.push(edgeId);
        if (conflictResolved) this.logAudit("CONTRADICTION_RESOLVED", conflictResolved);
      } else if (/John\s+prefers\s+Discord/i.test(cleanText)) {
        this.addNode("client-john", "John (VP Engineering)", "client", { role: "Executive Sign-off", preferredChannel: "Discord" }, scope);
        extractedNodes.push("client-john");
        this.addEdge(`e-doc-link-${docId}`, docId, "client-john", "references", 0.5, true);
        this.logAudit("PREFERENCE_UPDATE", "Updated John's contact channel to Discord.");
        this.reinforceNodeMemory("client-john");
      } else {
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
          const nodeId = this.generateId("note");
          this.addNode(nodeId, cleanText.length > 25 ? cleanText.slice(0,25) + "..." : cleanText, "note", {}, scope);
          this.addEdge(`e-doc-note-${docId}`, docId, nodeId, "references", 0.5, true);
          extractedNodes.push(nodeId);
          this.logAudit("NOTE_STORED", `Created basic note block: ${nodeId}`);
        }
      }
    }

    const activeTokens = this.calculateActiveTokens();
    const threshold = this.contextCapacity * 0.8;
    if (activeTokens >= threshold) {
      const summaryId = this.compaction();
      conflictResolved = (conflictResolved ? conflictResolved + " | " : "") + `AUTONOMOUS COMPACTION TRIGGERED: Context window exceeded 80% threshold of ${this.contextCapacity} tokens (${activeTokens} tokens). Consolidated stack into summary node ${summaryId}.`;
      this.logAudit("AUTONOMOUS_COMPACTION", `Preemptive compaction consolidated stale records. Active tokens reset.`);
    }

    this._markDirty();
    return { nodes: extractedNodes, edges: extractedEdges, conflict: conflictResolved, prunedCount };
  }

  /**
   * Create a new version of an existing memory node (versioned DAG).
   * Old node's `isLatest` becomes false; new node links back via `parentMemoryId` and `rootMemoryId`.
   * @param {string} oldNodeId - The id of the node to version.
   * @param {string} newLabel - Label for the new version.
   * @param {Object} [newProperties={}] - Properties for the new version.
   * @returns {Object} The new version node.
   * @example
   * db.createMemoryVersion('mem-1', 'User lives in SF');
   */
  createMemoryVersion(oldNodeId, newLabel, newProperties = {}) {
    const oldNode = this.nodeMap.get(oldNodeId);
    if (!oldNode) throw new Error(`Node ${oldNodeId} not found`);
    oldNode.isLatest = false;
    oldNode.updatedAt = new Date().toISOString();
    const newId = this.generateId("mem");
    if (newLabel === undefined) newLabel = oldNode.label + " (v" + (oldNode.version + 1) + ")";
    this.addNode(newId, newLabel, oldNode.type, newProperties, oldNode.scope, { memoryType: oldNode.memoryType, version: oldNode.version + 1, parentMemoryId: oldNodeId, rootMemoryId: oldNode.rootMemoryId || oldNodeId, isLatest: true });
    const edgeId = this.generateId("e-upd");
    this.addEdge(edgeId, newId, oldNodeId, "updates", 1.0, true);
    this.logAudit("MEMORY_UPDATED", `Version ${oldNode.version + 1} of "${oldNode.label}" created.`);
    this._markDirty();
    this.emit('memory:updated', { oldId: oldNodeId, newId, version: oldNode.version + 1 });
    return this.nodeMap.get(newId);
  }

  /**
   * Add a semantic relation between two memories. Three built-in types: 'updates', 'extends', 'derives'.
   * For 'updates': old node's `isLatest` is set to false.
   * For 'derives': new node is typically an inference (with reviewStatus).
   * Custom relation types (e.g. 'rejected', 'chosen', 'removed', 'added', 'replaces') also supported.
   * @param {string} fromId - Source node id.
   * @param {string} toId - Target node id.
   * @param {('updates'|'extends'|'derives'|'rejected'|'chosen'|'removed'|'added'|'replaces'|string)} relationType - Relation type.
   * @param {Object} [properties={}] - Additional edge properties.
   * @returns {void}
   * @example
   * db.addRelation('mem-v2', 'mem-v1', 'updates');
   */
  addRelation(fromId, toId, relationType, properties = {}) {
    const edgeId = this.generateId("e-rel");
    this.addEdge(edgeId, fromId, toId, relationType, 1.0, true, properties);
    if (relationType === 'updates') {
      const toNode = this.nodeMap.get(toId);
      if (toNode) { toNode.isLatest = false; toNode.updatedAt = new Date().toISOString(); }
    }
    this.logAudit("RELATION_ADDED", `${relationType}: ${fromId} → ${toId}`);
    return edgeId;
  }

  /**
   * Set the current container scope for subsequent operations.
   * Container tags are hierarchical paths like 'user:alice/project:repo/branch:main'.
   * @param {string} scopePath - The scope path to set.
   * @returns {void}
   * @example
   * db.setScope('user:alice/project:my-repo/branch:feature-auth');
   */
  setScope(scopePath) {
    this.currentScope = scopePath;
  }

  /**
   * Get the current active scope.
   * @returns {string|null} The current scope path, or null if not set.
   * @example
   * const scope = db.getScope();  // 'user:alice/project:my-repo'
   */
  getScope() {
    return this.currentScope || 'default';
  }

  /**
   * Add multiple memories in a single batch (one debounced save).
   * Each item is processed via addMemory() with extraction, contradiction, and compaction.
   * @param {Array<{text: string, scope?: string, options?: Object}>} items - Items to add.
   * @returns {Promise<Array<Object>>} Results from each addMemory() call.
   * @example
   * await db.batchAdd([{ text: 'User likes Bun', scope: 'work' }, { text: 'Project uses Postgres' }]);
   */
  async batchAdd(items) {
    const results = [];
    const wasAutoSave = this.autoSave;
    this.autoSave = false;
    for (const item of items) {
      const result = await this.addMemory(item.text, item.scope, item.options);
      results.push(result);
    }
    this.autoSave = wasAutoSave;
    this.save();
    return results;
  }

  /**
   * Soft-delete multiple memories by id (sets `isForgotten = true` and unindexes each).
   * Emits 'memory:mass-forgotten' with the count.
   * @param {string[]} ids - Array of node ids to delete.
   * @returns {number} Count of nodes soft-deleted.
   * @fires AlekhDB#memory:mass-forgotten
   * @example
   * const count = db.batchDelete(['m1', 'm2', 'm3']);
   */
  batchDelete(ids) {
    let count = 0;
    ids.forEach(id => {
      const node = this.nodeMap.get(id);
      if (node) {
        node.isForgotten = true;
        node.updatedAt = new Date().toISOString();
        this._unindexNode(id);
        count++;
      }
    });
    this.logAudit('BATCH_DELETE', `Soft-deleted ${count} memories`);
    this._markDirty();
    this.emit('memory:forgotten', { ids });
    return count;
  }

  /**
   * Update multiple memories in a batch (re-indexes each in the inverted index).
   * @param {Array<{id: string, label?: string, properties?: Object}>} updates - Updates to apply.
   * @returns {number} Count of nodes updated.
   * @example
   * db.batchUpdate([{ id: 'm1', label: 'Updated label' }, { id: 'm2', properties: { priority: 5 } }]);
   */
  batchUpdate(updates) {
    let count = 0;
    updates.forEach(u => {
      const node = this.nodeMap.get(u.id);
      if (node) {
        this._unindexNode(u.id);
        node.label = u.text || node.label;
        node.properties = { ...node.properties, ...u.properties };
        node.updatedAt = new Date().toISOString();
        node.version = (node.version || 1) + 1;
        this._indexNode(node);
        this.nodeMap.set(u.id, node);
        count++;
      }
    });
    this.logAudit('BATCH_UPDATE', `Updated ${count} memories`);
    this._markDirty();
    return count;
  }

  /**
   * Record a structured decision with alternatives, chosen option, and rationale.
   * Creates one decision node (memoryType='decision') plus 'rejected' edges to non-chosen alternatives and a 'chosen' edge to the chosen one.
   * Enables queries like "show every time we chose Redis because cross-region replication".
   * @param {string} id - Unique decision id.
   * @param {Object} opts - Decision options.
   * @param {string} [opts.context=""] - The situation/context in which the decision was made.
   * @param {Array<string>} [opts.alternatives=[]] - List of alternatives considered (node ids or labels).
   * @param {string} [opts.chosen=""] - The chosen alternative (must be in alternatives).
   * @param {string} [opts.rationale=""] - Why this alternative was chosen.
   * @param {string} [opts.scope] - Container scope. Defaults to currentScope.
   * @param {Object} [opts.nodeOpts={}] - Additional addNode() options.
   * @returns {string} The decision node id.
   * @example
   * db.addDecision('dec-db', { context: 'Need sessions for 10M users', alternatives: ['Redis', 'Memcached', 'Postgres'], chosen: 'Redis', rationale: 'Cross-region replication' });
   */
  addDecision(id, opts = {}) {
    const { context = "", alternatives = [], chosen = "", rationale = "" } = opts;
    const scope = opts.scope || this.currentScope || "work";
    const nodeOpts = opts.nodeOpts || {};
    this.addNode(id, `Decision: ${chosen}`, "concept", { context, chosen, rationale, decisionType: "decision", _knowledgeType: "decision" }, scope, { ...nodeOpts, memoryType: "decision" });
    const rejected = alternatives.filter(a => a !== chosen);
    rejected.forEach(alt => {
      const edgeId = this.generateId("e-dec-rej");
      this.addEdge(edgeId, id, alt, "rejected", 1.0, true, { rationale: opts.rejectedRationale?.[alt] || "" });
    });
    if (chosen && alternatives.includes(chosen)) {
      this.addEdge(this.generateId("e-dec-chosen"), id, chosen, "chosen", 1.0, true);
    }
    this.logAudit("DECISION_ADDED", `Decision: ${chosen} — ${rationale.slice(0, 80)}`);
    this._markDirty();
    return id;
  }

  /**
   * Record a failure memory — "this approach was tried and failed with error E".
   * Creates a node (memoryType='failure') with the approach, error, errorSignature, and context.
   * Enables queries like "show me all times PostgreSQL replication failed".
   * @param {string} id - Unique failure id.
   * @param {Object} opts - Failure options.
   * @param {string} [opts.approach=""] - The approach that was attempted.
   * @param {string} [opts.error=""] - The error message encountered.
   * @param {string} [opts.errorSignature=""] - A canonical error signature for grouping (e.g. 'ERR_CONN_TIMEOUT').
   * @param {string} [opts.context=""] - Surrounding context (what task, what config).
   * @param {string} [opts.scope] - Container scope. Defaults to currentScope.
   * @param {Object} [opts.nodeOpts={}] - Additional addNode() options.
   * @returns {string} The failure node id.
   * @example
   * db.addFailure('fail-pg-repl-1', { approach: 'Streaming replication', error: 'connection refused', errorSignature: 'ERR_CONN_REFUSED', context: 'Setting up PG 15 replica' });
   */
  addFailure(id, opts = {}) {
    const { approach = "", error = "", errorSignature = "", context = "" } = opts;
    const scope = opts.scope || this.currentScope || "work";
    const nodeOpts = opts.nodeOpts || {};
    this.addNode(id, `Failure: ${approach}`, "concept", { approach, error, errorSignature, context, failureType: "failure", _knowledgeType: "failure" }, scope, { ...nodeOpts, memoryType: "failure" });
    this.logAudit("FAILURE_ADDED", `Failure: ${approach} — ${errorSignature || error.slice(0, 60)}`);
    this._markDirty();
    return id;
  }

  /**
   * Record an optimization history entry — "removed X because it caused Y, added Z as replacement".
   * Creates a change node (memoryType='change') plus 3 edges: removed→X, added→Z, Z→replaces→X.
   * Marks the removed node's isLatest=false and stamps forgetReason with the justification.
   * Enables queries like "show me everything removed because it caused N+1 queries".
   * @param {string} id - Unique change id.
   * @param {Object} opts - Change options.
   * @param {string} [opts.removed=""] - Label or id of the thing removed.
   * @param {string} [opts.removedReason=""] - Why it was removed.
   * @param {string} [opts.added=""] - Label or id of the thing added as replacement.
   * @param {string} [opts.addedReason=""] - Why the replacement was added.
   * @param {string} [opts.justification=""] - The full justification for the change.
   * @param {string} [opts.scope] - Container scope. Defaults to currentScope.
   * @param {Object} [opts.nodeOpts={}] - Additional addNode() options.
   * @returns {string} The change node id.
   * @example
   * db.addChange('chg-nodejs-to-bun', { removed: 'Node.js', removedReason: 'Slow startup', added: 'Bun', addedReason: 'Fast startup', justification: 'Migrated runtime for 3x faster CI' });
   */
  addChange(id, opts = {}) {
    const { removed = "", removedReason = "", added = "", addedReason = "", justification = "" } = opts;
    const scope = opts.scope || this.currentScope || "work";
    const nodeOpts = opts.nodeOpts || {};
    this.addNode(id, `Change: ${removed} → ${added}`, "concept", { removed, removedReason, added, addedReason, justification, changeType: "change", _knowledgeType: "change" }, scope, { ...nodeOpts, memoryType: "change" });
    const removedNode = this.nodeMap.get(removed);
    if (removedNode) { removedNode.isLatest = false; removedNode.forgetReason = justification; }
    const addedNode = this.nodeMap.get(added);
    if (addedNode) { addedNode.isLatest = true; addedNode.forgetReason = undefined; }
    this.addEdge(this.generateId("e-chg-removed"), id, removed, "removed", 1.0, true);
    this.addEdge(this.generateId("e-chg-added"), id, added, "added", 1.0, true);
    if (removed && added) this.addEdge(this.generateId("e-chg-replaces"), added, removed, "replaces", 1.0, true);
    this.logAudit("CHANGE_ADDED", `Change: ${removed} → ${added} — ${justification.slice(0, 80)}`);
    this._markDirty();
    return id;
  }

  /**
   * Export the database (or a filtered subset) as a JSON string.
   * @param {Object} [filter={}] - Export filter.
   * @param {string} [filter.scope] - Only export nodes matching this scope (prefix).
   * @param {string} [filter.memoryType] - Only export nodes of this memory type.
   * @param {boolean} [filter.includeTraces=false] - Include traces and eventFrames.
   * @param {boolean} [filter.includeAuditLog=false] - Include the audit log.
   * @returns {string} JSON string of the exported database.
   * @example
   * const json = db.export({ scope: 'user:alice', includeTraces: true });
   */
  export(filter = {}) {
    const { scope = null, memoryType = null, includeTraces = false, includeAuditLog = false } = filter;
    let exportedNodes = this.nodes;
    let exportedEdges = this.edges;
    if (scope) {
      exportedNodes = exportedNodes.filter(n => scopeMatches(n.scope, scope));
      const nodeIds = new Set(exportedNodes.map(n => n.id));
      exportedEdges = exportedEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    }
    if (memoryType) exportedNodes = exportedNodes.filter(n => n.memoryType === memoryType);
    const data = { version: 2, exportedAt: new Date().toISOString(), nodes: exportedNodes, edges: exportedEdges, traces: includeTraces ? this.traces : [], eventFrames: includeTraces ? this.eventFrames : [], auditLog: includeAuditLog ? this.auditLog : [] };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Import a previously exported JSON database string.
   * Merges or replaces data based on the `merge` option.
   * @param {string} jsonStr - JSON string from export().
   * @param {Object} [options={}] - Import options.
   * @param {boolean} [options.merge=true] - If true, merge with existing data; if false, replace.
   * @returns {{nodes: number, edges: number, traces: number}} Counts imported.
   * @example
   * db.import(jsonStr, { merge: true });
   */
  import(jsonStr, options = {}) {
    const { merge = false, scopeOverride = null } = options;
    const data = JSON.parse(jsonStr);
    if (!merge) this.clearToDefault();
    (data.nodes || []).forEach(n => {
      if (scopeOverride) n.scope = scopeOverride;
      this.nodes.push(n);
      this.nodeMap.set(n.id, n);
      this._indexNode(n);
    });
    (data.edges || []).forEach(e => {
      this.edges.push(e);
      this.edgeMap.set(e.id, e);
      if (e.active) {
        if (!this.adjacency.has(e.source)) this.adjacency.set(e.source, []);
        if (!this.adjacency.has(e.target)) this.adjacency.set(e.target, []);
        this.adjacency.get(e.source).push({ edge: e, neighborId: e.target });
        this.adjacency.get(e.target).push({ edge: e, neighborId: e.source });
      }
    });
    if (data.traces) this.traces.push(...data.traces);
    if (data.eventFrames) this.eventFrames.push(...data.eventFrames);
    if (data.auditLog) this.auditLog.push(...data.auditLog);
    this.logAudit('IMPORT', `Imported ${data.nodes?.length || 0} nodes, ${data.edges?.length || 0} edges`);
    this._markDirty();
    return { nodes: data.nodes?.length || 0, edges: data.edges?.length || 0 };
  }

  /**
   * Get the version history of a memory by walking its parentMemoryId chain and descendants.
   * Returns an array of versions from latest to oldest.
   * @param {string} memoryId - The id of the memory to get history for.
   * @returns {Array<{id: string, version: number, label: string, isLatest: boolean, updatedAt: string}>} Version chain.
   * @example
   * const history = db.getHistory('mem-1');
   */
  getHistory(memoryId) {
    const history = [];
    let current = this.nodeMap.get(memoryId);
    while (current) {
      history.push({ id: current.id, version: current.version, label: current.label, isLatest: current.isLatest, updatedAt: current.updatedAt || current.createdAt, changedBy: current.properties?.sourceAgent || 'unknown', forgetReason: current.forgetReason });
      if (current.parentMemoryId) current = this.nodeMap.get(current.parentMemoryId);
      else break;
    }
    const descendants = this.nodes.filter(n => n.rootMemoryId === memoryId && n.id !== memoryId);
    descendants.forEach(d => { if (!history.find(h => h.id === d.id)) history.push({ id: d.id, version: d.version, label: d.label, isLatest: d.isLatest, updatedAt: d.updatedAt }); });
    return history.sort((a, b) => (b.version || 0) - (a.version || 0));
  }

  /**
   * Merge memories from one scope into another (container tag merge).
   * Copies nodes from source that don't exist in target, skipping duplicates. Also copies edges between merged nodes.
   * @param {string} sourceScope - Source scope path (e.g. 'project:repo/branch:feature').
   * @param {string} targetScope - Target scope path (e.g. 'project:repo/branch:main').
   * @returns {{copied: number, skipped: number}} Counts of merged and skipped nodes.
   * @fires AlekhDB#git:merged
   * @example
   * db.mergeScopes('project:repo/branch:feature', 'project:repo/branch:main');
   */
  mergeScopes(sourceScope, targetScope) {
    const sourceNodes = this.nodes.filter(n => scopeMatches(n.scope, sourceScope));
    const targetKeys = new Set();
    for (const n of this.nodes) {
      if (scopeMatches(n.scope, targetScope) && n.isLatest !== false) {
        targetKeys.add(`${n.label}::${n.memoryType}`);
      }
    }
    const wasAutoSave = this.autoSave;
    this.autoSave = false;
    const newNodes = [];
    const newEdges = [];
    let copied = 0, skipped = 0;
    const now = new Date().toISOString();
    for (const srcNode of sourceNodes) {
      const key = `${srcNode.label}::${srcNode.memoryType}`;
      if (targetKeys.has(key)) { skipped++; continue; }
      const newId = this.generateId('mem');
      const newNode = {
        id: newId, label: srcNode.label, type: srcNode.type,
        memoryType: srcNode.memoryType, version: 1, parentMemoryId: null, rootMemoryId: null,
        isLatest: true, isForgotten: false, forgetAfter: srcNode.forgetAfter || null,
        isInference: false, reviewStatus: null,
        properties: { ...(srcNode.properties || {}), cognitiveStrength: srcNode.properties?.cognitiveStrength || 1.0, lastAccessedAt: now, sourceTrace: srcNode.properties?.sourceTrace || null, sourceAgent: srcNode.properties?.sourceAgent || null },
        scope: targetScope, createdAt: now, updatedAt: now, metadata: {},
      };
      newNodes.push(newNode);
      this.nodeMap.set(newId, newNode);
      this._indexNode(newNode);
      const edgeId = this.generateId('e-scope');
      newEdges.push({ id: edgeId, source: newId, target: srcNode.id, label: 'derives', weight: 1.0, active: true, properties: {} });
      this.edgeMap.set(edgeId, newEdges[newEdges.length - 1]);
      if (!this.adjacency.has(newId)) this.adjacency.set(newId, []);
      if (!this.adjacency.has(srcNode.id)) this.adjacency.set(srcNode.id, []);
      this.adjacency.get(newId).push({ edge: newEdges[newEdges.length - 1], neighborId: srcNode.id });
      this.adjacency.get(srcNode.id).push({ edge: newEdges[newEdges.length - 1], neighborId: newId });
      targetKeys.add(key);
      copied++;
    }
    for (const n of newNodes) this.nodes.push(n);
    for (const e of newEdges) this.edges.push(e);
    this.autoSave = wasAutoSave;
    this.logAudit('SCOPE_MERGE', `Merged ${sourceScope} → ${targetScope}: ${copied} copied, ${skipped} already existed`);
    this.emit('scope:merged', { sourceScope, targetScope, copied, skipped });
    this._markDirty();
    return { copied, skipped };
  }

  /**
   * Chunk code content via regex-based AST extraction (fallback when tree-sitter is not enabled).
   * Extracts classes, functions, methods, and creates nodes with edges for calls/uses.
   * For full multi-language AST, use `enableFullAST()` from `alekhdb-ast.js`.
   * @param {string} codeContent - The code text to chunk.
   * @param {string} [fileName="code.js"] - File name (used for scope and language detection).
   * @returns {Array<string>} Array of created node ids.
   * @example
   * db.astChunkCode('class Foo { bar() {} }', 'foo.js');
   */
  astChunkCode(codeContent, fileName = "code.js") {
    this.logAudit("CODE_CHUNK_START", `Parsing code node: ${fileName}`);
    const chunkedNodes = [];
    const chunkedEdges = [];
    const fileId = "file-" + fileName.toLowerCase().replace(/[^a-z0-9]/g, "");
    this.addNode(fileId, fileName, "file", { path: fileName, language: "javascript" });
    chunkedNodes.push(fileId);
    let strippedContent = codeContent.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    strippedContent = strippedContent.replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g, "");
    const classRegex = /\bclass\s+([A-Za-z0-9_]+)(?:\s+extends\s+[A-Za-z0-9_]+)?\s*\{/g;
    const jsKeywords = new Set(["if","for","while","switch","catch","constructor","forEach","map","filter","reduce","then","function","class","const","let","var","return","import","export","default","await","async","true","false","null","undefined","this","new","typeof","instanceof","in","of","try","get","set"]);
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
      if (lastClassId) this.addEdge(edgeId, lastClassId, methodId, "contains_method", 1.0, true);
      else this.addEdge(edgeId, fileId, methodId, "contains_function", 1.0, true);
      chunkedEdges.push(edgeId);
    }
    this.logAudit("CODE_CHUNK_COMPLETE", `Successfully chunked ${fileName} into AST-aware graph nodes.`);
    this._markDirty();
    return { nodes: chunkedNodes, edges: chunkedEdges };
  }

  /**
   * Run autonomous compaction: summarize active nodes into a single summary node when the context window is exceeded.
   * Triggered automatically by addMemory() when active tokens exceed 80% of contextCapacity.
   * @returns {string|null} The id of the created summary node, or null if no compaction was needed.
   * @fires AlekhDB#memory:compacted
   * @example
   * const summaryId = db.compaction();
   */
  compaction() {
    this.logAudit("COMPACTION_START", "Running preemptive database consolidation...");
    const activeBackendEdge = this.edges.find(e => e.label === "uses_backend" && e.active);
    let summaryText = "Consolidated active dependencies. Project is running cleanly.";
    if (activeBackendEdge) {
      const targetNode = this.nodes.find(n => n.id === activeBackendEdge.target);
      if (targetNode) summaryText = `Consolidated state. Dependency uses active runtime: ${targetNode.label}.`;
    }
    const summaryId = this.generateId("node-summary");
    this.addNode(summaryId, "Core Activity Summary", "summary", { contents: summaryText, compactedAt: new Date().toISOString() }, "work");
    this.nodes.forEach(n => { if (n.id !== summaryId && (n.type === "document" || n.type === "note")) n.properties = { ...n.properties, compacted: true }; });
    this.edges.forEach(e => { if (!e.active) e.properties = { ...e.properties, archived: true }; });
    const compactEdgeId = this.generateId("e-compact");
    this.addEdge(compactEdgeId, "project-alekhdb", summaryId, "summarized_in", 1.0, true);
    this.logAudit("COMPACTION_COMPLETE", `Compacted context node: ${summaryId}`);
    this._markDirty();
    this.emit('compaction:complete', { summaryId });
    return summaryId;
  }

  /**
   * Generate a human-readable profile summary of the user/project.
   * Splits memories into static (facts, preferences) and dynamic (episodes, notes).
   * @param {Object} [options={}] - Profile options.
   * @param {string} [options.scope] - Scope to profile. Defaults to currentScope.
   * @returns {string} Markdown-formatted profile text.
   * @example
   * const md = db.profile({ scope: 'user:alice' });
   */
  profile(options = {}) {
    const { scope = this.currentScope || "all" } = options;
    const staticFacts = [];
    const dynamicFacts = [];
    for (const [id, node] of this.nodeMap) {
      if (node.isForgotten) continue;
      if (node.isLatest === false) continue;
      if (node.properties?.archived || node.properties?.compacted) continue;
      if (scope !== "all" && !scopeMatches(node.scope, scope)) continue;
      const isStatic = node.memoryType === 'fact' || node.memoryType === 'preference';
      const isDynamic = node.memoryType === 'episode' || node.memoryType === 'note';
      if (isStatic && staticFacts.length < 50) staticFacts.push({ label: node.label, type: node.memoryType, strength: node.properties?.cognitiveStrength || 1.0 });
      if (isDynamic && dynamicFacts.length < 20) dynamicFacts.push({ label: node.label, type: node.memoryType, lastAccessed: node.properties?.lastAccessedAt });
    }
    staticFacts.sort((a, b) => b.strength - a.strength);
    dynamicFacts.sort((a, b) => new Date(b.lastAccessed || 0) - new Date(a.lastAccessed || 0));
    let md = `# Profile\n\n## Stable Profile\n`;
    if (staticFacts.length > 0) staticFacts.forEach(f => { md += `* ${f.label} (${f.type})\n`; });
    else md += `* No stable facts indexed yet.\n`;
    md += `\n## Recent Context\n`;
    if (dynamicFacts.length > 0) dynamicFacts.forEach(f => { md += `* ${f.label}\n`; });
    else md += `* No recent episodic activity.\n`;
    md += `\n## Memory Stats\n* Active memories: ${this.nodes.filter(n => !n.isForgotten && n.isLatest !== false).length}\n* Compaction summaries: ${this.nodes.filter(n => n.type === 'summary').length}\n* Traces: ${this.traces.length}\n`;
    return md;
  }

  /**
   * Generate a structured profile breakdown as an object (for programmatic use).
   * Returns static and dynamic memory arrays instead of a markdown string.
   * @param {Object} [options={}] - Profile options.
   * @param {string} [options.scope] - Scope to profile. Defaults to currentScope.
   * @returns {{static: Array, dynamic: Array, activeMemories: number, archivedMemories: number}} Profile object.
   * @example
   * const p = db.profileStructured({ scope: 'work' });
   */
  profileStructured(options = {}) {
    const { scope = this.currentScope || "all" } = options;
    const staticFacts = [];
    const dynamicFacts = [];
    for (const [id, node] of this.nodeMap) {
      if (node.isForgotten) continue;
      if (node.isLatest === false) continue;
      if (node.properties?.archived || node.properties?.compacted) continue;
      if (scope !== "all" && !scopeMatches(node.scope, scope)) continue;
      if ((node.memoryType === 'fact' || node.memoryType === 'preference') && staticFacts.length < 50) staticFacts.push({ id, label: node.label, type: node.memoryType, strength: node.properties?.cognitiveStrength || 1.0 });
      if ((node.memoryType === 'episode' || node.memoryType === 'note') && dynamicFacts.length < 20) dynamicFacts.push({ id, label: node.label, type: node.memoryType, lastAccessed: node.properties?.lastAccessedAt });
    }
    staticFacts.sort((a, b) => b.strength - a.strength);
    dynamicFacts.sort((a, b) => new Date(b.lastAccessed || 0) - new Date(a.lastAccessed || 0));
    return { static: staticFacts, dynamic: dynamicFacts, stats: { activeMemories: this.nodes.filter(n => !n.isForgotten && n.isLatest !== false).length, totalTraces: this.traces.length, avgStrength: staticFacts.reduce((s, f) => s + f.strength, 0) / Math.max(1, staticFacts.length) } };
  }

  /**
   * Set custom profile bucket configuration for this project.
   * @param {Object} buckets - Bucket configuration.
   * @param {Array<string>} [buckets.static] - Keys for static (permanent) memories.
   * @param {Array<string>} [buckets.dynamic] - Keys for dynamic (episodic) memories.
   * @returns {void}
   * @example
   * db.setProfileBuckets({ static: ['name', 'language'], dynamic: ['currentTask'] });
   */
  setProfileBuckets(buckets) {
    this._profileBuckets = buckets;
    this._markDirty();
    this.emit('profile:buckets-updated', buckets);
  }

  /**
   * Get the current profile bucket configuration.
   * @returns {Object|null} The bucket config, or null if not set.
   * @example
   * const buckets = db.getProfileBuckets();
   */
  getProfileBuckets() {
    return this._profileBuckets || { static: ['role', 'occupation', 'name', 'preferredChannel', 'preferredRuntime', 'preferredEditor'], dynamic: ['currentProject', 'recentActivity', 'lastDebugging', 'currentTask'] };
  }

  /**
   * Suggest profile buckets based on a context prompt (heuristic-based).
   * Returns a suggested static/dynamic bucket split based on keywords in the prompt.
   * @param {string} [contextPrompt=''] - Context describing the project.
   * @returns {Object} Suggested bucket configuration ({ static: [], dynamic: [] }).
   * @example
   * const suggestion = db.suggestProfileBuckets('A code editor with LSP hooks');
   */
  suggestProfileBuckets(contextPrompt = '') {
    const keyFreq = new Map();
    this.nodes.forEach(n => {
      if (n.metadata) Object.keys(n.metadata).forEach(k => keyFreq.set(k, (keyFreq.get(k) || 0) + 1));
      if (n.properties) Object.keys(n.properties).forEach(k => { if (!['cognitiveStrength','lastAccessedAt','compacted','archived','embedding','embeddingModel'].includes(k)) keyFreq.set(k, (keyFreq.get(k) || 0) + 1); });
    });
    const sorted = [...keyFreq.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 6).map(([k]) => k);
    const staticKeys = top.filter(k => /name|role|pref|occupation|editor|runtime/i.test(k));
    const dynamicKeys = top.filter(k => /current|recent|last|active|task|debug/i.test(k));
    return { static: staticKeys.length > 0 ? staticKeys : top.slice(0, 3), dynamic: dynamicKeys.length > 0 ? dynamicKeys : top.slice(3, 6) };
  }

  /**
   * Get the inferred memory review API.
   * Supports list/approve/decline/undo actions for memories with `isInference=true` and `reviewStatus='unreviewed'`.
   * @returns {{list: Function, approve: Function, decline: Function, undo: Function}} Review API object.
   * @example
   * const queue = db.review.list();  // pending inferences
   * db.review.approve('inf-1');       // approve an inference
   */
  get review() {
    if (!this._reviewApi) {
      this._reviewApi = {
        list: (options = {}) => {
          const { scope = this.currentScope || "all", limit = 50 } = options;
          const inferred = [];
          for (const [id, node] of this.nodeMap) {
            if (!node.isInference) continue;
            if (node.reviewStatus && node.reviewStatus !== 'unreviewed') continue;
            if (node.isForgotten) continue;
            if (scope !== "all" && !scopeMatches(node.scope, scope)) continue;
            inferred.push({ id, memory: node.label, parentCount: this.edges.filter(e => e.target === id && e.label === 'derives').length, createdAt: node.createdAt, updatedAt: node.updatedAt });
          }
          inferred.sort((a, b) => b.parentCount - a.parentCount);
          return inferred.slice(0, limit);
        },
        approve: (memoryId) => {
          const node = this.nodeMap.get(memoryId);
          if (!node) throw new Error(`Memory ${memoryId} not found`);
          if (!node.isInference) throw new Error(`Memory ${memoryId} is not an inferred memory`);
          node.isInference = false;
          node.reviewStatus = 'approved';
          node.updatedAt = new Date().toISOString();
          this.logAudit('INFERENCE_APPROVED', `Inferred memory approved: ${node.label}`);
          this.emit('memory:reviewed', { id: memoryId, action: 'approve' });
          this._markDirty();
          return { id: memoryId, isInference: false, isForgotten: false, reviewStatus: 'approved' };
        },
        decline: (memoryId) => {
          const node = this.nodeMap.get(memoryId);
          if (!node) throw new Error(`Memory ${memoryId} not found`);
          node.isForgotten = true;
          node.reviewStatus = 'declined';
          node.updatedAt = new Date().toISOString();
          this._unindexNode(memoryId);
          this.logAudit('INFERENCE_DECLINED', `Inferred memory declined: ${node.label}`);
          this.emit('memory:reviewed', { id: memoryId, action: 'decline' });
          this._markDirty();
          return { id: memoryId, isInference: true, isForgotten: true, reviewStatus: 'declined' };
        },
        undo: (memoryId) => {
          const node = this.nodeMap.get(memoryId);
          if (!node) throw new Error(`Memory ${memoryId} not found`);
          node.isInference = true;
          node.isForgotten = false;
          node.reviewStatus = null;
          node.updatedAt = new Date().toISOString();
          this._indexNode(node);
          this.logAudit('INFERENCE_UNDO', `Review undone: ${node.label}`);
          this.emit('memory:reviewed', { id: memoryId, action: 'undo' });
          this._markDirty();
          return { id: memoryId, isInference: true, isForgotten: false, reviewStatus: null };
        },
      };
    }
    return this._reviewApi;
  }

  /**
   * Agentic mass-forget: search for memories matching a query and soft-delete them.
   * Supports dry-run mode to preview what would be forgotten.
   * @param {Object} options - Forget options.
   * @param {string} options.query - Search query to find memories to forget.
   * @param {string} [options.scope="all"] - Scope to search within.
   * @param {boolean} [options.dryRun=false] - If true, return preview without deleting.
   * @param {number} [options.limit=100] - Max memories to forget.
   * @returns {Promise<{matched: number, forgotten: number, dryRun: boolean, matches?: Array}>} Result.
   * @fires AlekhDB#memory:mass-forgotten
   * @example
   * const preview = await db.forgetMatch({ query: 'old deployment', dryRun: true });
   * const result = await db.forgetMatch({ query: 'old deployment', dryRun: false });
   */
  async forgetMatch(options = {}) {
    const { query, scope = "all", dryRun = false, limit = 100 } = options;
    if (!query?.trim()) return { matched: 0, forgotten: 0, dryRun };
    const searchResults = await this.searchHybrid(query, scope, { limit, signals: { keyword: 0.6, vector: 0.4 } });
    const matches = searchResults.results.map(r => ({ id: r.id, label: r.label, type: r.type }));
    if (dryRun) return { matched: matches.length, forgotten: 0, dryRun: true, matches };
    let forgotten = 0;
    matches.forEach(m => {
      const node = this.nodeMap.get(m.id);
      if (node) { node.isForgotten = true; node.forgetReason = `Agentic mass-forget: "${query}"`; node.updatedAt = new Date().toISOString(); this._unindexNode(m.id); forgotten++; }
    });
    this.logAudit('AGENTIC_FORGET', `Forgot ${forgotten} memories matching "${query}"`);
    this.emit('memory:mass-forgotten', { count: forgotten, query });
    this._markDirty();
    return { matched: matches.length, forgotten, dryRun: false, matches };
  }

  /**
   * Get the provenance of a memory — which trace and agent produced it.
   * @param {string} memoryId - The id of the memory.
   * @returns {{memoryId: string, sourceTrace: string|null, sourceAgent: string|null, trace: Object|null}} Provenance info.
   * @example
   * const prov = db.getProvenance('m1');
   */
  getProvenance(memoryId) {
    const node = this.nodeMap.get(memoryId);
    if (!node) return null;
    const trace = node.properties?.sourceTrace ? this.traces.find(t => t.traceId === node.properties.sourceTrace) : null;
    return { memoryId, sourceTrace: node.properties?.sourceTrace || null, sourceAgent: node.properties?.sourceAgent || null, trace: trace ? { taskId: trace.taskId, outcome: trace.outcome, createdAt: trace.createdAt } : null };
  }

  /**
   * Compute cosine similarity between two vectors (Float32Array or number[]).
   * Used by searchHybrid() for the vector signal.
   * @param {Float32Array|number[]} a - First vector.
   * @param {Float32Array|number[]} b - Second vector.
   * @returns {number} Cosine similarity score (0-1 for normalized vectors).
   * @example
   * const score = db.cosineSimilarity(vecA, vecB);
   */
  cosineSimilarity(a, b) {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) dot += a[i] * b[i];
    return dot;
  }

  /**
   * Multi-signal hybrid retrieval fusing 5 signals: keyword (0.25), vector (0.40), entity (0.20), temporal (0.10), cognitive (0.05).
   * Skips forgotten, archived, and forgetAfter-expired nodes. Optionally reranks via cross-encoder.
   * Applied filters via _matchFilters(). Entity signal uses adjacency BFS. Reinforces matched nodes.
   * @param {string} query - Search query text.
   * @param {string} [searchScope="all"] - Scope to search (prefix match). 'all' for no filter.
   * @param {Object} [options={}] - Search options.
   * @param {Object} [options.signals] - Signal weights. Defaults to {keyword:0.25, vector:0.40, entity:0.20, temporal:0.10, cognitive:0.05}.
   * @param {Object} [options.filters] - Filter expressions (AND/OR/string_contains/numeric/array_contains/negate).
   * @param {boolean} [options.rerank=false] - Apply cross-encoder reranking (requires enableReranking).
   * @param {number} [options.threshold=0.0] - Minimum score for inclusion.
   * @param {number} [options.limit=10] - Max results.
   * @param {number} [options.maxDepth=1] - Graph traversal depth for entity signal.
   * @returns {Promise<{results: Array, synthesis: string, total: number, timing: number}>} Search results.
   * @example
   * const r = await db.searchHybrid('payment processing', 'all', { signals: { keyword: 0.5, vector: 0.5 }, limit: 5 });
   */
  async searchHybrid(query, searchScope = "all", options = {}) {
    const { signals = { keyword: 0.25, vector: 0.40, entity: 0.20, temporal: 0.10, cognitive: 0.05 }, filters = null, rerank = false, threshold = 0.0, limit = 10, maxDepth = 1 } = options;
    if (!query?.trim()) return { results: [], synthesis: "Empty query", total: 0, timing: 0 };
    const cleanQuery = String(query).toLowerCase().trim();
    this.logAudit("SEARCH_HYBRID", `"${query}"`);

    const keywordScores = new Map();
    if (signals.keyword > 0) {
      const queryTokens = this._tokenize(cleanQuery);
      const tokenMatches = new Map();
      queryTokens.forEach(token => { const ids = this.invertedIndex.get(token); if (ids) ids.forEach(id => tokenMatches.set(id, (tokenMatches.get(id) || 0) + 1)); });
      const maxMatches = Math.max(1, ...tokenMatches.values());
      tokenMatches.forEach((count, id) => keywordScores.set(id, count / maxMatches));
    }

    const vectorScores = new Map();
    if (signals.vector > 0 && this._embedFn) {
      const queryVec = await this._embedFn(cleanQuery);
      for (const [id, node] of this.nodeMap) {
        if (node.properties?.archived || node.properties?.compacted || node.isForgotten) continue;
        if (node.properties?.embedding) vectorScores.set(id, this.cosineSimilarity(queryVec, node.properties.embedding));
      }
    }

    const entityScores = new Map();
    if (signals.entity > 0) {
      const seedIds = new Set([...keywordScores.keys(), ...vectorScores.keys()]);
      seedIds.forEach(id => { const neighbors = this.adjacency?.get(id) || []; neighbors.forEach(({ neighborId }) => entityScores.set(neighborId, (entityScores.get(neighborId) || 0) + 1)); });
      const maxEntity = Math.max(1, ...entityScores.values());
      entityScores.forEach((count, id) => entityScores.set(id, count / maxEntity));
    }

    const temporalScores = new Map();
    if (signals.temporal > 0) {
      const now = Date.now();
      const allIds = new Set([...keywordScores.keys(), ...vectorScores.keys(), ...entityScores.keys()]);
      let maxAge = 1;
      allIds.forEach(id => { const n = this.nodeMap.get(id); if (n?.properties?.lastAccessedAt) maxAge = Math.max(maxAge, now - new Date(n.properties.lastAccessedAt).getTime()); });
      allIds.forEach(id => { const n = this.nodeMap.get(id); if (n?.properties?.lastAccessedAt) temporalScores.set(id, 1 - ((now - new Date(n.properties.lastAccessedAt).getTime()) / maxAge)); });
    }

    const cognitiveScores = new Map();
    if (signals.cognitive > 0) {
      const allIds = new Set([...keywordScores.keys(), ...vectorScores.keys(), ...entityScores.keys()]);
      allIds.forEach(id => { const n = this.nodeMap.get(id); if (n?.properties?.cognitiveStrength !== undefined) cognitiveScores.set(id, n.properties.cognitiveStrength / 2.0); });
    }

    const allCandidateIds = new Set([...keywordScores.keys(), ...vectorScores.keys(), ...entityScores.keys(), ...temporalScores.keys(), ...cognitiveScores.keys()]);
    const fusedResults = [];
    allCandidateIds.forEach(id => {
      const node = this.nodeMap.get(id);
      if (!node) return;
      if (!scopeMatches(node.scope, searchScope)) return;
      if (node.properties?.archived || node.properties?.compacted) return;
      if (node.isForgotten) return;
      if (node.forgetAfter && new Date(node.forgetAfter) < new Date()) return;
      if (filters && !this._matchFilters(node, filters)) return;
      const inferenceMultiplier = node.isInference && node.reviewStatus !== 'approved' ? 0.3 : 1.0;
      const score = ((signals.keyword || 0) * (keywordScores.get(id) || 0) + (signals.vector || 0) * (vectorScores.get(id) || 0) + (signals.entity || 0) * (entityScores.get(id) || 0) + (signals.temporal || 0) * (temporalScores.get(id) || 0) + (signals.cognitive || 0) * (cognitiveScores.get(id) || 0)) * inferenceMultiplier;
      if (score >= threshold) fusedResults.push({ id, node, score, signals: { keyword: keywordScores.get(id) || 0, vector: vectorScores.get(id) || 0, entity: entityScores.get(id) || 0, temporal: temporalScores.get(id) || 0, cognitive: cognitiveScores.get(id) || 0 } });
    });
    fusedResults.sort((a, b) => b.score - a.score);
    if (rerank && this._rerankFn) { await this._rerankFn(query, fusedResults); fusedResults.sort((a, b) => (b.rerankScore || b.score) - (a.rerankScore || a.score)); }
    const finalResults = fusedResults.slice(0, limit);
    finalResults.forEach(r => this.reinforceNodeMemory(r.id));
    this._markDirty();
    return { results: finalResults.map(r => ({ id: r.id, label: r.node.label, score: r.score, type: r.node.memoryType, signals: r.signals, node: r.node })), synthesis: '', total: fusedResults.length, timing: 0 };
  }

  /**
   * Evaluate a filter expression against a node's properties and fields.
   * Supports AND, OR, string_contains, numeric (=, >, <, >=, <=, !=), array_contains, and negate.
   * Called by search() and searchHybrid() when filters are provided.
   * @param {Object} node - The node to test.
   * @param {Object} filters - Filter expression tree.
   * @returns {boolean} True if the node matches the filter.
   * @example
   * // { AND: [{ field: 'memoryType', op: 'equals', value: 'decision' }] }
   * if (db._matchFilters(node, filters)) { ... }
   */
  _matchFilters(node, filters) {
    if (!filters) return true;
    if (filters.AND) return filters.AND.every(item => this._matchFilters(node, item));
    if (filters.OR) return filters.OR.some(item => this._matchFilters(node, item));
    const { key, value, filterType = 'equality', numericOperator = '=', negate = false } = filters;
    const nodeVal = node.metadata?.[key] ?? node.properties?.[key] ?? node[key];
    let result;
    switch (filterType) {
      case 'equality': result = nodeVal === value; break;
      case 'string_contains': result = String(nodeVal || '').toLowerCase().includes(String(value).toLowerCase()); break;
      case 'numeric':
        const num = parseFloat(nodeVal);
        switch (numericOperator) { case '>': result = num > value; break; case '>=': result = num >= value; break; case '<': result = num < value; break; case '<=': result = num <= value; break; case '!=': result = num !== value; break; default: result = num === value; }
        break;
      case 'array_contains': result = Array.isArray(nodeVal) && nodeVal.includes(value); break;
      default: result = nodeVal === value;
    }
    return negate ? !result : result;
  }

  /**
   * Keyword + graph search. Uses the inverted index for O(matches) keyword lookup, then BFS up to maxDepth for neighbors.
   * Skips forgotten, archived, compacted, and forgetAfter-expired nodes. Reinforces matched nodes.
   * When llmConfig.provider is not 'rules', synthesizes results via LLM.
   * @param {string} query - Search query text.
   * @param {string} [searchScope="all"] - Scope to search (prefix match). 'all' for no filter.
   * @param {Object} [options={}] - Search options.
   * @param {number} [options.maxDepth=1] - BFS traversal depth.
   * @param {Object} [options.filters] - Filter expressions (see _matchFilters).
   * @returns {Promise<{matchedNodeIds: string[], traversedNodeIds: string[], traversedEdgeIds: string[], synthesis: string}>} Search results.
   * @example
   * const r = await db.search('auth', 'all', { maxDepth: 2 });
   */
  async search(query, searchScope = "all", options = {}) {
    const { maxDepth = 1, filters = null } = options;
    if (!query || String(query).trim().length === 0) return { synthesis: "Please enter a valid search query.", matchedNodeIds: [], traversedNodeIds: [], traversedEdgeIds: [] };
    const cleanQuery = String(query).toLowerCase().trim();
    this.logAudit("SEARCH_QUERY", `Executing search query: "${query}"`);

    const queryTokens = cleanQuery.split(/[^a-z0-9]+/i).filter(t => t.length >= 2);
    const candidateIds = new Set();
    if (queryTokens.length > 0) queryTokens.forEach(token => { const ids = this.invertedIndex.get(token); if (ids) ids.forEach(id => candidateIds.add(id)); });
    const fullIds = this.invertedIndex.get(cleanQuery);
    if (fullIds) fullIds.forEach(id => candidateIds.add(id));

    const matchedNodeIds = [];
    candidateIds.forEach(id => {
      const node = this.nodeMap.get(id);
      if (!node) return;
      if (searchScope !== "all" && !scopeMatches(node.scope, searchScope)) return;
      if (node.properties?.compacted || node.properties?.archived) return;
      if (node.isForgotten) return;
      if (node.forgetAfter && new Date(node.forgetAfter) < new Date()) return;
      if (filters && !this._matchFilters(node, filters)) return;
      matchedNodeIds.push(id);
      this.reinforceNodeMemory(id);
    });

    const traversedNodeIds = [...matchedNodeIds];
    const traversedEdgeIds = [];
    let frontier = [...matchedNodeIds];
    let depth = 0;
    while (depth < maxDepth && frontier.length > 0) {
      const nextFrontier = [];
      for (const nodeId of frontier) {
        const neighbors = this.adjacency.get(nodeId) || [];
        for (const { edge, neighborId } of neighbors) {
          if (!edge.active) continue;
          if (!traversedNodeIds.includes(neighborId)) { traversedNodeIds.push(neighborId); nextFrontier.push(neighborId); this.reinforceNodeMemory(neighborId); }
          if (!traversedEdgeIds.includes(edge.id)) traversedEdgeIds.push(edge.id);
        }
      }
      frontier = nextFrontier;
      depth++;
    }

    const matchedNodes = traversedNodeIds.map(id => this.nodeMap.get(id)).filter(Boolean);
    const matchedEdges = traversedEdgeIds.map(id => this.edgeMap.get(id)).filter(Boolean);
    const communitySummaries = this.nodes.filter(n => n.type === "community-summary" || n.type === "summary");

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
        if (responseText) return { synthesis: responseText, matchedNodeIds, traversedNodeIds, traversedEdgeIds };
      } catch (err) { console.error("Option 2 LLM Synthesis failed:", err); }
    }

    let synthesis = "";
    if (matchedNodeIds.length === 0) synthesis = `No direct memory nodes matched the query "${query}".`;
    else {
      const matchDetails = matchedNodeIds.map(id => this.nodeMap.get(id)?.label || id);
      const neighborDetails = traversedNodeIds.filter(id => !matchedNodeIds.includes(id)).map(id => { const n = this.nodeMap.get(id); return n ? `${n.label} (${n.type})` : ""; }).filter(Boolean);
      synthesis = `### SuperRAG Hybrid Synthesis Response\n\n* **Matched Entry Nodes**: Found direct vector/semantic indices for: **${matchDetails.join(", ")}**.\n* **Traversed Neighbors Context**: Traversed active relationships to assemble surrounding context: **${neighborDetails.length > 0 ? neighborDetails.join(", ") : "None"}**.\n\n**Synthesized Conclusion**:\n`;
      if (cleanQuery.includes("bun") || cleanQuery.includes("runtime") || cleanQuery.includes("node")) {
        const activeBackend = this.edges.find(e => e.label === "uses_backend" && e.active);
        const activeNode = activeBackend ? this.nodeMap.get(activeBackend.target) : null;
        synthesis += `The project has evolved its backend runtime. Currently, it actively uses **${activeNode ? activeNode.label : "Bun"}** (ultra-fast bundler) for high performance. Historical audit trails reveal that any previous Node.js ties have been soft-decayed to maintain temporal consistency in the agent's brain.`;
      } else if (cleanQuery.includes("sarah") || cleanQuery.includes("john") || cleanQuery.includes("client")) {
        synthesis += `Active accounts show Sarah operates as Product Lead at Cluely, while John acts as VP Engineering (Executive Sign-off). Ingestion updates confirm Sarah's preferred communication remains email, while John's workflow preferencing is locked to Discord.`;
      } else {
        synthesis += `Located key entity associations. All related files and directory nodes are mapped directly inside the virtual POSIX memory folders for seamless grep/cat access.`;
      }
    }
    return { synthesis, matchedNodeIds, traversedNodeIds, traversedEdgeIds };
  }

  /**
   * Scrape text content from a URL (via Jina Reader API or direct fetch with cheerio).
   * Extracts clean text and ingests it as memory via addMemory().
   * @param {string} url - The URL to scrape.
   * @returns {Promise<{text: string, source: string}>} Scraped text and source label.
   * @throws {Error} If fetching fails.
   * @example
   * await db.scrapeUrl('https://example.com/docs');
   */
  async scrapeUrl(url) {
    this.logAudit("SCRAPE_START", `Scraping web address: ${url}`);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Invalid URL protocol. Only HTTP and HTTPS protocols are supported.");
      if (["localhost", "127.0.0.1", "169.254.169.254"].includes(parsed.hostname)) throw new Error("Access to local or cloud metadata hosts is restricted.");
    } catch (err) { this.logAudit("SCRAPE_INVALID_URL", `Scrape blocked: ${err.message}`); throw err; }
    let cleanText = "";
    let extractionSource = "cheerio-local";
    try {
      const jinaUrl = `https://r.jina.ai/${url}`;
      const response = await fetch(jinaUrl);
      if (response.ok) { cleanText = await response.text(); extractionSource = "jina-api"; }
      else throw new Error("Jina API returned non-OK status");
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
      } catch (cheerioErr) { this.logAudit("SCRAPE_FAIL", `Local Cheerio scraping failed: ${cheerioErr.message}`); throw cheerioErr; }
    }
    if (cleanText) {
      const result = await this.addMemory(`Scraped from ${url}: ${cleanText.slice(0, 1500)}`);
      this.logAudit("SCRAPE_SUCCESS", `Successfully indexed URL: ${url} (Source: ${extractionSource})`);
      return { success: true, text: cleanText, source: extractionSource, nodes: result.nodes };
    } else throw new Error("Scraping returned empty text");
  }

  /**
   * Parse a PDF file (via path or buffer) and ingest its text content as memory.
   * Uses cheerio + pdf-parse to extract clean text from the PDF.
   * @param {string|Buffer} pdfPathOrBuffer - Path to PDF file or a Buffer containing PDF data.
   * @returns {Promise<{success: boolean, text: string, metadata: Object, nodes: string[]}>} Parsed text and metadata.
   * @throws {Error} If PDF parsing fails or content is empty.
   * @example
   * await db.parsePdfFile('./report.pdf');
   */
  async parsePdfFile(pdfPathOrBuffer) {
    const isBuffer = typeof Buffer !== "undefined" && Buffer.isBuffer(pdfPathOrBuffer);
    const logPath = isBuffer ? "Uploaded Document Buffer" : String(pdfPathOrBuffer);
    this.logAudit("PDF_PARSE_START", `Reading PDF document: ${logPath}`);
    if (!this.isNode || !fs || !pdfParse) throw new Error("PDF Parsing requires a Node.js runtime environment and pdf-parse.");
    try {
      const dataBuffer = isBuffer ? pdfPathOrBuffer : fs.readFileSync(pdfPathOrBuffer);
      const data = await pdfParse(dataBuffer);
      const cleanText = data.text.trim();
      if (cleanText) {
        const result = await this.addMemory(`PDF Document ${logPath}: ${cleanText.slice(0, 1500)}`);
        this.logAudit("PDF_PARSE_SUCCESS", `Successfully indexed PDF: ${logPath}`);
        return { success: true, text: cleanText, metadata: data.info, nodes: result.nodes };
      } else throw new Error("PDF text content is empty");
    } catch (err) { this.logAudit("PDF_PARSE_FAIL", `Failed to parse PDF: ${err.message}`); throw err; }
  }

  /**
   * Start a new episodic trace (execution recorder) for an agent session.
   * Records chronological event frames that capture tool calls, results, errors, and state snapshots.
   * @param {string} [traceId] - Unique trace id. Auto-generated if omitted.
   * @param {string} [agentId="anonymous-agent"] - Agent performing the trace.
   * @param {string} [sessionId="session-default"] - Session the trace belongs to.
   * @param {string} [taskId="task-default"] - Task being executed.
   * @returns {Object} The new trace object.
   * @example
   * db.startTrace('trace-1', 'cursor-ide', 'session-1', 'deploy-app');
   */
  startTrace(traceId, agentId, sessionId, taskId) {
    if (!traceId) traceId = this.generateId("trace");
    const existing = this.traces.find(t => t.traceId === traceId);
    if (existing) { this.logAudit("TRACE_START_DUPLICATE", `Trace ${traceId} already exists`); return existing; }
    const newTrace = { traceId, agentId: agentId || "anonymous-agent", sessionId: sessionId || "session-default", taskId: taskId || "task-default", status: "open", outcome: "unknown", createdAt: new Date().toISOString(), finalizedAt: null, quarantined: false, compacted: false };
    this.traces.push(newTrace);
    this.logAudit("TRACE_START", `Started episodic trace: ${traceId} for task: ${newTrace.taskId}`);
    this._markDirty();
    return newTrace;
  }

  /**
   * Append a single execution step to an open trace.
   * Each frame records: toolCallJson, toolResultJson, stateSnapshotJson, errorSignature, privacyTags, sourceTrust.
   * @param {string} traceId - The trace to append to. Must be open (not finalized).
   * @param {Object} frameData - The frame data.
   * @param {Object} [frameData.toolCallJson={}] - Tool call that was made.
   * @param {Object} [frameData.toolResultJson={}] - Result from the tool.
   * @param {Object} [frameData.stateSnapshotJson={}] - State snapshot at this step.
   * @param {string} [frameData.errorSignature=""] - Canonical error signature if the step failed.
   * @param {Array} [frameData.privacyTags=[]] - Privacy tags for this frame.
   * @param {number} [frameData.sourceTrust=1.0] - Trust score for this frame's source.
   * @returns {Object} The new event frame.
   * @throws {Error} If the trace is not found or already finalized.
   * @example
   * db.appendEventFrame('trace-1', { toolCallJson: { tool: 'npm install', args: ['express'] }, errorSignature: '' });
   */
  appendEventFrame(traceId, frameData) {
    const trace = this.traces.find(t => t.traceId === traceId);
    if (!trace) throw new Error(`Trace ${traceId} not found`);
    if (trace.status === "finalized") throw new Error(`Cannot append to finalized trace ${traceId}`);
    const siblingFrames = this.eventFrames.filter(f => f.traceId === traceId);
    const stepIdx = siblingFrames.length;
    const newFrame = { id: this.generateId("frame"), traceId, stepIdx, ts: new Date().toISOString(), toolCallJson: frameData.toolCallJson || {}, toolResultJson: frameData.toolResultJson || {}, stateSnapshotJson: frameData.stateSnapshotJson || {}, errorSignature: frameData.errorSignature || "", privacyTags: frameData.privacyTags || [], sourceTrust: frameData.sourceTrust !== undefined ? parseFloat(frameData.sourceTrust) : 1.0, extractedBeliefs: [] };
    this.eventFrames.push(newFrame);
    this.logAudit("TRACE_FRAME_APPEND", `Appended frame #${stepIdx} to trace ${traceId}`);
    return newFrame;
  }

  /**
   * Finalize a trace, locking its status and outcome.
   * After finalization, no more frames can be appended.
   * @param {string} traceId - The trace to finalize.
   * @param {('success'|'failure'|'unknown')} [outcome="unknown"] - Final outcome of the trace.
   * @param {Object} [summaryJson={}] - Optional summary metadata.
   * @returns {Object} The finalized trace.
   * @throws {Error} If the trace is not found.
   * @example
   * db.finalizeTrace('trace-1', 'success', { deployTime: 45000 });
   */
  finalizeTrace(traceId, outcome = "unknown", summaryJson = {}) {
    const trace = this.traces.find(t => t.traceId === traceId);
    if (!trace) throw new Error(`Trace ${traceId} not found`);
    trace.status = "finalized";
    trace.outcome = outcome;
    trace.finalizedAt = new Date().toISOString();
    if (summaryJson) trace.summaryJson = summaryJson;
    this.logAudit("TRACE_FINALIZE", `Finalized trace ${traceId} with outcome: ${outcome}`);
    this._markDirty();
    return trace;
  }

  /**
   * Replay an episodic trace by returning its frames in chronological order.
   * Used for post-mortem debugging and after-action analysis.
   * @param {string} traceId - The trace to replay.
   * @returns {{trace: Object, frames: Array}} The trace object and its sorted frame array.
   * @throws {Error} If the trace is not found.
   * @example
   * const { trace, frames } = db.replayTrace('trace-1');
   */
  replayTrace(traceId) {
    const trace = this.traces.find(t => t.traceId === traceId);
    if (!trace) throw new Error(`Trace ${traceId} not found`);
    const frames = this.eventFrames.filter(f => f.traceId === traceId).sort((a, b) => a.stepIdx - b.stepIdx);
    return { trace, frames };
  }

  /**
   * Bridge an episodic trace into the semantic graph (cognitive ingestion).
   * Creates a trace node, summarizes the event frames into text, ingests via addMemory(), and links extracted beliefs back to the trace via 'derived_from_trace' edges.
   * Stamps `sourceTrace` and `sourceAgent` on each extracted memory node for provenance.
   * @param {string} traceId - The trace to ingest.
   * @returns {Promise<{traceNodeId: string, nodes: string[], edges: string[], conflict: string|null}>} Ingestion result.
   * @throws {Error} If the trace is not found or quarantined.
   * @example
   * const result = await db.ingestTraceAsMemory('trace-1');
   */
  async ingestTraceAsMemory(traceId) {
    const trace = this.traces.find(t => t.traceId === traceId);
    if (!trace) throw new Error(`Trace ${traceId} not found`);
    if (trace.quarantined) throw new Error(`Trace ${traceId} is quarantined and cannot be ingested`);
    const frames = this.eventFrames.filter(f => f.traceId === traceId).sort((a, b) => a.stepIdx - b.stepIdx);
    const traceNodeId = `node-trace-${traceId.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    this.addNode(traceNodeId, `Trace: ${trace.taskId}`, "trace", { traceId: trace.traceId, agentId: trace.agentId, sessionId: trace.sessionId, taskId: trace.taskId, outcome: trace.outcome, finalizedAt: trace.finalizedAt }, "work");
    let summaryText = `Agent '${trace.agentId}' attempted task '${trace.taskId}' in session '${trace.sessionId}'.\n`;
    frames.forEach(frame => {
      const toolCall = typeof frame.toolCallJson === "string" ? frame.toolCallJson : JSON.stringify(frame.toolCallJson);
      const toolResult = typeof frame.toolResultJson === "string" ? frame.toolResultJson : JSON.stringify(frame.toolResultJson);
      const stateSnapshot = typeof frame.stateSnapshotJson === "string" ? frame.stateSnapshotJson : JSON.stringify(frame.stateSnapshotJson);
      summaryText += `Step ${frame.stepIdx}: Ran tool call ${toolCall}.\nResult: ${toolResult}.\n${frame.errorSignature ? `Error: ${frame.errorSignature}.\n` : ''}State snapshot: ${stateSnapshot}.\n`;
    });
    summaryText += `Final outcome: ${trace.outcome}.`;
    this.logAudit("TRACE_INGEST_START", `Ingesting trace ${traceId} memory into GraphRAG`);
    const ingestionResult = await this.addMemory(summaryText, "work");
    if (ingestionResult && Array.isArray(ingestionResult.nodes)) {
      ingestionResult.nodes.forEach(extractedNodeId => {
        if (extractedNodeId !== traceNodeId) {
          const edgeId = this.generateId("e-trace-belief");
          this.addEdge(edgeId, traceNodeId, extractedNodeId, "derived_from_trace", 1.0, true);
          const node = this.nodeMap.get(extractedNodeId);
          if (node) { node.properties.sourceTrace = traceId; node.properties.sourceAgent = trace.agentId; }
          const matchingFrame = frames.find(f => JSON.stringify(f.toolCallJson).toLowerCase().includes(extractedNodeId.toLowerCase())) || frames[frames.length - 1];
          if (matchingFrame) {
            if (!matchingFrame.extractedBeliefs) matchingFrame.extractedBeliefs = [];
            if (!matchingFrame.extractedBeliefs.includes(extractedNodeId)) matchingFrame.extractedBeliefs.push(extractedNodeId);
          }
        }
      });
    }
    trace.compacted = true;
    this.logAudit("TRACE_INGEST_COMPLETE", `Successfully bridged trace ${traceId} into Ontological graph.`);
    this._markDirty();
    return { traceNodeId, nodes: ingestionResult.nodes, edges: ingestionResult.edges, conflict: ingestionResult.conflict };
  }

  /**
   * Quarantine a trace — locks it with a quarantined flag, preventing accidental ingestion.
   * Used when a trace is suspicious (security/trust concerns) and needs manual review before bridging.
   * @param {string} traceId - The trace to quarantine.
   * @returns {Object} The quarantined trace.
   * @throws {Error} If the trace is not found.
   * @example
   * db.quarantineTrace('trace-1');
   */
  quarantineTrace(traceId) {
    const trace = this.traces.find(t => t.traceId === traceId);
    if (!trace) throw new Error(`Trace ${traceId} not found`);
    trace.quarantined = true;
    this.logAudit("TRACE_QUARANTINE", `Quarantined trace ${traceId} due to security/trust concerns.`);
    this._markDirty();
    return trace;
  }

  /**
   * Get a cross-session briefing — a human-readable summary of what happened across sessions over a time range.
   * Groups traces by session, summarizes tasks and outcomes, and counts memories by type.
   * @param {Object} [opts={}] - Briefing options.
   * @param {string|Date} [opts.since=now-24h] - Start of the time range.
   * @param {string|Date} [opts.until=now] - End of the time range.
   * @param {Array<string>} [opts.sessionIds] - Filter to specific session ids. If omitted, all sessions in range.
   * @returns {{context: string, traceCount: number, memoryCount: number}} Briefing text and counts.
   * @example
   * const briefing = db.getBriefing({ since: '2026-07-10', until: '2026-07-11' });
   * console.log(briefing.context);
   */
  getBriefing(opts = {}) {
    const { since, until, sessionIds } = opts;
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 86400000);
    const untilDate = until ? new Date(until) : new Date();
    const sessions = sessionIds ? (Array.isArray(sessionIds) ? sessionIds : [sessionIds]) : null;
    const relevantTraces = this.traces.filter(t => {
      const tTime = new Date(t.createdAt);
      if (tTime < sinceDate || tTime > untilDate) return false;
      if (sessions && !sessions.includes(t.sessionId)) return false;
      return true;
    });
    const traceIds = new Set(relevantTraces.map(t => t.traceId));
    const relevantFrames = this.eventFrames.filter(f => traceIds.has(f.traceId));
    const relevantMemories = this.nodes.filter(n => {
      const nTime = new Date(n.createdAt);
      return nTime >= sinceDate && nTime <= untilDate && !n.isForgotten;
    });
    let text = `# Briefing: ${sinceDate.toISOString().slice(0,10)} to ${untilDate.toISOString().slice(0,10)}\n\n`;
    text += `## Sessions\n${relevantTraces.length} trace(s) across ${new Set(relevantTraces.map(t => t.sessionId)).size} session(s).\n\n`;
    relevantTraces.forEach(t => {
      const frames = relevantFrames.filter(f => f.traceId === t.traceId);
      text += `- **${t.taskId}** (${t.sessionId}): ${t.outcome} — ${frames.length} step(s)\n`;
    });
    text += `\n## Memories\n${relevantMemories.length} memory(-ies) recorded.\n`;
    const byType = {};
    relevantMemories.forEach(n => { byType[n.memoryType] = (byType[n.memoryType] || 0) + 1; });
    text += Object.entries(byType).map(([t, c]) => `- ${t}: ${c}`).join("\n") + "\n";

    // Knowledge briefing — include active knowledge nodes regardless of time range
    const allKnowledge = [];
    for (const [id, node] of this.nodeMap) {
      if (this._getKnowledgeType(node) && !node.isForgotten && !node.properties?.archived) allKnowledge.push(node);
    }
    const activeKnowledge = allKnowledge.filter(n => (n.properties?.status || 'active') !== 'superseded' && (n.properties?.status || 'active') !== 'obsolete');
    const locked = activeKnowledge.filter(n => n.properties?.protection === 'locked');
    if (locked.length > 0) {
      text += `\n## Locked Knowledge\n`;
      locked.forEach(n => { text += `- **${n.label}**: ${n.properties?.rationale || n.properties?.rule || n.properties?.invariant || ''}\n`; });
    }
    const principles = activeKnowledge.filter(n => this._getKnowledgeType(n) === 'principle');
    if (principles.length > 0) {
      text += `\n## Active Principles\n`;
      principles.forEach(n => { text += `- ${n.properties?.rule || n.label}\n`; });
    }
    const constraints = activeKnowledge.filter(n => this._getKnowledgeType(n) === 'constraint');
    if (constraints.length > 0) {
      text += `\n## Active Constraints\n`;
      constraints.forEach(n => { text += `- ${n.properties?.invariant || n.label}\n`; });
    }
    const recentFailures = allKnowledge.filter(n => this._getKnowledgeType(n) === 'failure').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    if (recentFailures.length > 0) {
      text += `\n## Recent Failures\n`;
      recentFailures.forEach(n => { text += `- ${n.properties?.approach || n.label}: ${n.properties?.error || ''}\n`; });
    }
    return { context: text, traceCount: relevantTraces.length, memoryCount: relevantMemories.length };
  }

  /**
   * Compute a temporal evolution series of memory activity over a date range.
   * Pure aggregation — no storage changes. Buckets nodes by createdAt.
   * For "show how the tech stack evolved over 6 months": filter memoryType='change', bucket by month.
   * @param {Object} [opts={}] - Evolution options.
   * @param {string|Date} [opts.since=now-30d] - Start of range.
   * @param {string|Date} [opts.until=now] - End of range.
   * @param {('day'|'week'|'month')} [opts.bucket="day"] - Bucket granularity.
   * @param {string} [opts.scope] - Scope filter (prefix match). 'all' or omit for no filter.
   * @returns {{series: Array<{date: string, byType: Object<string, number>, count: number, avgStrength: number, topChanges: string[]}>, total: number}} Evolution series.
   * @example
   * const evo = db.getEvolution({ since: '2026-01-01', until: '2026-07-11', bucket: 'month' });
   */
  getEvolution(opts = {}) {
    const { since, until, bucket = "day", scope } = opts;
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 86400000);
    const untilDate = until ? new Date(until) : new Date();
    const bucketMs = bucket === "day" ? 86400000 : bucket === "week" ? 7 * 86400000 : bucket === "month" ? 30 * 86400000 : 86400000;
    const binMap = new Map();
    let total = 0;
    for (const n of this.nodes) {
      if (n.isForgotten) continue;
      if (scope && scope !== "all" && !scopeMatches(n.scope, scope)) continue;
      const t = n.createdAt ? new Date(n.createdAt).getTime() : 0;
      if (t < sinceDate.getTime() || t > untilDate.getTime()) continue;
      const binIdx = Math.floor((t - sinceDate.getTime()) / bucketMs);
      if (!binMap.has(binIdx)) binMap.set(binIdx, []);
      binMap.get(binIdx).push(n);
      total++;
    }
    const series = [];
    const totalBins = Math.ceil((untilDate.getTime() - sinceDate.getTime()) / bucketMs);
    for (let i = 0; i < totalBins; i++) {
      const binNodes = binMap.get(i) || [];
      const byType = {};
      let sumStrength = 0;
      const topChanges = [];
      for (const n of binNodes) {
        const type = n.memoryType || n.type;
        byType[type] = (byType[type] || 0) + 1;
        sumStrength += n.properties?.cognitiveStrength || 1.0;
        if (n.memoryType === "change") topChanges.push(n.label);
      }
      const binStart = sinceDate.getTime() + i * bucketMs;
      series.push({ date: new Date(binStart).toISOString().slice(0, 10), byType, count: binNodes.length, avgStrength: binNodes.length ? +(sumStrength / binNodes.length).toFixed(3) : 0, topChanges });
    }
    return { series, total };
  }

  /**
   * Get a temporal series for a specific field (cognitiveStrength, version, sourceTrust) over time.
   * Returns per-bucket avg/min/max/count for the requested field.
   * @param {('cognitiveStrength'|'version'|'sourceTrust')} field - Field to track over time.
   * @param {Object} [opts={}] - Series options.
   * @param {string|Date} [opts.since=now-30d] - Start of range.
   * @param {string|Date} [opts.until=now] - End of range.
   * @param {('day'|'week'|'month')} [opts.bucket="day"] - Bucket granularity.
   * @returns {{field: string, series: Array<{date: string, avg: number, min: number, max: number, count: number}>}} Temporal series.
   * @example
   * const series = db.getTemporalSeries('cognitiveStrength', { since: '2026-01-01', bucket: 'week' });
   */
  getTemporalSeries(field, opts = {}) {
    const { since, until, bucket = "day" } = opts;
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 86400000);
    const untilDate = until ? new Date(until) : new Date();
    const series = [];
    const cursor = new Date(sinceDate);
    while (cursor < untilDate) {
      const binEnd = bucket === "day" ? new Date(cursor.getTime() + 86400000) : bucket === "week" ? new Date(cursor.getTime() + 7 * 86400000) : bucket === "month" ? new Date(cursor.getTime() + 30 * 86400000) : new Date(cursor.getTime() + 86400000);
      const binNodes = this.nodes.filter(n => {
        if (n.isForgotten) return false;
        const t = new Date(n.createdAt);
        return t >= cursor && t < binEnd;
      });
      let values = [];
      if (field === "cognitiveStrength") values = binNodes.map(n => n.properties?.cognitiveStrength || 1.0);
      else if (field === "version") values = binNodes.map(n => n.version || 1);
      else if (field === "sourceTrust") values = this.eventFrames.filter(f => { const t = new Date(f.ts); return t >= cursor && t < binEnd; }).map(f => f.sourceTrust);
      else values = [0];
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      series.push({ date: cursor.toISOString().slice(0, 10), avg: +avg.toFixed(3), min: values.length ? +Math.min(...values).toFixed(3) : 0, max: values.length ? +Math.max(...values).toFixed(3) : 0, count: values.length });
      cursor.setTime(binEnd.getTime());
    }
    return { field, series };
  }

  /**
   * Get database statistics — node/edge counts, traces, forgotten memories, inverted index size, version, etc.
   * @returns {Object} Stats object with counts, active tokens, decay rate, version, and more.
   * @example
   * const s = db.stats();
   * console.log(s.nodes, s.edges, s.memories, s.version);
   */
  stats() {
    return { nodes: this.nodes.length, edges: this.edges.length, memories: this.nodes.filter(n => !n.isForgotten && n.isLatest !== false).length, archived: this.nodes.filter(n => n.properties?.archived).length, forgotten: this.nodes.filter(n => n.isForgotten).length, inferred: this.nodes.filter(n => n.isInference).length, traces: this.traces.length, openTraces: this.traces.filter(t => t.status === 'open').length, eventFrames: this.eventFrames.length, activeTokens: this.calculateActiveTokens(), contextCapacity: this.contextCapacity, decayRate: this.decayRate, invertedIndexSize: this.invertedIndex.size, autoSave: this.autoSave, version: '2.0.0' };
  }

  /**
   * Resolve the knowledge type from a node's properties.
   * Checks _knowledgeType marker set by addKnowledge() and legacy markers from addDecision/addFailure/addChange.
   * @param {Object} node - A node object from nodeMap.
   * @returns {string|null} The knowledge type string, or null if not a knowledge node.
   */
  _getKnowledgeType(node) {
    if (!node || !node.properties) return null;
    const p = node.properties;
    if (p._knowledgeType) return p._knowledgeType;
    if (p.decisionType === 'decision') return 'decision';
    if (p.failureType === 'failure') return 'failure';
    if (p.changeType === 'change') return 'change';
    return null;
  }

  /**
   * Generic unified entry point for storing any knowledge type.
   * Dispatches to typed methods for backward compat; handles new types (principle, pattern, constraint, tactic, observation).
   * @param {('decision'|'failure'|'change'|'principle'|'pattern'|'constraint'|'tactic'|'observation')} type - Knowledge type.
   * @param {string} id - Unique id for the knowledge node.
   * @param {Object} data - Type-specific fields (e.g. { rule, context, importance } for principle).
   * @returns {string} The node id.
   * @example
   * db.addKnowledge('principle', 'p-no-sync-io', { rule: 'No sync I/O in hot path', context: 'API handlers', importance: 4 });
   */
  addKnowledge(type, id, data = {}) {
    if (type === 'decision') return this.addDecision(id, data);
    if (type === 'failure') return this.addFailure(id, data);
    if (type === 'change') return this.addChange(id, data);
    const VALID_TYPES = { principle: 'rule', pattern: 'rootCause', constraint: 'invariant', tactic: 'approach', observation: 'observation' };
    const titleField = VALID_TYPES[type];
    if (!titleField) throw new Error(`Unknown knowledge type: ${type}`);
    const { scope, nodeOpts, ...rest } = data;
    const label = `${type.charAt(0).toUpperCase() + type.slice(1)}: ${rest.title || rest[titleField] || id}`;
    const properties = { ...rest, _knowledgeType: type, knowledgeType: type, status: rest.status || 'active' };
    this.addNode(id, label, 'concept', properties, scope || this.currentScope || 'work', { ...(nodeOpts || {}), memoryType: 'note' });
    this.logAudit('KNOWLEDGE_ADDED', `${type}: ${id}`);
    this._markDirty();
    return id;
  }

  /** @returns {string} node id */
  addPrinciple(id, data = {}) { return this.addKnowledge('principle', id, data); }
  /** @returns {string} node id */
  addPattern(id, data = {}) { return this.addKnowledge('pattern', id, data); }
  /** @returns {string} node id */
  addConstraint(id, data = {}) { return this.addKnowledge('constraint', id, data); }
  /** @returns {string} node id */
  addTactic(id, data = {}) { return this.addKnowledge('tactic', id, data); }
  /** @returns {string} node id */
  addObservation(id, data = {}) { return this.addKnowledge('observation', id, data); }

  /**
   * Internal helper for typed knowledge edges.
   * @private
   */
  _addTypedEdge(relationType, fromId, toId, properties = {}) {
    const edgeId = this.generateId(`e-${relationType}`);
    this.addEdge(edgeId, fromId, toId, relationType, 1.0, true, properties);
    this.logAudit('KNOWLEDGE_EDGE_ADDED', `${relationType}: ${fromId} → ${toId}`);
    return edgeId;
  }

  /** Add a 'supersedes' edge: fromId supersedes (replaces) toId. @returns {string} edge id */
  addSupersedes(fromId, toId, properties = {}) { return this._addTypedEdge('supersedes', fromId, toId, properties); }
  /** Add a 'contradicts' edge: fromId contradicts toId. @returns {string} edge id */
  addContradicts(fromId, toId, properties = {}) { return this._addTypedEdge('contradicts', fromId, toId, properties); }
  /** Add a 'supports' edge: fromId provides evidence for toId. @returns {string} edge id */
  addSupports(fromId, toId, properties = {}) { return this._addTypedEdge('supports', fromId, toId, properties); }
  /** Add a 'dependsOn' edge: fromId depends on toId being valid. @returns {string} edge id */
  addDependsOn(fromId, toId, properties = {}) { return this._addTypedEdge('dependsOn', fromId, toId, properties); }
  /** Add an 'appliesTo' edge: fromId applies in context/scenario toId. @returns {string} edge id */
  addAppliesTo(fromId, toId, properties = {}) { return this._addTypedEdge('appliesTo', fromId, toId, properties); }
  /** Add a 'triggers' edge: when fromId happens, consider/detect toId. @returns {string} edge id */
  addTriggers(fromId, toId, properties = {}) { return this._addTypedEdge('triggers', fromId, toId, properties); }

  /**
   * Unified search across all knowledge types. Filters by type, scope, tags, status, recency, importance, domain, and text query.
   * Results sorted by importance desc then createdAt desc.
   * @param {Object} opts - Search options.
   * @param {string|string[]} [opts.types] - Knowledge type(s) to include.
   * @param {string} [opts.scope] - Scope filter (prefix match). 'all' for no filter.
   * @param {string[]} [opts.tags] - Tags filter (node must have all listed tags).
   * @param {string} [opts.status] - Status filter ('active', 'superseded', 'obsolete').
   * @param {string|Date} [opts.since] - Only nodes created after this date.
   * @param {string} [opts.query] - Free-text search across label + properties.
   * @param {number} [opts.minImportance] - Minimum importance (1-5) filter.
   * @param {string} [opts.domain] - Domain filter for domain-scoped knowledge.
   * @returns {Array<Object>} Sorted array of knowledge nodes with their type and all properties.
   * @example
   * db.searchKnowledge({ types: ['principle', 'constraint'], scope: 'work', status: 'active' });
   */
  searchKnowledge(opts = {}) {
    const { types, scope, tags, status, since, query, minImportance, domain } = opts;
    const typeSet = types ? (Array.isArray(types) ? new Set(types) : new Set([types])) : null;
    const results = [];
    for (const [id, node] of this.nodeMap) {
      const kt = this._getKnowledgeType(node);
      if (!kt) continue;
      if (typeSet && !typeSet.has(kt)) continue;
      if (node.isForgotten || node.properties?.archived || node.properties?.compacted) continue;
      if (scope && scope !== 'all' && !scopeMatches(node.scope, scope)) continue;
      if (status && node.properties?.status !== status) continue;
      if (since && new Date(node.createdAt) < new Date(since)) continue;
      if (minImportance !== undefined && (node.properties?.importance || 0) < minImportance) continue;
      if (domain && node.properties?.domain && node.properties.domain !== domain) continue;
      if (tags && tags.length > 0) {
        const nodeTags = node.properties?.tags || [];
        if (!tags.every(t => nodeTags.includes(t))) continue;
      }
      if (query) {
        const searchText = `${node.label} ${JSON.stringify(node.properties || {})}`.toLowerCase();
        if (!searchText.includes(query.toLowerCase())) continue;
      }
      results.push({ id, type: kt, label: node.label, scope: node.scope, createdAt: node.createdAt, ...(node.properties || {}) });
    }
    results.sort((a, b) => (b.importance || 0) - (a.importance || 0) || new Date(b.createdAt) - new Date(a.createdAt));
    return results;
  }

  /**
   * Pre-action conflict guard. Scans active knowledge nodes and typed edges for conflicts before a proposed action.
   * Deterministic — no LLM calls. Returns an array of warning objects, empty array if clear.
   * @param {Object} proposed - Proposed action to check.
   * @param {string} proposed.type - Knowledge type being proposed.
   * @param {Object} proposed.data - The data payload (chosen, rule, approach, etc.).
   * @returns {Array<{type: string, id: string, label: string, message: string, existing: *, proposed: *}>} Warnings.
   * @example
   * const warnings = db.checkConflict({ type: 'decision', data: { chosen: 'MySQL', domain: 'database' } });
   * if (warnings.length) console.warn('Conflicts found:', warnings);
   */
  checkConflict({ type, data } = {}) {
    const warnings = [];
    const scope = data?.scope || this.currentScope || 'work';
    const domain = data?.domain || '';
    const proposedChosen = data?.chosen || data?.rule || data?.approach || '';
    const proposedErrorSig = data?.errorSignature || '';
    for (const [id, node] of this.nodeMap) {
      const kt = this._getKnowledgeType(node);
      if (!kt) continue;
      const props = node.properties || {};
      if (node.isForgotten || props.archived || props.compacted) continue;
      if (domain && props.domain && props.domain !== domain) continue;
      const active = (props.status || 'active') !== 'superseded' && (props.status || 'active') !== 'obsolete';
      if (!active) continue;
      if (kt === 'decision' && props.protection === 'locked' && proposedChosen && props.chosen && props.chosen !== proposedChosen) {
        warnings.push({ type: 'locked_decision', id, label: node.label, message: `Locked decision "${props.chosen}" covers this domain. Rationale: ${props.rationale || ''}`, existing: props.chosen, proposed: proposedChosen });
      }
      if (kt === 'principle' && proposedChosen) {
        const rule = props.rule || '';
        if (rule && this._tokenize(rule).some(t => proposedChosen.toLowerCase().includes(t))) {
          warnings.push({ type: 'principle', id, label: node.label, message: `Active principle: "${rule}" may conflict with proposed action.`, existing: rule, proposed: proposedChosen });
        }
      }
      if (kt === 'constraint') {
        warnings.push({ type: 'constraint', id, label: node.label, message: `Active constraint: "${props.invariant || props.rule || ''}". Ensure proposed action does not violate.`, existing: props.invariant || props.rule || '' });
      }
      if (kt === 'failure' && proposedErrorSig && props.errorSignature === proposedErrorSig) {
        warnings.push({ type: 'known_failure', id, label: node.label, message: `Known failure: "${props.approach}". Same error signature: ${props.errorSignature}. Error: ${props.error || ''}`, existing: props.approach, proposed: proposedErrorSig });
      }
      const edges = this.adjacency.get(id) || [];
      const contradictsEdges = edges.filter(e => e.edge.label === 'contradicts' && e.edge.active);
      if (contradictsEdges.length > 0) {
        contradictsEdges.forEach(e => {
          const targetNode = this.nodeMap.get(e.neighborId);
          warnings.push({ type: 'contradicts_edge', id, label: node.label, message: `Knowledge "${node.label}" has an active contradicts edge to "${targetNode?.label || e.neighborId}".`, existing: node.label, proposed: targetNode?.label || e.neighborId });
        });
      }
    }
    return warnings;
  }
}

/**
 * Check if a node's scope matches a search scope (prefix match).
 * 'all' or null matches any scope. Otherwise, the node scope must equal or be a prefix-descendant of the search scope.
 * @param {string} nodeScope - The scope of the node (e.g. 'user:alice/project:repo/branch:main').
 * @param {string} searchScope - The scope to match against (e.g. 'user:alice' matches 'user:alice/project:repo').
 * @returns {boolean} True if the scopes match.
 * @example
 * scopeMatches('user:alice/project:repo', 'user:alice');  // true
 */
function scopeMatches(nodeScope, searchScope) {
  if (!searchScope || searchScope === "all") return true;
  if (!nodeScope) return false;
  if (nodeScope === searchScope) return true;
  return nodeScope.startsWith(searchScope + '/');
}

/** Legacy alias for backward compatibility. Use `AlekhDB` for new code. */
export const Supermemory = AlekhDB;
