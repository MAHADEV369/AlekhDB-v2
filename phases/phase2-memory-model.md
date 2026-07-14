# Phase 2 — Memory Model + Extraction

> **Edit**: `alekhdb.js` (memory model changes)
> **New file**: `alekhdb-extract.js` (Ollama LLM extraction module)
> **New deps**: ZERO (Ollama is an external service, called via fetch)
> **Goal**: Match Mem0/Supermemory extraction quality + versioned DAG
> **Depends on**: Phase 1 (Map indexes, debounced save)

---

## Context

**Current extraction** (`addMemory()`, line 464-673):
- Creates a `document` node for the raw text
- If LLM config is set (provider !== "rules"), calls LLM with entire graph state as prompt (line 488)
- Falls back to 2 hardcoded rules: "Bun migration" and "John prefers Discord"
- Otherwise: extracts capitalized words as generic `associated_with` edges
- TMS: decays conflicting edges to `weight = 0.15` (not timestamped)
- No memory versions, no `isLatest`, no relations

**What Mem0/Supermemory do better:**
- Mem0: single-pass additive LLM extraction, ~7K tokens, dedup against existing
- Supermemory: versioned DAG (`parentMemoryId`, `version`, `isLatest`), 3 relation types (`updates`/`extends`/`derives`), memory types (fact/preference/episode), inferred memories with review

---

## Step 2.1: Extend Node Data Model

### Add fields to nodes in `addNode()`:

```javascript
addNode(id, label, type, properties = {}, scope = "work", options = {}) {
  const { memoryType = "note", version = 1, parentMemoryId = null, rootMemoryId = null, isLatest = true, isForgotten = false, forgetAfter = null, isInference = false, reviewStatus = null } = options;
  
  // ... existing Ebbinghaus injection ...
  
  const node = {
    id, label, type,
    memoryType,       // NEW: 'fact'|'preference'|'episode'|'inference'|'note'|'document'
    version,          // NEW
    parentMemoryId,    // NEW
    rootMemoryId,     // NEW
    isLatest,         // NEW
    isForgotten,      // NEW
    forgetAfter,      // NEW: ISO date string or null
    isInference,      // NEW
    reviewStatus,     // NEW: 'unreviewed'|'approved'|'declined'|null
    properties: { cognitiveStrength: 1.0, lastAccessedAt: new Date().toISOString(), ...properties },
    scope,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {}      // NEW: custom filterable metadata
  };
  
  // ... push to array, nodeMap.set, _indexNode, _markDirty ...
}
```

### In `save()`: these new fields are already part of the node object, so they serialize automatically.

### In `load()`: backward compatible — old nodes without these fields get defaults via `||` / `??`.

---

## Step 2.2: Versioned Memory DAG

### New method — create a new version of an existing memory:

```javascript
createMemoryVersion(oldNodeId, newLabel, newProperties = {}) {
  const oldNode = this.nodeMap.get(oldNodeId);
  if (!oldNode) throw new Error(`Node ${oldNodeId} not found`);
  
  // 1. Mark old as not latest
  oldNode.isLatest = false;
  oldNode.updatedAt = new Date().toISOString();
  
  // 2. Create new version
  const newId = this.generateId("mem");
  this.addNode(newId, newLabel, oldNode.type, newProperties, oldNode.scope, {
    memoryType: oldNode.memoryType,
    version: oldNode.version + 1,
    parentMemoryId: oldNodeId,
    rootMemoryId: oldNode.rootMemoryId || oldNodeId,
    isLatest: true,
  });
  
  // 3. Create 'updates' edge
  const edgeId = this.generateId("e-upd");
  this.addEdge(edgeId, newId, oldNodeId, "updates", 1.0, true);
  
  // 4. Audit
  this.logAudit("MEMORY_UPDATED", `Version ${oldNode.version + 1} of "${oldNode.label}" created. Old version ${oldNode.version} archived.`);
  this._markDirty();
  
  return this.nodeMap.get(newId);
}
```

### New method — add a relation between memories:

```javascript
addRelation(fromId, toId, relationType, properties = {}) {
  // relationType: 'updates' | 'extends' | 'derives'
  const edgeId = this.generateId("e-rel");
  this.addEdge(edgeId, fromId, toId, relationType, 1.0, true, properties);
  
  if (relationType === 'updates') {
    const toNode = this.nodeMap.get(toId);
    if (toNode) {
      toNode.isLatest = false;
      toNode.updatedAt = new Date().toISOString();
    }
  }
  
  this.logAudit("RELATION_ADDED", `${relationType}: ${fromId} → ${toId}`);
  return edgeId;
}
```

---

## Step 2.3: Three Relation Types

These are just edge `label` values, but with semantic meaning enforced in `addRelation()`:

| Relation | Effect | Example |
|----------|--------|---------|
| `updates` | Old node `isLatest = false`; new version created | "User lives in SF" UPDATES "User lives in NYC" |
| `extends` | Both nodes stay `isLatest = true`; enriches context | "User works on payments" EXTENDS "User is PM at Stripe" |
| `derives` | New node `isInference = true`, `reviewStatus = 'unreviewed'`; down-weighted in search | Derived: "User likely works on core payments" |

---

## Step 2.4: Memory Types with Default Behavior

| Type | Decay | forgetAfter | Search Weight | Example |
|------|-------|-------------|---------------|---------|
| `fact` | None | null | 1.0 | "User prefers Bun" |
| `preference` | None (strengthens on access) | null | 1.0 | "Prefers dark mode" |
| `episode` | Ebbinghaus applies | null | decayed | "Met user Tuesday" |
| `inference` | Down-weighted until reviewed | null | 0.3 (until approved) | "Likely works on auth" |
| `note` | User-controlled | optional | 1.0 | "TODO: refactor" |
| `document` | Locked (current behavior) | null | 0.8 | Raw text blob |

### In `search()`: skip forgotten nodes and check forgetAfter:

```javascript
// In the candidate filtering (from Phase 1.4):
candidateIds.forEach(id => {
  const node = this.nodeMap.get(id);
  if (!node) return;
  if (searchScope !== "all" && node.scope !== searchScope) return;
  if (node.properties?.compacted || node.properties?.archived) return;
  if (node.isForgotten) return;  // NEW
  if (node.forgetAfter && new Date(node.forgetAfter) < new Date()) return;  // NEW: TTL expired
  matchedNodeIds.push(id);
  this.reinforceNodeMemory(id);
});

// After matching, apply inference down-weighting:
// If options.rerank is enabled in Phase 4, inferred nodes get 0.3x multiplier
```

---

## Step 2.5: forgetAfter TTL Expiration

### In `addMemory()`, accept options:
```javascript
async addMemory(text, scope = "work", options = {}) {
  // ... existing logic ...
  // Pass forgetAfter to addNode if provided:
  this.addNode(docId, `Doc (...)`, "document", { fullText: cleanText }, scope, {
    memoryType: "document",
    forgetAfter: options.forgetAfter || null,
  });
  // ...
}
```

### User usage:
```javascript
await db.addMemory("Meeting with Alex at 3pm today", "work", {
  forgetAfter: new Date(Date.now() + 86400000).toISOString()  // forget tomorrow
});
```

---

## Step 2.6: Ollama LLM Extraction (`alekhdb-extract.js`)

### New file `alekhdb-extract.js`:

```javascript
// alekhdb-extract.js — Elective Ollama LLM Extraction Module
// Depends on: alekhdb.js (Phase 1+2), external Ollama service
// Zero new npm dependencies — uses fetch() to call Ollama REST API

export async function enableExtraction(db, config = {}) {
  const {
    provider = 'ollama',
    model = 'llama3',
    endpoint = 'http://localhost:11434',
    apiKey = '',
    infer = true,  // additive-only single-pass extraction
  } = config;
  
  db.extractionConfig = { provider, model, endpoint, apiKey, infer };
  
  // Override addMemory to use LLM extraction
  const originalAddMemory = db.addMemory.bind(db);
  db.addMemory = async function(text, scope = "work", options = {}) {
    if (db.extractionConfig.infer) {
      return await llmExtractAndAdd.call(db, text, scope, options);
    }
    return originalAddMemory(text, scope, options);
  };
  
  db.disableExtraction = () => {
    db.addMemory = originalAddMemory;
    delete db.extractionConfig;
  };
}

async function llmExtractAndAdd(text, scope, options = {}) {
  const db = this;
  const config = db.extractionConfig;
  
  // 1. Context lookup — search existing memories (dedup)
  const existing = await db.search(text, scope, { maxDepth: 1 });
  const existingFacts = existing.traversedNodeIds
    .map(id => db.nodeMap.get(id))
    .filter(n => n && !n.isForgotten && n.memoryType !== 'document')
    .map(n => ({ id: n.id, label: n.label, type: n.memoryType, version: n.version }))
    .slice(0, 20);  // cap context size
  
  // 2. Build extraction prompt (Mem0-style additive)
  const systemPrompt = `You are a memory extraction engine. Extract durable facts, preferences, decisions, and episodes from the user's input.

EXISTING MEMORIES (for dedup — don't re-extract these):
${JSON.stringify(existingFacts)}

RULES:
- ADDITIVE ONLY: extract new facts, don't propose updates or deletes
- Skip noise (greetings, filler, acknowledgments)
- For each fact, classify type: fact, preference, episode, or inference
- If you infer something (not directly stated), mark it as inference
- Detect contradictions: if new text conflicts with existing, note the conflict

Return JSON EXACTLY:
{
  "memories": [
    { "text": "...", "type": "fact|preference|episode|inference", "metadata": {} }
  ],
  "contradictions": [
    { "description": "...", "conflictingMemoryIds": ["id1", "id2"] }
  ]
}`;

  // 3. Call LLM via existing LlmClient or direct fetch to Ollama
  let extraction = { memories: [], contradictions: [] };
  try {
    let llmResponse;
    if (config.provider === 'ollama') {
      llmResponse = await callOllama(config.endpoint, config.model, systemPrompt, text);
    } else {
      llmResponse = await db.llmClient.chat(systemPrompt, text, {
        provider: config.provider,
        apiKey: config.apiKey || db.llmConfig.apiKey,
        endpoint: config.endpoint,
        model: config.model,
      });
    }
    
    if (llmResponse) {
      const clean = llmResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      extraction = JSON.parse(clean);
    }
  } catch (err) {
    console.error('[alekhdb-extract] LLM extraction failed, falling back to rules:', err.message);
    return originalRulesAddMemory.call(db, text, scope, options);
  }
  
  // 4. Store extracted memories (additive)
  const extractedNodeIds = [];
  extraction.memories?.forEach(mem => {
    const id = db.generateId('mem');
    db.addNode(id, mem.text, 'concept', mem.metadata || {}, scope, {
      memoryType: mem.type || 'fact',
      isInference: mem.type === 'inference',
      reviewStatus: mem.type === 'inference' ? 'unreviewed' : null,
      forgetAfter: options.forgetAfter || null,
    });
    extractedNodeIds.push(id);
    
    // Link to the source document
    db.addEdge(db.generateId('e-src'), docId_placeholder, id, 'references', 0.5, true);
  });
  
  // 5. Handle contradictions (version DAG)
  extraction.contradictions?.forEach(c => {
    db.logAudit('CONTRADICTION_DETECTED', c.description);
    c.conflictingMemoryIds?.forEach(oldId => {
      const oldNode = db.nodeMap.get(oldId);
      if (oldNode) {
        // Create new version (Supermemory-style version DAG)
        // The new fact was already stored above — now mark old as superseded
        oldNode.isLatest = false;
        oldNode.forgetReason = c.description;
      }
    });
  });
  
  db._markDirty();
  
  return {
    nodes: extractedNodeIds,
    edges: [],
    conflict: extraction.contradictions?.length > 0 ? `${extraction.contradictions.length} contradictions detected` : null,
    prunedCount: 0,
    extractionSource: 'llm-' + config.provider,
  };
}

// Direct Ollama call (no dependency needed, uses fetch)
async function callOllama(endpoint, model, systemPrompt, userPrompt) {
  const url = `${endpoint}/api/chat`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      format: 'json',
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.message?.content || '';
}

// Fallback to rules-based extraction (preserves existing behavior)
function originalRulesAddMemory(text, scope, options) {
  // This is the existing rules-based path — keep as-is
  // The original addMemory already handles this when provider === "rules"
  // So we just call the original method
  return this.constructor.prototype.addMemory.call(this, text, scope, options);
}
```

### Usage:
```javascript
import { AlekhDB } from './alekhdb.js';
import { enableExtraction } from './alekhdb-extract.js';

const db = new AlekhDB(true);
await enableExtraction(db, { provider: 'ollama', model: 'llama3' });
// Now addMemory uses Ollama for extraction
await db.addMemory("I prefer using Bun for all new projects");
// If Ollama not running, falls back to rules-based automatically
```

---

## Step 2.7: Contextual Add

### In the overridden `addMemory` (from Step 2.6), accept `conversationContext`:

```javascript
async function llmExtractAndAdd(text, scope, options = {}) {
  // ... existing context lookup ...
  
  // If conversation context provided, include in prompt
  let fullPrompt = text;
  if (options.conversationContext && options.conversationContext.length > 0) {
    fullPrompt = `CONVERSATION:\n${options.conversationContext.map(m => `[${m.role}]: ${m.content}`).join('\n')}\n\n[EXTRACT FROM]: ${text}`;
  }
  
  // ... call LLM with fullPrompt instead of text ...
}
```

### Usage:
```javascript
await db.addMemory("I use Postgres", "work", {
  conversationContext: [
    { role: 'user', content: 'What database should I use?' },
    { role: 'assistant', content: 'It depends on your needs...' },
    { role: 'user', content: 'I use Postgres' }
  ]
});
// LLM sees full conversation → better extraction
```

---

## Step 2.8: Update TMS to Use Version DAG

### In existing contradiction handling (currently in `addMemory()` lines 544-566):

**Current**: decays edge to `weight = 0.15`, sets `edge.active = false`.

**New**: also set bi-temporal timestamps (added in Phase 1.6):

```javascript
// When resolving a contradiction:
edge.active = false;
edge.weight = 0.15;
edge.invalidAt = new Date().toISOString();  // NEW: bi-temporal
edge.properties.decayed = true;
edge.properties.decayReason = 'contradiction_superseded';
```

And the old memory node:
```javascript
oldNode.isLatest = false;
oldNode.forgetReason = contradiction.description;
```

---

## Verification

```bash
# 1. Existing tests pass
npm test

# 2. Version DAG test
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('mem-1', 'User lives in NYC', 'concept', {}, 'work', { memoryType: 'fact' });
const v2 = db.createMemoryVersion('mem-1', 'User lives in SF');
console.log('Old isLatest:', db.nodeMap.get('mem-1').isLatest);  // false
console.log('New isLatest:', v2.isLatest);  // true
console.log('New version:', v2.version);  // 2
console.log('New parent:', v2.parentMemoryId);  // 'mem-1'
const edges = db.edges.filter(e => e.label === 'updates');
console.log('Updates edge created:', edges.length === 1);  // true
"

# 3. forgetAfter TTL test
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('temp', 'Meeting today at 3pm', 'note', {}, 'work', {
  memoryType: 'note',
  forgetAfter: new Date(Date.now() - 1000).toISOString()  // already expired
});
const r = await db.search('Meeting today');
console.log('Expired memory excluded?', r.matchedNodeIds.length === 0);  // true
"

# 4. Ollama extraction fallback (if Ollama not running)
node -e "
import { AlekhDB } from './alekhdb.js';
import { enableExtraction } from './alekhdb-extract.js';
const db = new AlekhDB(true);
await enableExtraction(db, { provider: 'ollama', model: 'llama3' });
// Ollama not running → should fall back to rules
const r = await db.addMemory('John prefers Discord for alerts');
console.log('Fallback worked, nodes:', r.nodes.length > 0);  // true
"

# 5. Memory type test
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('fact-1', 'User prefers Bun', 'concept', {}, 'work', { memoryType: 'fact' });
db.addNode('ep-1', 'Met user on Tuesday', 'note', {}, 'work', { memoryType: 'episode' });
console.log('Fact type:', db.nodeMap.get('fact-1').memoryType);  // 'fact'
console.log('Episode type:', db.nodeMap.get('ep-1').memoryType);  // 'episode'
"
```

## Files Modified

- `alekhdb.js` — node data model, `addNode()` options, `search()` forgetAfter check, `createMemoryVersion()`, `addRelation()`, TMS bi-temporal update
- `alekhdb-extract.js` — NEW file (Ollama extraction module)
- `sampleData.js` — update seed data to include `memoryType` fields