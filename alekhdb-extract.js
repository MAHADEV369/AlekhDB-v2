// alekhdb-extract.js — Elective Ollama LLM Extraction Module
// Depends on: alekhdb.js (Phase 1+2), external Ollama service
// Zero new npm dependencies — uses fetch() to call Ollama REST API

export async function enableExtraction(db, config = {}) {
  const { provider = 'ollama', model = 'llama3', endpoint = 'http://localhost:11434', apiKey = '', infer = true } = config;
  db.extractionConfig = { provider, model, endpoint, apiKey, infer };
  const originalAddMemory = db.addMemory.bind(db);
  db.addMemory = async function(text, scope = db.currentScope || "work", options = {}) {
    if (!db.extractionConfig || !db.extractionConfig.infer) return originalAddMemory(text, scope, options);
    return llmExtractAndAdd.call(db, text, scope, options);
  };
  db.disableExtraction = () => { db.addMemory = originalAddMemory; delete db.extractionConfig; };
}

async function llmExtractAndAdd(text, scope, options = {}) {
  const db = this;
  const config = db.extractionConfig;
  const existing = await db.search(text, scope, { maxDepth: 1 });
  const existingFacts = existing.traversedNodeIds.map(id => db.nodeMap.get(id)).filter(n => n && !n.isForgotten && n.memoryType !== 'document').map(n => ({ id: n.id, label: n.label, type: n.memoryType, version: n.version })).slice(0, 20);

  let fullPrompt = text;
  if (options.conversationContext && options.conversationContext.length > 0) {
    fullPrompt = `CONVERSATION:\n${options.conversationContext.map(m => `[${m.role}]: ${m.content}`).join('\n')}\n\n[EXTRACT FROM]: ${text}`;
  }

  const systemPrompt = `You are a memory extraction engine. Extract durable facts, preferences, decisions, and episodes from the user's input.

EXISTING MEMORIES (for dedup):
${JSON.stringify(existingFacts)}

RULES:
- ADDITIVE ONLY: extract new facts, don't propose updates or deletes
- Skip noise (greetings, filler, acknowledgments)
- For each fact, classify type: fact, preference, episode, or inference
- If you infer something (not directly stated), mark it as inference
- Detect contradictions: if new text conflicts with existing, note the conflict

Return JSON EXACTLY:
{"memories": [{"text": "...", "type": "fact|preference|episode|inference", "metadata": {}}], "contradictions": [{"description": "...", "conflictingMemoryIds": ["id1", "id2"]}]}`;

  let extraction = { memories: [], contradictions: [] };
  const noisePatterns = [/^(hi|hello|hey|ok|okay|sure|thanks|thank you|yep|nope|yes|no)$/i, /^(cool|nice|great|awesome|got it|sounds good)$/i, /^.{0,10}$/];
  if (noisePatterns.some(p => p.test(text.trim()))) {
    db.logAudit('NOISE_SKIPPED', `Skipped non-meaningful input: "${text.slice(0, 30)}..."`);
    return { nodes: [], edges: [], conflict: null, prunedCount: 0, skipped: 'noise' };
  }

  try {
    let llmResponse;
    if (config.provider === 'ollama') {
      llmResponse = await callOllama(config.endpoint, config.model, systemPrompt, fullPrompt);
    } else {
      llmResponse = await db.llmClient.chat(systemPrompt, fullPrompt, { provider: config.provider, apiKey: config.apiKey || db.llmConfig.apiKey, endpoint: config.endpoint, model: config.model });
    }
    if (llmResponse) {
      const clean = llmResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      extraction = JSON.parse(clean);
    }
  } catch (err) {
    console.error('[alekhdb-extract] LLM extraction failed, falling back to rules:', err.message);
    return originalRulesAddMemory.call(db, text, scope, options);
  }

  const docId = db.generateId("doc");
  db.addNode(docId, `Doc (${text.slice(0, 15)}...)`, "document", { fullText: text }, scope, { memoryType: "document", forgetAfter: options.forgetAfter || null });
  const extractedNodeIds = [docId];

  extraction.memories?.forEach(mem => {
    const id = db.generateId('mem');
    db.addNode(id, mem.text, 'concept', mem.metadata || {}, scope, { memoryType: mem.type || 'fact', isInference: mem.type === 'inference', reviewStatus: mem.type === 'inference' ? 'unreviewed' : null, forgetAfter: options.forgetAfter || null });
    extractedNodeIds.push(id);
    db.addEdge(db.generateId('e-src'), docId, id, 'references', 0.5, true);
  });

  extraction.contradictions?.forEach(c => {
    db.logAudit('CONTRADICTION_DETECTED', c.description);
    c.conflictingMemoryIds?.forEach(oldId => {
      const oldNode = db.nodeMap.get(oldId);
      if (oldNode) { oldNode.isLatest = false; oldNode.forgetReason = c.description; }
    });
  });

  db._markDirty();
  return { nodes: extractedNodeIds, edges: [], conflict: extraction.contradictions?.length > 0 ? `${extraction.contradictions.length} contradictions detected` : null, prunedCount: 0, extractionSource: 'llm-' + config.provider };
}

async function callOllama(endpoint, model, systemPrompt, userPrompt) {
  const url = `${endpoint}/api/chat`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], stream: false, format: 'json' }) });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.message?.content || '';
}

function originalRulesAddMemory(text, scope, options) {
  return this.constructor.prototype.addMemory.call(this, text, scope, options);
}
