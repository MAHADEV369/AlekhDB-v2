# Phase 3 — Storage & Multi-Tenancy

> **Edit**: `alekhdb.js` (scoping, filters, batch, export, events, history)
> **New deps**: ZERO
> **Goal**: Match Mem0/Supermemory multi-tenancy + filtering + batch ops
> **Depends on**: Phase 1 (Map indexes), Phase 2 (memory model)

---

## Context

**Current scoping**: nodes have a `scope` string field (e.g., `"work"`, `"personal"`, `"legal"`). `search()` filters by exact match. No compound scopes, no filter expressions, no batch ops, no export/import, no events.

**What Mem0/Supermemory have:**
- Mem0: `user_id` / `agent_id` / `run_id` hierarchy; V2 compound AND/OR filters on metadata, entity, time
- Supermemory: `containerTag` scoping; `spaces` with visibility/roles; filter expressions with `string_contains`, `numeric`, `array_contains`, `negate`, AND/OR

---

## Step 3.1: Compound Container Tags (Scopes)

### Current: `scope: "work"` — flat string.
### New: hierarchical path string — `user:alice/project:payment-repo/branch:main`

### New method:
```javascript
setScope(scopePath) {
  // scopePath: 'user:alice/project:payment-repo/branch:main'
  this.currentScope = scopePath;
}

getScope() {
  return this.currentScope || 'default';
}
```

### In `addMemory()`: if `scope` not explicitly passed, use `this.currentScope`:
```javascript
async addMemory(text, scope = this.currentScope || "work", options = {}) {
  // ... existing ...
}
```

### In `search()`: support scope prefix matching:
```javascript
// If scope = 'user:alice', match all nodes whose scope starts with 'user:alice'
// If scope = 'user:alice/project:payment', match that prefix
const scopeMatches = (nodeScope, searchScope) => {
  if (searchScope === "all") return true;
  if (!nodeScope) return false;
  if (nodeScope === searchScope) return true;
  return nodeScope.startsWith(searchScope + '/');  // prefix match
};
// Replace existing `node.scope !== searchScope` checks with this
```

### Apply scope prefix matching in:
- `search()` candidate filtering
- `addMemory()` context lookup (Phase 2.6)

---

## Step 3.2: Filter Expressions (Mem0 V2-style)

### New method on AlekhDB:

```javascript
_matchFilters(node, filters) {
  if (!filters) return true;
  
  // AND: all must match; OR: any must match
  const matchGroup = (group, logic = 'AND') => {
    if (Array.isArray(group)) {
      // Array = AND group (Mem0 V2 style: { AND: [...] })
      return logic === 'OR'
        ? group.some(item => matchSingle(item))
        : group.every(item => matchSingle(item));
    }
    return matchSingle(group);
  };
  
  if (filters.AND) {
    return filters.AND.every(item => this._matchFilters(node, item));
  }
  if (filters.OR) {
    return filters.OR.some(item => this._matchFilters(node, item));
  }
  
  return matchSingle(filters);
}

function matchSingle(filter) {
  // filter: { key: 'type', value: 'meeting' }
  // filter: { filterType: 'string_contains', key: 'title', value: 'react' }
  // filter: { filterType: 'numeric', key: 'priority', value: 5, numericOperator: '>=' }
  // filter: { filterType: 'array_contains', key: 'tags', value: 'important' }
  // filter: { key: 'status', value: 'draft', negate: true }
  
  const { key, value, filterType = 'equality', numericOperator = '=', negate = false } = filter;
  const nodeVal = node.metadata?.[key] ?? node.properties?.[key] ?? node[key];
  
  let result;
  switch (filterType) {
    case 'equality':
      result = nodeVal === value;
      break;
    case 'string_contains':
      result = String(nodeVal || '').toLowerCase().includes(String(value).toLowerCase());
      break;
    case 'numeric':
      const num = parseFloat(nodeVal);
      switch (numericOperator) {
        case '>': result = num > value; break;
        case '>=': result = num >= value; break;
        case '<': result = num < value; break;
        case '<=': result = num <= value; break;
        case '!=': result = num !== value; break;
        default: result = num === value;
      }
      break;
    case 'array_contains':
      result = Array.isArray(nodeVal) && nodeVal.includes(value);
      break;
    default:
      result = nodeVal === value;
  }
  
  return negate ? !result : result;
}
```

### In `search()`: accept `filters` in options:
```javascript
async search(query, searchScope = "all", options = {}) {
  const { maxDepth = 1, filters = null } = options;
  
  // ... keyword match via inverted index ...
  
  candidateIds.forEach(id => {
    const node = this.nodeMap.get(id);
    if (!node) return;
    if (!scopeMatches(node.scope, searchScope)) return;
    if (node.properties?.compacted || node.properties?.archived) return;
    if (node.isForgotten) return;
    if (node.forgetAfter && new Date(node.forgetAfter) < new Date()) return;
    if (filters && !this._matchFilters(node, filters)) return;  // NEW
    matchedNodeIds.push(id);
    this.reinforceNodeMemory(id);
  });
  
  // ... rest ...
}
```

### Usage:
```javascript
await db.search('meeting notes', 'user:alice', {
  filters: {
    AND: [
      { key: 'type', value: 'meeting' },
      { key: 'year', value: 2024, filterType: 'numeric', numericOperator: '>=' },
      { filterType: 'array_contains', key: 'tags', value: 'important' },
      { key: 'status', value: 'draft', negate: true }
    ]
  }
});
```

---

## Step 3.3: Batch Operations

### New methods:

```javascript
async batchAdd(items) {
  // items: [{ text, scope, options }, ...]
  const results = [];
  const wasAutoSave = this.autoSave;
  this.autoSave = false;  // disable per-op save
  for (const item of items) {
    const result = await this.addMemory(item.text, item.scope, item.options);
    results.push(result);
  }
  this.autoSave = wasAutoSave;
  this.save();  // single save after batch
  return results;
}

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
  return count;
}

batchUpdate(updates) {
  // updates: [{ id, text, properties }, ...]
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
```

---

## Step 3.4: Export & Import

### New methods:

```javascript
export(filter = {}) {
  // filter: { scope, memoryType, includeTraces, includeAuditLog }
  const { scope = null, memoryType = null, includeTraces = false, includeAuditLog = false } = filter;
  
  let exportedNodes = this.nodes;
  let exportedEdges = this.edges;
  
  if (scope) {
    exportedNodes = exportedNodes.filter(n => scopeMatches(n.scope, scope));
    const nodeIds = new Set(exportedNodes.map(n => n.id));
    exportedEdges = exportedEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }
  
  if (memoryType) {
    exportedNodes = exportedNodes.filter(n => n.memoryType === memoryType);
  }
  
  const data = {
    version: 2,  // v2 format
    exportedAt: new Date().toISOString(),
    nodes: exportedNodes,
    edges: exportedEdges,
    traces: includeTraces ? this.traces : [],
    eventFrames: includeTraces ? this.eventFrames : [],
    auditLog: includeAuditLog ? this.auditLog : [],
  };
  
  return JSON.stringify(data, null, 2);
}

import(jsonStr, options = {}) {
  const { merge = false, scopeOverride = null } = options;
  const data = JSON.parse(jsonStr);
  
  if (!merge) {
    this.clearToDefault();
  }
  
  // Import nodes
  (data.nodes || []).forEach(n => {
    if (scopeOverride) n.scope = scopeOverride;
    this.nodes.push(n);
    this.nodeMap.set(n.id, n);
    this._indexNode(n);
  });
  
  // Import edges
  (data.edges || []).forEach(e => {
    this.edges.push(e);
    this.edgeMap.set(e.id, e);
  });
  
  if (data.traces) this.traces.push(...data.traces);
  if (data.eventFrames) this.eventFrames.push(...data.eventFrames);
  if (data.auditLog) this.auditLog.push(...data.auditLog);
  
  this.logAudit('IMPORT', `Imported ${data.nodes?.length || 0} nodes, ${data.edges?.length || 0} edges`);
  this._markDirty();
  return { nodes: data.nodes?.length || 0, edges: data.edges?.length || 0 };
}
```

### Usage:
```javascript
// Export user alice's memories
const data = db.export({ scope: 'user:alice' });
fs.writeFileSync('alice-backup.json', data);

// Import into a new DB (or merge)
const backup = fs.readFileSync('alice-backup.json', 'utf8');
db.import(backup, { merge: true });
```

---

## Step 3.5: Memory History Per Record

### New method:

```javascript
getHistory(memoryId) {
  // Walk the version chain: follow parentMemoryId backwards
  const history = [];
  let current = this.nodeMap.get(memoryId);
  
  while (current) {
    history.push({
      id: current.id,
      version: current.version,
      label: current.label,
      isLatest: current.isLatest,
      updatedAt: current.updatedAt || current.createdAt,
      changedBy: current.properties?.sourceAgent || 'unknown',
      forgetReason: current.forgetReason,
    });
    
    if (current.parentMemoryId) {
      current = this.nodeMap.get(current.parentMemoryId);
    } else {
      break;
    }
  }
  
  // Also find all versions that point to this as root
  const descendants = this.nodes.filter(n => n.rootMemoryId === memoryId && n.id !== memoryId);
  descendants.forEach(d => {
    if (!history.find(h => h.id === d.id)) {
      history.push({
        id: d.id, version: d.version, label: d.label,
        isLatest: d.isLatest, updatedAt: d.updatedAt,
      });
    }
  });
  
  return history.sort((a, b) => (b.version || 0) - (a.version || 0));
}
```

### Usage:
```javascript
const history = db.getHistory('mem_abc');
// [{ version: 3, label: 'User lives in SF', isLatest: true },
//  { version: 2, label: 'User moved to SF', isLatest: false },
//  { version: 1, label: 'User lives in NYC', isLatest: false }]
```

---

## Step 3.6: Event System (in-process)

### In constructor:
```javascript
this._eventListeners = new Map();  // event name → Set<callback>
```

### New methods:
```javascript
on(eventName, callback) {
  if (!this._eventListeners.has(eventName)) this._eventListeners.set(eventName, new Set());
  this._eventListeners.get(eventName).add(callback);
  return () => this.off(eventName, callback);  // return unsubscribe fn
}

off(eventName, callback) {
  const set = this._eventListeners.get(eventName);
  if (set) set.delete(callback);
}

emit(eventName, payload) {
  const set = this._eventListeners.get(eventName);
  if (set) set.forEach(cb => { try { cb(payload); } catch(e) { console.error('Event listener error:', e); } });
}
```

### Emit events in key methods:

```javascript
// In addNode():
this.emit('memory:added', { id, label, type, memoryType, scope });

// In createMemoryVersion() (Phase 2):
this.emit('memory:updated', { oldId: oldNodeId, newId, version });

// In batchDelete():
this.emit('memory:forgotten', { ids: deletedIds });

// In addRelation():
this.emit('relation:added', { fromId, toId, relationType });

// In applyEbbinghausDecay() when a node archives:
this.emit('memory:archived', { id: n.id, reason: 'ebbinghaus_decay' });

// In compaction():
this.emit('compaction:complete', { summaryId });

// In load() on backup recovery:
this.emit('db:recovered', { fromBackup: true });
```

### Usage:
```javascript
db.on('memory:added', (mem) => {
  console.log('New memory:', mem.label);
  // IDE extension: refresh context panel
});
db.on('memory:updated', (upd) => {
  console.log('Memory updated to v' + upd.version);
});
```

---

## Step 3.7: Container Tag Merge

### New method:

```javascript
mergeScopes(sourceScope, targetScope) {
  // Copy all nodes from source scope to target scope (decays duplicates)
  const sourceNodes = this.nodes.filter(n => scopeMatches(n.scope, sourceScope));
  let copied = 0;
  let skipped = 0;
  
  sourceNodes.forEach(srcNode => {
    // Check if equivalent already exists in target
    const existing = this.nodes.find(n =>
      scopeMatches(n.scope, targetScope) &&
      n.label === srcNode.label &&
      n.memoryType === srcNode.memoryType &&
      n.isLatest !== false
    );
    
    if (existing) {
      // Already exists — skip or create 'extends' relation
      skipped++;
    } else {
      // Copy to target scope
      const newId = this.generateId('mem');
      this.addNode(newId, srcNode.label, srcNode.type, { ...srcNode.properties }, targetScope, {
        memoryType: srcNode.memoryType,
        forgetAfter: srcNode.forgetAfter,
      });
      // Create 'derives' link
      this.addRelation(newId, srcNode.id, 'derives');
      copied++;
    }
  });
  
  this.logAudit('SCOPE_MERGE', `Merged ${sourceScope} → ${targetScope}: ${copied} copied, ${skipped} already existed`);
  this.emit('scope:merged', { sourceScope, targetScope, copied, skipped });
  this._markDirty();
  return { copied, skipped };
}
```

---

## Verification

```bash
# 1. Scope prefix matching
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('a', 'Fact A', 'concept', {}, 'user:alice/project:auth/branch:main');
db.addNode('b', 'Fact B', 'concept', {}, 'user:alice/project:auth/branch:feature');
db.addNode('c', 'Fact C', 'concept', {}, 'user:bob');
// Search user:alice should match a and b
const r = await db.search('Fact', 'user:alice');
console.log('Alice scope:', r.matchedNodeIds.length === 2);  // true
// Search specific branch should match a only
const r2 = await db.search('Fact', 'user:alice/project:auth/branch:main');
console.log('Main branch:', r2.matchedNodeIds.length === 1);  // true
"

# 2. Filter expressions
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('m1', 'Meeting notes', 'note', { priority: 5, tags: ['important', 'work'] }, 'work', { memoryType: 'note' });
db.getNode('m1').metadata = { type: 'meeting', year: 2024, tags: ['important'] };
const r = await db.search('meeting', 'all', { filters: { AND: [{ key: 'year', value: 2024, filterType: 'numeric', numericOperator: '>=' }, { filterType: 'array_contains', key: 'tags', value: 'important' }] } });
console.log('Filtered:', r.matchedNodeIds.length === 1);  // true
"

# 3. Export/import
node -e "
import { AlekhDB } from './alekhdb.js';
import * as fs from 'fs';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('exp1', 'Exportable fact', 'concept', {}, 'user:alice');
db.addNode('exp2', 'Other user fact', 'concept', {}, 'user:bob');
const data = db.export({ scope: 'user:alice' });
const db2 = new AlekhDB(true);
db2.clearToDefault();
db2.import(data);
console.log('Imported nodes:', db2.nodes.length);  // 1 (only alice)
"

# 4. Events
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
let gotEvent = false;
db.on('memory:added', (mem) => { gotEvent = true; console.log('Event:', mem.label); });
db.addNode('test', 'Test Event', 'concept');
console.log('Event fired:', gotEvent);  // true
"

# 5. History
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
db.addNode('v1', 'Lives in NYC', 'concept', {}, 'work', { memoryType: 'fact' });
db.createMemoryVersion('v1', 'Lives in SF');
const h = db.getHistory('v1');
console.log('History length:', h.length);  // 2
console.log('Latest is v2?', h[0].isLatest);  // true
"
```

## Files Modified

- `alekhdb.js` — all new methods + integration into `addNode()`, `search()`, `addMemory()`
- No new files