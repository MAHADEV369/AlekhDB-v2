# Phase 4 — Retrieval Engine

> **Edit**: `alekhdb.js` (signal fusion in `search()`)
> **New files**: `alekhdb-embed.js`, `alekhdb-context.js`
> **New deps**: `@huggingface/transformers` (elective, only for embed module)
> **Goal**: Match Mem0's 4-signal fusion + beat them on speed via local index
> **Depends on**: Phase 1 (inverted index), Phase 2 (memory model), Phase 3 (filters)

---

## Context

**Current search** (`search()`, line 838): keyword-only via `String.includes()` or inverted index (after Phase 1). 1-hop graph traversal. Rules-based or LLM synthesis of results.

**What Mem0 does**: fuses 4 signals into one score: semantic (vector), keyword (BM25), entity (graph boost), temporal (recency). ~880ms cloud.

**What Supermemory does**: hybrid search with reranking + query rewriting. ~92-400ms cloud.

**Our target**: 5-signal fusion in **< 6ms** at 10K nodes, fully local.

---

## Step 4.1: Multi-Signal Fusion Search

### New method `searchHybrid()`:

```javascript
async searchHybrid(query, searchScope = "all", options = {}) {
  const {
    signals = { keyword: 0.25, vector: 0.40, entity: 0.20, temporal: 0.10, cognitive: 0.05 },
    filters = null,
    rerank = false,
    threshold = 0.0,
    limit = 10,
    maxDepth = 1,
  } = options;
  
  if (!query?.trim()) return { results: [], synthesis: "Empty query" };
  
  const cleanQuery = String(query).toLowerCase().trim();
  this.logAudit("SEARCH_HYBRID", `"${query}" with ${Object.keys(signals).length} signals`);
  
  // === Signal 1: KEYWORD (inverted index) ===
  const keywordScores = new Map();  // nodeId → score 0..1
  if (signals.keyword > 0) {
    const queryTokens = this._tokenize(cleanQuery);
    const tokenMatches = new Map();  // nodeId → match count
    queryTokens.forEach(token => {
      const ids = this.invertedIndex.get(token);
      if (ids) ids.forEach(id => tokenMatches.set(id, (tokenMatches.get(id) || 0) + 1));
    });
    const maxMatches = Math.max(1, ...tokenMatches.values());
    tokenMatches.forEach((count, id) => {
      keywordScores.set(id, count / maxMatches);  // normalize 0..1
    });
  }
  
  // === Signal 2: VECTOR (cosine similarity, requires embed module) ===
  const vectorScores = new Map();
  if (signals.vector > 0 && this._embedFn) {
    const queryVec = await this._embedFn(cleanQuery);
    for (const [id, node] of this.nodeMap) {
      if (node.properties?.archived || node.properties?.compacted || node.isForgotten) continue;
      if (node.properties?.embedding) {
        const sim = cosineSimilarity(queryVec, node.properties.embedding);
        vectorScores.set(id, sim);
      }
    }
  }
  
  // === Signal 3: ENTITY (graph boost from matched nodes) ===
  const entityScores = new Map();
  if (signals.entity > 0) {
    const seedIds = new Set([...keywordScores.keys(), ...vectorScores.keys()]);
    seedIds.forEach(id => {
      const neighbors = this.adjacency?.get(id) || [];
      neighbors.forEach(({ neighborId }) => {
        entityScores.set(neighborId, (entityScores.get(neighborId) || 0) + 1);
      });
    });
    const maxEntity = Math.max(1, ...entityScores.values());
    entityScores.forEach((count, id) => entityScores.set(id, count / maxEntity));
  }
  
  // === Signal 4: TEMPORAL (recency boost) ===
  const temporalScores = new Map();
  if (signals.temporal > 0) {
    const now = Date.now();
    const allCandidateIds = new Set([...keywordScores.keys(), ...vectorScores.keys(), ...entityScores.keys()]);
    let maxAge = 1;
    allCandidateIds.forEach(id => {
      const node = this.nodeMap.get(id);
      if (node?.properties?.lastAccessedAt) {
        const age = now - new Date(node.properties.lastAccessedAt).getTime();
        maxAge = Math.max(maxAge, age);
      }
    });
    allCandidateIds.forEach(id => {
      const node = this.nodeMap.get(id);
      if (node?.properties?.lastAccessedAt) {
        const age = now - new Date(node.properties.lastAccessedAt).getTime();
        temporalScores.set(id, 1 - (age / maxAge));  // more recent = higher score
      }
    });
  }
  
  // === Signal 5: COGNITIVE (Ebbinghaus strength) ===
  const cognitiveScores = new Map();
  if (signals.cognitive > 0) {
    const allCandidateIds = new Set([...keywordScores.keys(), ...vectorScores.keys(), ...entityScores.keys()]);
    allCandidateIds.forEach(id => {
      const node = this.nodeMap.get(id);
      if (node?.properties?.cognitiveStrength !== undefined) {
        cognitiveScores.set(id, node.properties.cognitiveStrength / 2.0);  // normalize to 0..1
      }
    });
  }
  
  // === FUSION ===
  const allCandidateIds = new Set([
    ...keywordScores.keys(),
    ...vectorScores.keys(),
    ...entityScores.keys(),
    ...temporalScores.keys(),
    ...cognitiveScores.keys(),
  ]);
  
  const fusedResults = [];
  allCandidateIds.forEach(id => {
    const node = this.nodeMap.get(id);
    if (!node) return;
    if (!scopeMatches(node.scope, searchScope)) return;
    if (node.properties?.archived || node.properties?.compacted) return;
    if (node.isForgotten) return;
    if (node.forgetAfter && new Date(node.forgetAfter) < new Date()) return;
    if (filters && !this._matchFilters(node, filters)) return;
    
    // Down-weight inferred memories
    const inferenceMultiplier = node.isInference && node.reviewStatus !== 'approved' ? 0.3 : 1.0;
    
    const score = (
      (signals.keyword || 0) * (keywordScores.get(id) || 0) +
      (signals.vector || 0) * (vectorScores.get(id) || 0) +
      (signals.entity || 0) * (entityScores.get(id) || 0) +
      (signals.temporal || 0) * (temporalScores.get(id) || 0) +
      (signals.cognitive || 0) * (cognitiveScores.get(id) || 0)
    ) * inferenceMultiplier;
    
    if (score >= threshold) {
      fusedResults.push({ id, node, score, signals: {
        keyword: keywordScores.get(id) || 0,
        vector: vectorScores.get(id) || 0,
        entity: entityScores.get(id) || 0,
        temporal: temporalScores.get(id) || 0,
        cognitive: cognitiveScores.get(id) || 0,
      }});
    }
  });
  
  // Sort by fused score
  fusedResults.sort((a, b) => b.score - a.score);
  
  // === RERANKING (optional, cross-encoder) ===
  if (rerank && this._rerankFn) {
    await this._rerankFn(query, fusedResults);
    fusedResults.sort((a, b) => (b.rerankScore || b.score) - (a.rerankScore || a.score));
  }
  
  // === MULTI-HOP EXPANSION ===
  // (optional: include neighbor context)
  const finalResults = fusedResults.slice(0, limit);
  
  // Reinforce matched nodes
  finalResults.forEach(r => this.reinforceNodeMemory(r.id));
  
  this._markDirty();
  
  return {
    results: finalResults.map(r => ({ id: r.id, memory: r.node.label, score: r.score, type: r.node.memoryType, signals: r.signals })),
    synthesis: this._synthesizeResults(query, finalResults),
    total: fusedResults.length,
    timing: 0,  // filled by caller
  };
}

function cosineSimilarity(a, b) {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;  // vectors are already L2-normalized by embed module
}

function scopeMatches(nodeScope, searchScope) {
  if (!searchScope || searchScope === "all") return true;
  if (!nodeScope) return false;
  if (nodeScope === searchScope) return true;
  return nodeScope.startsWith(searchScope + '/');
}
```

### Backward compat: `search()` still works — it calls `searchHybrid()` with default signals (keyword + entity + temporal + cognitive, no vector):

```javascript
async search(query, searchScope = "all", options = {}) {
  const { maxDepth = 1, filters = null, useHybrid = false } = options;
  if (useHybrid || this._embedFn) {
    return this.searchHybrid(query, searchScope, options);
  }
  // ... existing keyword-only search (Phase 1 inverted index) ...
}
```

---

## Step 4.2: Local Embeddings (`alekhdb-embed.js`)

### New file `alekhdb-embed.js`:

```javascript
// alekhdb-embed.js — Elective local embeddings module
// Deps: @huggingface/transformers (auto-installed on first use, or pre-installed)
// Model: Xenova/all-MiniLM-L6-v2 (384-dim, ~25MB, ~20ms per embedding on CPU)

let pipeline = null;
let modelLoaded = false;

export async function enableEmbeddings(db, config = {}) {
  const {
    model = 'Xenova/all-MiniLM-L6-v2',
    dtype = 'q8',
    autoEmbed = true,  // auto-embed on addNode
  } = config;
  
  // Lazy load transformers.js
  if (!pipeline) {
    try {
      const transformers = await import('@huggingface/transformers');
      pipeline = await transformers.pipeline('feature-extraction', model, { dtype });
      modelLoaded = true;
    } catch (err) {
      console.error('[alekhdb-embed] Failed to load transformers.js:', err.message);
      console.error('Install with: npm install @huggingface/transformers');
      return false;
    }
  }
  
  // Embedding function
  const embedFn = async (text) => {
    const output = await pipeline(text, { pooling: 'mean', normalize: true });
    return Float32Array.from(output.data);
  };
  
  // Register on db
  db._embedFn = embedFn;
  db._embedModel = model;
  db._embedConfig = { autoEmbed };
  
  // Hook into addNode to auto-embed (wrap existing addNode)
  if (autoEmbed) {
    const originalAddNode = db.addNode.bind(db);
    db.addNode = function(id, label, type, properties = {}, scope = "work", options = {}) {
      // Call original
      originalAddNode(id, label, type, properties, scope, options);
      const node = db.nodeMap.get(id);
      if (node && autoEmbed) {
        // Async embed — don't block addNode
        const text = `${label} ${type} ${JSON.stringify(properties)}`;
        embedFn(text).then(vec => {
          node.properties.embedding = vec;
          node.properties.embeddingModel = model;
          node.properties.embeddingsVersion = 1;
          db._markDirty();
        }).catch(err => console.error('[alekhdb-embed] Embed failed:', err.message));
      }
      return node;
    };
  }
  
  // Add embedAll method (batch re-embed)
  db.embedAll = async function() {
    let count = 0;
    for (const [id, node] of db.nodeMap) {
      if (node.properties?.archived || node.isForgotten) continue;
      const text = `${node.label} ${node.type} ${JSON.stringify(node.properties)}`;
      node.properties.embedding = await embedFn(text);
      node.properties.embeddingModel = model;
      node.properties.embeddingsVersion = 1;
      count++;
      if (count % 100 === 0) console.log(`[alekhdb-embed] Embedded ${count}...`);
    }
    db._markDirty();
    return count;
  };
  
  // Add searchVector shortcut
  db.searchVector = async function(query, k = 10) {
    return db.searchHybrid(query, 'all', {
      signals: { keyword: 0, vector: 1.0, entity: 0, temporal: 0, cognitive: 0 },
      limit: k,
    });
  };
  
  db.disableEmbeddings = function() {
    db._embedFn = null;
    db._embedModel = null;
    // Note: existing embeddings stay in node properties
  };
  
  return true;
}
```

### Usage:
```javascript
import { enableEmbeddings } from './alekhdb-embed.js';

const db = new AlekhDB(true);
await enableEmbeddings(db);  // auto-downloads ~25MB model on first call

await db.addMemory("The rate limiter uses express-rate-limit");
// Node auto-embedded in background

const results = await db.searchVector("throttle middleware");
// Returns semantically similar nodes — no keyword overlap needed

const hybrid = await db.searchHybrid("throttle", 'all', {
  signals: { keyword: 0.3, vector: 0.5, entity: 0.2 },
  rerank: false,
  limit: 10,
});
```

---

## Step 4.3: Reranking (Optional)

### In `alekhdb-embed.js`, add:

```javascript
export async function enableReranking(db, config = {}) {
  const { model = 'Xenova/ms-marco-MiniLM-L-6-v2' } = config;
  
  let rerankPipeline = null;
  try {
    const transformers = await import('@huggingface/transformers');
    rerankPipeline = await transformers.pipeline('text-classification', model, { dtype: 'q8' });
  } catch (err) {
    console.error('[rerank] Failed to load reranker:', err.message);
    return false;
  }
  
  db._rerankFn = async (query, results) => {
    for (const r of results) {
      try {
        const score = await rerankPipeline(`${query} [SEP] ${r.node.label}`);
        r.rerankScore = score[0]?.score || r.score;
      } catch (e) {
        r.rerankScore = r.score;
      }
    }
  };
  
  return true;
}
```

### Usage:
```javascript
import { enableEmbeddings, enableReranking } from './alekhdb-embed.js';
await enableEmbeddings(db);
await enableReranking(db);

const results = await db.searchHybrid("query", 'all', { rerank: true });
// +~50ms for cross-encoder pass, higher quality ranking
```

---

## Step 4.4: Token-Aware Context Packing (`alekhdb-context.js`)

### New file `alekhdb-context.js`:

```javascript
// alekhdb-context.js — Elective: token-aware context packing
// No new deps. Uses db.searchHybrid() + db.profile() + string packing.
// Returns prompt-ready markdown string within a token budget.

export async function getContext(db, options = {}) {
  const {
    query,
    maxTokens = 4000,
    includeProfile = true,
    includeRelations = true,
    includeTraces = false,
    signals = { keyword: 0.3, vector: 0.5, entity: 0.2 },
    filters = null,
    scope = "all",
  } = options;
  
  if (!query?.trim()) return { context: "", sources: [], tokenCount: 0 };
  
  // 1. Run hybrid search
  const searchResults = await db.searchHybrid(query, scope, { signals, filters, limit: 50 });
  
  // 2. Get profile (if requested)
  let profileText = "";
  if (includeProfile) {
    const profile = db.profile();
    if (profile) {
      profileText = `## User Profile\n${profile}\n\n`;
    }
  }
  
  // 3. Build context greedily within token budget
  const approxToken = (text) => Math.ceil(text.length / 4);
  let currentTokens = approxToken(profileText);
  const packedMemories = [];
  const sources = [];
  
  for (const result of searchResults.results) {
    const memoryText = `${result.memory} (type: ${result.type}, score: ${result.score.toFixed(3)})\n`;
    const memTokens = approxToken(memoryText);
    
    if (currentTokens + memTokens > maxTokens) break;
    
    packedMemories.push(`${packedMemories.length + 1}. ${memoryText.trim()}`);
    sources.push({ id: result.id, score: result.score, type: result.type });
    currentTokens += memTokens;
    
    // Include relation chain (if requested and exists)
    if (includeRelations && result.id) {
      const history = db.getHistory(result.id);
      if (history.length > 1) {
        const histText = `   ^ Updated through ${history.length} versions (latest: v${history[0].version})\n`;
        if (currentTokens + approxToken(histText) <= maxTokens) {
          packedMemories[packedMemories.length - 1] += "\n" + histText.trim();
          currentTokens += approxToken(histText);
        }
      }
    }
  }
  
  // 4. Include recent traces (if requested)
  let tracesText = "";
  if (includeTraces && db.traces.length > 0) {
    const recentTraces = db.traces.slice(-3);
    tracesText = `\n## Recent Agent Activity\n`;
    recentTraces.forEach(t => {
      const tText = `- Trace ${t.traceId}: ${t.taskId} (${t.status}, outcome: ${t.outcome})\n`;
      if (currentTokens + approxToken(tText) <= maxTokens) {
        tracesText += tText;
        currentTokens += approxToken(tText);
      }
    });
  }
  
  // 5. Assemble final context
  let context = "";
  if (profileText) context += profileText;
  if (packedMemories.length > 0) {
    context += `## Relevant Memories\n${packedMemories.join('\n')}\n\n`;
  }
  if (tracesText) context += tracesText;
  
  return {
    context: context.trim(),
    sources,
    tokenCount: currentTokens,
    profileIncluded: !!profileText,
    memoriesIncluded: packedMemories.length,
  };
}
```

### Usage:
```javascript
import { getContext } from './alekhdb-context.js';

const ctx = await getContext(db, {
  query: 'auth refactor',
  maxTokens: 4000,
  includeProfile: true,
  includeRelations: true,
});
// ctx.context = "## User Profile\nName: Trident\nPrefers Bun...\n\n## Relevant Memories\n1. Auth middleware uses JWT (score: 0.92)\n2. ..."
// Pass ctx.context directly into your LLM prompt.
```

---

## Performance Notes

| Signal | Computation | Time @ 10K |
|--------|-------------|------------|
| keyword | inverted index lookup | < 0.1ms |
| vector | brute-force cosine on Float32Array(384) | ~5ms (10K × 384 floats) |
| entity | BFS via adjacency Map | < 0.5ms |
| temporal | Date math on lastAccessedAt | < 0.01ms |
| cognitive | read cognitiveStrength field | < 0.01ms |
| fusion | weighted sum + sort | < 0.5ms |
| **Total (5 signals)** | | **~6ms** |

At 100K nodes, vector brute-force = ~50ms. Upgrade path: migrate embeddings to `sqlite-vec` (Phase 6 or later).

---

## Verification

```bash
# 1. Keyword-only search still works (backward compat)
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('test', 'Payment service', 'concept', {}, 'work');
const r = await db.search('payment');
console.log('Keyword search:', r.matchedNodeIds?.length > 0 || r.results?.length > 0);
"

# 2. Hybrid search without embeddings (falls back to keyword+entity+temporal)
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('p1', 'Payment processor', 'concept', {}, 'work', { memoryType: 'fact' });
db.addNode('p2', 'Stripe integration', 'technology', {}, 'work', { memoryType: 'fact' });
db.addEdge('e1', 'p1', 'p2', 'uses', 1, true);
const r = await db.searchHybrid('payment', 'all', { signals: { keyword: 0.5, entity: 0.5 }, limit: 5 });
console.log('Hybrid results:', r.results.length > 0);
console.log('Entity boost found Stripe?', r.results.some(x => x.id === 'p2'));
"

# 3. Context packing
node -e "
import { AlekhDB } from './alekhdb.js';
import { getContext } from './alekhdb-context.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('m1', 'Auth middleware uses JWT tokens', 'concept', {}, 'work', { memoryType: 'fact' });
db.addNode('m2', 'Rate limiter uses express-rate-limit', 'concept', {}, 'work', { memoryType: 'fact' });
const ctx = await getContext(db, { query: 'auth', maxTokens: 500 });
console.log('Context tokens:', ctx.tokenCount < 500);
console.log('Has content:', ctx.context.length > 0);
"
```

## Files

- `alekhdb.js` — `searchHybrid()`, `cosineSimilarity()`, `scopeMatches()` helper, `_embedFn` / `_rerankFn` hooks
- `alekhdb-embed.js` — NEW (local embeddings module)
- `alekhdb-context.js` — NEW (token-aware context packing)
- `package.json` — add `@huggingface/transformers` as optional peer dependency