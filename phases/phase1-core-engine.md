# Phase 1 — Core Engine Robustness

> **Edit**: `alekhdb.js` only
> **New deps**: ZERO
> **Goal**: Sub-millisecond core ops. Crash safety. No new features.
> **Lines changed**: ~150

---

## Context

`alekhdb.js` is a ~1268-line single-file engine. Key structures:

```javascript
export class AlekhDB {
  constructor(isNode) {
    this.nodes = []          // all nodes
    this.edges = []          // all edges
    this.auditLog = []      // capped at 500
    this.traces = []         // episodic traces
    this.eventFrames = []    // trace frames
    this.contextCapacity = 32000
    this.autoSave = true
    this.dbPath = "./alekhdb_db.json"
  }
}
```

**Existing problems (verified by tests):**
- `save()` calls `fs.writeFileSync(JSON.stringify(allData))` on EVERY `addNode()`/`addEdge()` → 9K adds timeout at 30s
- `findIndex()` for lookups = O(n)
- Corrupted JSON → `this.nodes = []` (silent data wipe, line 247)
- `applyEbbinghausDecay()` runs on every `addMemory()` + `search()` scan all nodes
- Decay rate `0.002` per second = ~6 min half-life (demo-only)
- Search traverses only 1-hop neighbors

---

## Step 1.1: Atomic Writes + Backup Recovery

### Current `save()` (line 285-313):
```javascript
save() {
  if (!this.autoSave) return;
  const data = { nodes: this.nodes, edges: this.edges, ... };
  if (this.isNode) {
    try {
      if (fs) {
        fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2), "utf8");
      }
    } catch (err) { console.error("Failed to save:", err); }
  }
}
```

### Replace with:
```javascript
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
    fs.renameSync(tmp, this.dbPath);  // atomic on POSIX
  } catch (err) {
    console.error("Failed to save:", err);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch(e) {}
  }
}
```

### Current `load()` (line 220-282): the catch block at line 246 does:
```javascript
} catch (err) {
  console.error("CRITICAL: ...");
  this.nodes = [];  // SILENT WIPE — bad
  ...
}
```

### Replace the catch with:
```javascript
} catch (err) {
  console.error("CRITICAL: Failed to parse primary DB JSON. Attempting backup recovery:", err.message);
  // Try backup file
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
        this.logAudit("DB_RECOVERED", "Primary DB corrupted; restored from .bak backup file.");
        this._rebuildIndexes();  // rebuild Map indexes from arrays
        return;
      }
    }
  } catch (bakErr) {
    console.error("Backup recovery also failed:", bakErr.message);
  }
  // Last resort: empty state (but log it loudly, never silent)
  this.nodes = [];
  this.edges = [];
  this.auditLog = [];
  this.traces = [];
  this.eventFrames = [];
  this.logAudit("DB_INIT_EMPTY", "Both primary and backup DB corrupted. Starting fresh.");
}
```

Do the same for the browser `localStorage` catch block (line 273-280).

---

## Step 1.2: Map Indexes for O(1) Lookups

### In constructor, after `this.nodes = []` etc:
```javascript
this.nodeMap = new Map();   // id → node object
this.edgeMap = new Map();   // id → edge object
```

### New helper method:
```javascript
_rebuildIndexes() {
  this.nodeMap = new Map();
  this.edgeMap = new Map();
  this.nodes.forEach(n => this.nodeMap.set(n.id, n));
  this.edges.forEach(e => this.edgeMap.set(e.id, e));
  this._rebuildInvertedIndex();  // Step 1.4
}
```

### Call `_rebuildIndexes()` at end of `load()` (after arrays are populated from file).

### In `addNode()` (line 332-352):
After `this.nodes.push(...)`:
```javascript
this.nodeMap.set(id, this.nodes[this.nodes.length - 1]);
```

For the update path (existingIndex !== -1):
```javascript
this.nodes[existingIndex].properties = { ...this.nodes[existingIndex].properties, ...properties };
this.nodes[existingIndex].label = label;
this.nodeMap.set(id, this.nodes[existingIndex]);  // update map ref
```

### In `addEdge()` (line 355-371):
After `this.edges.push(...)`:
```javascript
this.edgeMap.set(id, this.edges[this.edges.length - 1]);
```

For the update path:
```javascript
this.edgeMap.set(id, this.edges[existingIndex]);
```

### New convenience method:
```javascript
getNode(id) { return this.nodeMap.get(id); }
getEdge(id) { return this.edgeMap.get(id); }
```

### Replace ALL `this.nodes.findIndex(n => n.id === id)` patterns with `this.nodeMap.get(id)`.
- Line 334: `addNode()` existing check → `this.nodeMap.has(id)`
- Line 424: `reinforceNodeMemory()` → `const node = this.nodeMap.get(nodeId);`
- Line 451: `pruneNodes()` → `const node = this.nodeMap.get(id);`
- Line 958: `search()` → `this.nodeMap.get(id)`
- Any other `this.nodes.find(...)` for ID lookup → `this.nodeMap.get(id)`

---

## Step 1.3: Debounced Save (Remove save() from Hot Path)

### In constructor:
```javascript
this._dirty = false;
this._saveTimer = null;
this._saveDebounceMs = 500;
```

### New method:
```javascript
_markDirty() {
  if (!this.autoSave) return;
  this._dirty = true;
  if (this._saveTimer) return;
  this._saveTimer = setTimeout(() => {
    this._saveTimer = null;
    if (this._dirty) {
      this._dirty = false;
      this.save();
    }
  }, this._saveDebounceMs);
}

_flushSave() {
  if (this._saveTimer) {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
  }
  if (this._dirty) {
    this._dirty = false;
    this.save();
  }
}
```

### In `addNode()`:
- REMOVE the `this.save()` call at the end (line 351)
- ADD: `this._markDirty()`

### In `addEdge()`:
- REMOVE `this.save()` (line 370 is not there — addEdge doesn't save currently, but check)
- ADD: `this._markDirty()`

### In `pruneNodes()` (line 447-461):
- REMOVE `this.save()` at line 459
- ADD: `this._markDirty()`

### In `applyEbbinghausDecay()` (line 399-422):
- REMOVE `this.save()` at line 421
- ADD: `this._markDirty()`

### In `clearToDefault()` (line 316-330):
- KEEP `this.save()` — this is explicit reset, should flush immediately

### In `compaction()` (line 752-790):
- REPLACE `this.save()` at line 788 with `this._markDirty()` (compaction touches many nodes, debounced is fine)

### CLI (`cli.js`): After any batch of operations, add `sm._flushSave()` before `process.exit()` or at end of command handler. This guarantees durability for CLI use while keeping hot path fast.

### API (`api.js`): Already calls async handlers; debounced save is fine. No change needed.

### `save()` method itself: change to also cancel the timer and clear dirty flag:
```javascript
save() {
  // ... atomic write (Step 1.1) ...
  this._dirty = false;
  if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
}
```

---

## Step 1.4: Inverted Keyword Index for Sub-ms Search

### In constructor:
```javascript
this.invertedIndex = new Map();  // token (lowercase) → Set<nodeId>
```

### New helper:
```javascript
_tokenize(text) {
  if (!text) return [];
  return String(text).toLowerCase().split(/[^a-z0-9]+/i).filter(t => t.length >= 2);
}

_indexNode(node) {
  const tokens = new Set();
  this._tokenize(node.label).forEach(t => tokens.add(t));
  this._tokenize(node.type).forEach(t => tokens.add(t));
  if (node.properties) {
    this._tokenize(JSON.stringify(node.properties)).forEach(t => tokens.add(t));
  }
  tokens.forEach(token => {
    if (!this.invertedIndex.has(token)) this.invertedIndex.set(token, new Set());
    this.invertedIndex.get(token).add(node.id);
  });
}

_unindexNode(nodeId) {
  for (const [token, idSet] of this.invertedIndex) {
    idSet.delete(nodeId);
    if (idSet.size === 0) this.invertedIndex.delete(token);
  }
}

_rebuildInvertedIndex() {
  this.invertedIndex = new Map();
  this.nodes.forEach(n => this._indexNode(n));
}
```

### In `addNode()`: after `this.nodeMap.set(id, ...)`:
```javascript
this._indexNode(this.nodeMap.get(id));
```

### In `addNode()` update path (existingIndex !== -1): call `this._unindexNode(id)` before update, then `this._indexNode(updatedNode)` after.

### In `_rebuildIndexes()`: add `this._rebuildInvertedIndex()` call.

### In `pruneNodes()`: after marking archived, call `this._unindexNode(id)` for each pruned node (so they don't appear in search).

### In `search()` (line 838-987): Replace the keyword match loop (lines 862-884):

**Current:**
```javascript
this.nodes.forEach((node) => {
  if (searchScope !== "all" && node.scope !== searchScope) return;
  if (node.properties && (node.properties.compacted || node.properties.archived)) return;
  const labelLower = node.label.toLowerCase();
  ...
  let isMatch = labelLower.includes(cleanQuery) || ...;
  ...
  if (isMatch) { matchedNodeIds.push(node.id); this.reinforceNodeMemory(node.id); }
});
```

**New:**
```javascript
// Use inverted index for O(matches) instead of O(total nodes)
const queryTokens = cleanQuery.split(/[^a-z0-9]+/i).filter(t => t.length >= 2);
const candidateIds = new Set();

if (queryTokens.length > 0) {
  // Token-based lookup
  queryTokens.forEach(token => {
    const ids = this.invertedIndex.get(token);
    if (ids) ids.forEach(id => candidateIds.add(id));
  });
} else {
  // Full query string fallback
  const ids = this.invertedIndex.get(cleanQuery);
  if (ids) ids.forEach(id => candidateIds.add(id));
}

// Also try full-query match (for multi-word labels)
const fullIds = this.invertedIndex.get(cleanQuery);
if (fullIds) fullIds.forEach(id => candidateIds.add(id));

const matchedNodeIds = [];
candidateIds.forEach(id => {
  const node = this.nodeMap.get(id);
  if (!node) return;
  if (searchScope !== "all" && node.scope !== searchScope) return;
  if (node.properties && (node.properties.compacted || node.properties.archived)) return;
  matchedNodeIds.push(id);
  this.reinforceNodeMemory(id);
});
```

---

## Step 1.5: Configurable Decay Rate

### In constructor:
```javascript
this.decayRate = 0.000004;  // ~1 week half-life per second
```

### In `save()`: include `decayRate` in the serialized data object.

### In `load()`: restore `this.decayRate = data.decayRate || 0.000004;`

### In `applyEbbinghausDecay(decayRate)` (line 399):
Change signature default:
```javascript
applyEbbinghausDecay(decayRate) {
  const rate = decayRate ?? this.decayRate ?? 0.000004;
  // ... same math with `rate` instead of hardcoded 0.002
}
```

### Move decay OFF the hot path:
- In `addMemory()` (line 466): REMOVE `this.applyEbbinghausDecay()` call
- In `search()` (line 840): REMOVE `this.applyEbbinghausDecay()` call
- ADD a timer in constructor:
```javascript
if (this.isNode && !this._decayTimer) {
  this._decayTimer = setInterval(() => {
    this.applyEbbinghausDecay();
  }, 60000);  // every 60 seconds
  if (this._decayTimer.unref) this._decayTimer.unref();  // don't block process exit
}
```

### In `clearToDefault()`: reset `this.decayRate = 0.000004;`

### Add convenience:
```javascript
setDecayRate(halfLifeHours) {
  // halfLifeHours → decayRate per second
  // S(t) = S0 * e^(-rate * t), half-life when S = S0/2
  // rate = ln(2) / (halfLifeHours * 3600)
  this.decayRate = Math.log(2) / (halfLifeHours * 3600);
  this._markDirty();
}
```

---

## Step 1.6: Multi-hop BFS Traversal

### In `search()` (line 838): change signature to accept options:
```javascript
async search(query, searchScope = "all", options = {}) {
  const { maxDepth = 1 } = options;
  // ... existing keyword match logic (now using inverted index)
  
  // Step 2: Graph traversal — BFS up to maxDepth
  const traversedNodeIds = [...matchedNodeIds];
  const traversedEdgeIds = [];
  
  let frontier = [...matchedNodeIds];
  let depth = 0;
  
  while (depth < maxDepth && frontier.length > 0) {
    const nextFrontier = [];
    for (const nodeId of frontier) {
      for (const edge of this.edges) {
        if (!edge.active) continue;
        let neighborId = null;
        if (edge.source === nodeId) neighborId = edge.target;
        else if (edge.target === nodeId) neighborId = edge.source;
        if (neighborId && !traversedNodeIds.includes(neighborId)) {
          traversedNodeIds.push(neighborId);
          nextFrontier.push(neighborId);
          this.reinforceNodeMemory(neighborId);
        }
        if ((edge.source === nodeId || edge.target === nodeId) && !traversedEdgeIds.includes(edge.id)) {
          traversedEdgeIds.push(edge.id);
        }
      }
    }
    frontier = nextFrontier;
    depth++;
  }
  
  // ... rest of synthesis (LLM or rules-based)
}
```

### Optimization: For faster edge lookup, build an adjacency index in `_rebuildIndexes()`:
```javascript
this.adjacency = new Map();  // nodeId → [{ edge, neighborId }]
// build:
this.edges.forEach(e => {
  if (!e.active) return;
  if (!this.adjacency.has(e.source)) this.adjacency.set(e.source, []);
  if (!this.adjacency.has(e.target)) this.adjacency.set(e.target, []);
  this.adjacency.get(e.source).push({ edge: e, neighborId: e.target });
  this.adjacency.get(e.target).push({ edge: e, neighborId: e.source });
});
```

Then BFS uses `this.adjacency.get(nodeId)` instead of scanning all edges.

---

## Verification

After Phase 1, these must all pass:

```bash
# 1. Existing tests still pass
npm test

# 2. Doctor still works
npm run doctor

# 3. New performance test — sub-ms ops at 10K nodes
node -e "
import { AlekhDB } from './alekhdb.js';
const sm = new AlekhDB(true);
sm.clearToDefault();
sm.autoSave = false;
for (let i = 0; i < 10000; i++) sm.addNode('n'+i, 'Node'+i, 'test');
sm.autoSave = true;

// addNode should be sub-ms (no save in hot path)
const t0 = performance.now();
sm.addNode('test-fast', 'FastAdd', 'test');
const t1 = performance.now();
console.log('addNode:', (t1-t0).toFixed(4), 'ms');  // should be < 0.1ms

// getNode should be O(1)
const t2 = performance.now();
sm.getNode('n9999');
const t3 = performance.now();
console.log('getNode:', (t3-t2).toFixed(4), 'ms');  // < 0.001ms

// search should use inverted index
const t4 = performance.now();
await sm.search('Node9999');
const t5 = performance.now();
console.log('search:', (t5-t4).toFixed(4), 'ms');  // < 1ms

// multi-hop
sm.addNode('a','Alpha','s'); sm.addNode('b','Beta','s');
sm.addNode('c','Gamma','s'); sm.addNode('d','Delta','s');
sm.addEdge('e1','a','b','calls',1,true); sm.addEdge('e2','b','c','calls',1,true); sm.addEdge('e3','c','d','calls',1,true);
const r = await sm.search('Alpha', 'all', { maxDepth: 3 });
console.log('3-hop found Delta?', r.traversedNodeIds.includes('d'));  // true

// crash recovery
sm.save();
// corrupt the file manually and reload — should load .bak
"

# 4. Crash recovery test
node -e "
import * as fs from 'fs';
import { AlekhDB } from './alekhdb.js';
const sm = new AlekhDB(true);
sm.clearToDefault();
sm.addNode('crash-test', 'CrashTest', 'test');
sm._flushSave();
// Now corrupt
fs.writeFileSync('./alekhdb_db.json', '{corrupted');
const sm2 = new AlekhDB(true);  // should load .bak
console.log('Recovered nodes:', sm2.nodes.length);  // should be > 0
console.log('Has crash-test?', sm2.nodeMap.has('crash-test'));  // true
"
```

## Files Modified

- `alekhdb.js` — all changes in this phase
- `cli.js` — add `sm._flushSave()` at end of each command handler (ensure durability for CLI)
- `test_runner.js` — optionally update to test new features