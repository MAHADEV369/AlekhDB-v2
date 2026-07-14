# Phase 5 — Profiles & Memory Review

> **Edit**: `alekhdb.js` (profile system, review queue, mass-forget, provenance)
> **New deps**: ZERO
> **Goal**: Match Supermemory's profile + inferred review + agentic forget
> **Depends on**: Phase 2 (memory types, versioned DAG), Phase 3 (filters), Phase 4 (search)

---

## Context

**Current `profile()`** (line 793-835): hardcoded markdown template that finds `client` nodes and `summary` nodes, checks `uses_backend` edge. Returns a static string. Not configurable.

**What Supermemory does**: auto-maintains static (permanent facts) + dynamic (recent episodic) profile. Configurable buckets per project. ~50ms call. Also has inferred memory review queue (approve/decline/undo) + agentic mass-forget (search query → soft-delete matches).

---

## Step 5.1: Static + Dynamic Profile System

### Replace existing `profile()` method (line 793-835):

```javascript
profile(options = {}) {
  const { scope = this.currentScope || "all", buckets = null } = options;
  
  // Get configured buckets (or defaults)
  const bucketConfig = buckets || this._profileBuckets || {
    static: ['role', 'occupation', 'name', 'preferredChannel', 'preferredRuntime', 'preferredEditor'],
    dynamic: ['currentProject', 'recentActivity', 'lastDebugging', 'currentTask'],
  };
  
  // Gather static facts (high-strength, fact/preference type, not forgotten, isLatest)
  const staticFacts = [];
  const dynamicFacts = [];
  
  for (const [id, node] of this.nodeMap) {
    if (node.isForgotten) continue;
    if (node.isLatest === false) continue;
    if (node.properties?.archived || node.properties?.compacted) continue;
    if (scope !== "all" && !scopeMatches(node.scope, scope)) continue;
    
    const isStatic = node.memoryType === 'fact' || node.memoryType === 'preference';
    const isDynamic = node.memoryType === 'episode' || node.memoryType === 'note';
    
    if (isStatic && staticFacts.length < 50) {
      staticFacts.push({
        label: node.label,
        type: node.memoryType,
        strength: node.properties?.cognitiveStrength || 1.0,
      });
    }
    if (isDynamic && dynamicFacts.length < 20) {
      dynamicFacts.push({
        label: node.label,
        type: node.memoryType,
        lastAccessed: node.properties?.lastAccessedAt,
      });
    }
  }
  
  // Sort facts by strength (static) or recency (dynamic)
  staticFacts.sort((a, b) => b.strength - a.strength);
  dynamicFacts.sort((a, b) => new Date(b.lastAccessed || 0) - new Date(a.lastAccessed || 0));
  
  // Synthesize markdown
  let md = `# Profile\n\n`;
  md += `## Stable Profile\n`;
  if (staticFacts.length > 0) {
    staticFacts.forEach(f => { md += `* ${f.label} (${f.type})\n`; });
  } else {
    md += `* No stable facts indexed yet.\n`;
  }
  md += `\n## Recent Context\n`;
  if (dynamicFacts.length > 0) {
    dynamicFacts.forEach(f => { md += `* ${f.label}\n`; });
  } else {
    md += `* No recent episodic activity.\n`;
  }
  md += `\n## Memory Stats\n`;
  md += `* Active memories: ${this.nodes.filter(n => !n.isForgotten && n.isLatest !== false).length}\n`;
  md += `* Compaction summaries: ${this.nodes.filter(n => n.type === 'summary').length}\n`;
  md += `* Traces: ${this.traces.length}\n`;
  
  return md;
}
```

### Backward compat: `profile()` with no args still returns a markdown string (same interface as today).

### New: also return structured data:

```javascript
profileStructured(options = {}) {
  const { scope = this.currentScope || "all" } = options;
  // Same logic as profile() but return object:
  return {
    static: [...],
    dynamic: [...],
    stats: { activeMemories: ..., totalTraces: ..., avgStrength: ... },
  };
}
```

---

## Step 5.2: Configurable Profile Buckets

### New properties in constructor:

```javascript
this._profileBuckets = null;  // null = use defaults
```

### New methods:

```javascript
setProfileBuckets(buckets) {
  // buckets: { static: ['name', 'role', ...], dynamic: ['currentProject', ...] }
  this._profileBuckets = buckets;
  this._markDirty();
  this.emit('profile:buckets-updated', buckets);
}

getProfileBuckets() {
  return this._profileBuckets || { static: [...defaults...], dynamic: [...defaults...] };
}

// Auto-suggest buckets based on existing data (like Supermemory's "suggest")
suggestProfileBuckets(contextPrompt = '') {
  // Analyze existing metadata keys across all nodes
  const keyFreq = new Map();
  this.nodes.forEach(n => {
    if (n.metadata) Object.keys(n.metadata).forEach(k => keyFreq.set(k, (keyFreq.get(k) || 0) + 1));
    if (n.properties) {
      Object.keys(n.properties).forEach(k => {
        if (!['cognitiveStrength', 'lastAccessedAt', 'compacted', 'archived', 'embedding', 'embeddingModel'].includes(k)) {
          keyFreq.set(k, (keyFreq.get(k) || 0) + 1);
        }
      });
    }
  });
  
  // Top keys by frequency → suggest as buckets
  const sorted = [...keyFreq.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 6).map(([k]) => k);
  
  // Rough heuristic: keys containing 'name'/'role'/'pref' → static; 'current'/'recent'/'last' → dynamic
  const staticKeys = top.filter(k => /name|role|pref|occupation|editor|runtime/i.test(k));
  const dynamicKeys = top.filter(k => /current|recent|last|active|task|debug/i.test(k));
  
  return {
    static: staticKeys.length > 0 ? staticKeys : top.slice(0, 3),
    dynamic: dynamicKeys.length > 0 ? dynamicKeys : top.slice(3, 6),
  };
}
```

---

## Step 5.3: Inferred Memory Review Queue

### New `review` namespace on AlekhDB:

```javascript
// review = { list, approve, decline, undo }

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
          inferred.push({
            id,
            memory: node.label,
            parentCount: this.edges.filter(e => e.target === id && e.label === 'derives').length,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            metadata: node.metadata,
          });
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
        this._indexNode(node);  // re-index for search
        this.logAudit('INFERENCE_UNDO', `Review undone: ${node.label}`);
        this.emit('memory:reviewed', { id: memoryId, action: 'undo' });
        this._markDirty();
        return { id: memoryId, isInference: true, isForgotten: false, reviewStatus: null };
      },
    };
  }
  return this._reviewApi;
}
```

### Usage:
```javascript
const queue = db.review.list({ scope: 'user:alice' });
// [{ id: 'mem_inf_1', memory: 'Alice likely works on auth', parentCount: 3 }, ...]

await db.review.approve('mem_inf_1');
// Now ranks like a stated fact

await db.review.decline('mem_inf_2');
// Forgotten, leaves search

await db.review.undo('mem_inf_2');
// Returns to queue
```

---

## Step 5.4: Agentic Mass-Forget

### New method:

```javascript
async forgetMatch(options = {}) {
  const { query, scope = "all", dryRun = false, limit = 100 } = options;
  if (!query?.trim()) return { matched: 0, forgotten: 0, dryRun };
  
  // Search for matching memories
  const searchResults = await this.searchHybrid(query, scope, { limit, signals: { keyword: 0.6, vector: 0.4 } });
  
  const matches = searchResults.results.map(r => ({ id: r.id, label: r.node.label, type: r.node.memoryType }));
  
  if (dryRun) {
    return { matched: matches.length, forgotten: 0, dryRun: true, matches };
  }
  
  // Soft-delete (forget) all matches
  let forgotten = 0;
  matches.forEach(m => {
    const node = this.nodeMap.get(m.id);
    if (node) {
      node.isForgotten = true;
      node.forgetReason = `Agentic mass-forget: "${query}"`;
      node.updatedAt = new Date().toISOString();
      this._unindexNode(m.id);
      forgotten++;
    }
  });
  
  this.logAudit('AGENTIC_FORGET', `Forgot ${forgotten} memories matching "${query}"`);
  this.emit('memory:mass-forgotten', { count: forgotten, query });
  this._markDirty();
  
  return { matched: matches.length, forgotten, dryRun: false, matches };
}
```

### Usage:
```javascript
// Preview what would be forgotten
const preview = await db.forgetMatch({
  query: 'old deployment configs from last quarter',
  scope: 'user:alice',
  dryRun: true,
});
console.log(preview.matches);  // [{ id: 'mem_x', label: '...'}, ...]

// Execute
const result = await db.forgetMatch({
  query: 'old deployment configs from last quarter',
  scope: 'user:alice',
  dryRun: false,
});
console.log(`Forgot ${result.forgotten} memories`);
```

---

## Step 5.5: Escaped Anti-Noise Filter (Skip garbage on ingestion)

### In `addMemory()` (Phase 2 override), add noise detection:

```javascript
// Before LLM extraction, check if input is meaningful:
const noisePatterns = [
  /^(hi|hello|hey|ok|okay|sure|thanks|thank you|yep|nope|yes|no)$/i,
  /^(cool|nice|great|awesome|got it|sounds good)$/i,
  /^.{0,10}$/,  // too short (<10 chars)
];
const isNoise = noisePatterns.some(p => p.test(text.trim()));
if (isNoise) {
  this.logAudit('NOISE_SKIPPED', `Skipped non-meaningful input: "${text.slice(0, 30)}..."`);
  return { nodes: [], edges: [], conflict: null, prunedCount: 0, skipped: 'noise' };
}
```

---

## Step 5.6: Episodic Trace Provenance

### In `startTrace()` (existing line 1078): link traces to memories they'll learn from.

### In `ingestTraceAsMemory()` (existing line 1173): when bridging trace to graph, stamp `sourceTraceId` on each new memory:

```javascript
// In the trace ingestion loop:
extractedNodeId.forEach(extractedNodeId => {
  const node = this.nodeMap.get(extractedNodeId);
  if (node) {
    node.properties.sourceTrace = traceId;
    node.properties.sourceAgent = trace.agentId;
    // ...
  }
});
```

### New method to query provenance:
```javascript
getProvenance(memoryId) {
  const node = this.nodeMap.get(memoryId);
  if (!node) return null;
  
  const trace = node.properties?.sourceTrace ? this.traces.find(t => t.traceId === node.properties.sourceTrace) : null;
  return {
    memoryId,
    sourceTrace: node.properties?.sourceTrace || null,
    sourceAgent: node.properties?.sourceAgent || null,
    trace: trace ? {
      taskId: trace.taskId,
      outcome: trace.outcome,
      createdAt: trace.createdAt,
    } : null,
  };
}
```

---

## Verification

```bash
# 1. Profile with static+dynamic
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('f1', 'User prefers Bun', 'concept', {}, 'work', { memoryType: 'fact' });
db.getNode('f1').properties.cognitiveStrength = 1.5;
db.addNode('e1', 'Debugging auth at 3pm today', 'note', {}, 'work', { memoryType: 'episode' });
const profile = db.profile();
console.log('Has Stable:', profile.includes('Stable'));
console.log('Has Recent:', profile.includes('Recent'));
console.log('Has Bun:', profile.includes('Bun'));
"

# 2. Configurable buckets
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.setProfileBuckets({ static: ['name', 'language'], dynamic: ['currentTask'] });
console.log('Buckets:', JSON.stringify(db.getProfileBuckets()));
"

# 3. Inferred review queue
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('inf1', 'User likely works on auth', 'concept', {}, 'work', { memoryType: 'inference', isInference: true, reviewStatus: 'unreviewed' });
const queue = db.review.list();
console.log('Queue size:', queue.length);  // 1
db.review.approve('inf1');
const queue2 = db.review.list();
console.log('After approve:', queue2.length);  // 0
"

# 4. Mass-forget
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('old1', 'Old deployment config v1', 'config', {}, 'work', { memoryType: 'fact' });
db.addNode('old2', 'Old deployment config v2', 'config', {}, 'work', { memoryType: 'fact' });
const preview = await db.forgetMatch({ query: 'old deployment', dryRun: true });
console.log('Preview matches:', preview.matched);  // 2
const result = await db.forgetMatch({ query: 'old deployment', dryRun: false });
console.log('Forgotten:', result.forgotten);  // 2
"

# 5. Provenance
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.startTrace('t1', 'cursor-ide', 's1', 'deploy-app');
db.addNode('learned', 'Bun is fast', 'concept', {}, 'work', { memoryType: 'fact' });
db.getNode('learned').properties.sourceTrace = 't1';
db.getNode('learned').properties.sourceAgent = 'cursor-ide';
const prov = db.getProvenance('learned');
console.log('Source agent:', prov.sourceAgent);  // 'cursor-ide'
console.log('Trace task:', prov.trace?.taskId);  // 'deploy-app'
"
```

## Files

- `alekhdb.js` — all new methods integrated