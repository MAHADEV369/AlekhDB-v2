# AlekhDB v2 — Complete Design Plan

## Vision

A **local-first, sub-millisecond memory library** for AI agents and AI IDEs. Combines concept-graph memory (with Ebbinghaus forgetting) + code understanding (embeddings + tree-sitter). Fully offline. Zero setup. Plug it into any IDE via MCP or any LLM workflow via REST/CLI.

**Positioning**: Supermemory and Mem0 are cloud memory *platforms*. AlekhDB v2 is a local memory *library* — no servers, no API keys required, 5-second setup. Matches their feature parity on what matters, beats them on speed by 100-1000x, and adds 6 features neither has.

---

## Research: What Mem0 & Supermemory Have That We Need

### From Mem0 (must add for parity)

| Feature | Action |
|---------|--------|
| LLM-based fact extraction (single-pass additive) | Wire Ollama into existing LlmClient |
| Context lookup before add (dedup) | Search existing before storing |
| Multi-signal retrieval fusion (vector + keyword + entity + temporal) | Phase 4 |
| Memory types: conversation / session / user / org | Phase 3 (scoping hierarchy) |
| Filter expressions (AND/OR) | Phase 3 |
| Memory decay at search time + forgetAfter (TTL) | Phase 2 (combines with Ebbinghaus) |
| Batch operations | Phase 3 |
| Memory export/import | Phase 3 |
| Memory history per record | Phase 5 |
| Entity linking (graph memory) | Phase 4 |
| Reranking (sentence-transformers, cross-encoder) | Phase 4 |
| Contextual add (consider surrounding conversation) | Phase 2 |
| Multimodal (images, PDFs) | Already have PDF; add image via Ollama |
| 9 MCP tools | Phase 7 |

### From Supermemory (must add for parity)

| Feature | Action |
|---------|--------|
| Versioned memory DAG (parentMemoryId, rootMemoryId, version, isLatest) | Phase 2 |
| Three relations: updates / extends / derives | Phase 2 |
| Inferred memories with review (approve/decline/undo) | Phase 5 |
| Memory types: facts / preferences / episodes / inference | Phase 2 |
| Auto forgetting (time + contradiction + noise filtering) | Already have decay + TMS |
| User profiles (static + dynamic) + configurable buckets | Phase 5 (extend existing profile()) |
| Agentic mass-forget | Phase 5 |
| Container tags merge | Phase 3 (precursor to git-merge) |
| Document processing pipeline | Phase 6 (file watcher) |
| Threshold + filter expressions | Phase 3/4 |
| MemoryBench evaluation | Phase 7 (run their open-source bench) |

### Things We Keep That They Don't Have

| Our Feature | Differentiator |
|-------------|---------------|
| Ebbinghaus biological forgetting curves | TTL/search-decay, not exponential |
| Doyle-style TMS bi-temporal edges | Only Zep has this, requires Neo4j |
| Episodic traces with replay | Only Zep has episodes |
| Git-aware memory branches | NO ONE has this |
| PII redaction before storage | NO ONE has this |
| Tree-sitter multi-language AST | Only Cursor has it (closed) |
| File watcher auto-indexing (local-first) | Only IDE-embedded tools |
| Local embeddings offline | They require API keys |
| Zero-dependency core | They require Postgres |
| Sub-ms core operations | They're 100ms-2000ms |

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                  INTEGRATION LAYER                       │
│  MCP Server (12+ tools) │ REST API (25+) │ CLI (20+)    │
├────────────────────────────────────────────────────────┤
│                IDE DIFFERENTIATORS (elective)            │
│  embed ── git ── privacy ── ast ── watcher ── lsp(opt)   │
├────────────────────────────────────────────────────────┤
│               RETRIEVAL ENGINE (Phase 4)                 │
│  Multi-signal: keyword(0.25) + vector(0.40) +            │
│  entity(0.20) + temporal(0.10) + cognitive(0.05)         │
│  + reranking + threshold + filter expressions            │
├────────────────────────────────────────────────────────┤
│              MEMORY MODEL (Phase 2/5)                   │
│  Versioned DAG │ 3 Relations │ Memory types │           │
│  Inferred + review │ Profiles static/dynamic              │
│  Ebbinghaus decay + forgetAfter + search-time boost      │
├────────────────────────────────────────────────────────┤
│            CORE ENGINE (alekhdb.js, Phase 1)            │
│  Graph │ Map indexes │ Inverted index │ TMS │ Traces    │
│  Debounced save │ Atomic writes │ Backup recovery        │
├────────────────────────────────────────────────────────┤
│           STORAGE + MULTI-TENANCY (Phase 3)              │
│  JSON file (atomic) + .bak │ Container tags │ Filters   │
│  Batch ops │ Events │ Export/Import │ History per mem   │
└────────────────────────────────────────────────────────┘
                  Ollama extraction (elective)
```

---

## Data Model

```typescript
interface Node {
  id: string
  label: string
  type: string
  scope: string                           // container tag
  memoryType: 'fact'|'preference'|'episode'|'inference'|'note'|'document'
  version: number
  parentMemoryId: string | null
  rootMemoryId: string | null
  isLatest: boolean
  isForgotten: boolean
  forgetAfter: string | null
  forgetReason: string | null
  isInference: boolean
  reviewStatus: 'unreviewed'|'approved'|'declined'|null
  properties: {
    cognitiveStrength: number
    lastAccessedAt: string
    embedding?: Float32Array
    embeddingModel?: string
    compacted?: boolean
    archived?: boolean
    sourceTrace?: string
    sourceAgent?: string
    [key: string]: any
  }
  createdAt: string
  updatedAt: string
  metadata: Record<string, any>
}

interface Edge {
  id: string
  source: string
  target: string
  label: string          // 'updates'|'extends'|'derives'|custom
  weight: number
  active: boolean
  validAt: string | null
  invalidAt: string | null
  properties: Record<string, any>
  createdAt: string
}
```

---

## File Structure

```
alekhdb.js            Core (edit existing, ~1268 -> ~2500 lines)
alekhdb-extract.js    Elective: Ollama LLM extraction
alekhdb-embed.js      Elective: local embeddings (transformers.js)
alekhdb-context.js    Elective: token-aware context packing
alekhdb-git.js        Elective: git-aware branch memory
alekhdb-privacy.js    Elective: PII redaction
alekhdb-ast.js        Elective: tree-sitter multi-lang AST
alekhdb-watcher.js    Elective: file watcher (chokidar)
alekhdb-lsp.js        Elective: LSP hooks (VS Code)
mcp_server.js         Upgraded: 12+ tools
api.js                Upgraded: 25+ endpoints
cli.js                Upgraded: 20+ commands
sampleData.js         Preserved + extended
doctor.js             Upgraded: diagnostics
test_runner.js        Upgraded: new feature tests
```

---

## Phase 1 — Core Engine Robustness (Week 1, Days 1-2)

Sub-ms foundation. No new deps. No new features — just fixes.

1. **Atomic writes + backup**: write `.tmp` → `rename`; `.bak` on corruption
2. **Map indexes**: `nodeMap`, `edgeMap` alongside arrays for O(1)
3. **Debounced save**: remove `save()` from hot path; queue 500ms
4. **Inverted keyword index**: `Map<token, Set<nodeId>>` for O(matches) search
5. **Configurable decay**: hours-scale default (168h ~1wk half-life)
6. **Multi-hop BFS**: `search(query, { maxDepth: N })` defaults 1

## Phase 2 — Memory Model + Extraction (Week 1, Days 3-5)

Match Mem0/Supermemory extraction quality.

- Ollama extraction with Mem0-style prompts (additive, single call)
- Context lookup before add (dedup)
- Versioned DAG (parentMemoryId, isLatest)
- 3 relations: updates / extends / derives
- Memory types: fact/preference/episode/inference/note
- forgetAfter TTL expiration
- Contextual add (conversation context)

## Phase 3 — Storage & Multi-Tenancy (Week 2, Days 1-2)

- Container tags / scopes (`user:alice/project:repo/branch:main`)
- Filter expressions (AND/OR, string_contains, numeric, array_contains, negate)
- Batch operations (batchAdd, batchDelete, batchUpdate)
- Export / import (JSON backup)
- Memory history per record (`getHistory(memoryId)`)
- Event system (`db.on('memory:added', cb)`)
- Container tag merge

## Phase 4 — Retrieval Engine (Week 2, Days 3-5)

- Multi-signal fusion: keyword(0.25) + vector(0.40) + entity(0.20) + temporal(0.10) + cognitive(0.05)
- Local embeddings module (transformers.js + MiniLM-L6-v2, ~25MB)
- Reranking (cross-encoder via transformers.js, off by default)
- Token-aware context packing (`getContext({query, maxTokens})`)
- Threshold + filter integration

## Phase 5 — Profiles & Memory Review (Week 3, Days 1-3)

- Static + dynamic profile buckets
- Configurable buckets per project
- Inferred memory review queue (list/approve/decline/undo)
- Agentic mass-forget (search + soft-delete matches)
- Episodic traces linked to memories (provenance)

## Phase 6 — IDE Differentiators (Week 3, Days 4-5)

- `alekhdb-embed.js`: local embeddings, offline
- `alekhdb-git.js`: branch scoping, switch, merge
- `alekhdb-privacy.js`: regex PII redaction before storage
- `alekhdb-ast.js`: tree-sitter 100+ languages, import graph
- `alekhdb-watcher.js`: chokidar auto-indexing
- `alekhdb-lsp.js`: VS Code LSP hooks (onDidSave, onDiagnostic)

## Phase 7 — Integration (Week 4)

- MCP server: 12+ tools (add, search, search_hybrid, get_context, profile, trace_*, analyze, review_inferred, forget_match, list_projects, list_entities, git_status)
- REST API: 25+ endpoints
- CLI: 20+ commands
- Benchmark validation (LongMemEval, LoCoMo)

---

## Performance Targets

| Operation | Mem0 | Supermemory | AlekhDB v2 |
|-----------|------|-------------|------------|
| add (no LLM) | ~1s | ~400-2000ms | < 0.5ms |
| add (Ollama) | ~1s | ~400-2000ms | ~300ms |
| search hybrid (10K) | ~880ms | ~92-400ms | < 6ms |
| get_context (packed) | ~880ms | ~200ms | < 8ms |
| profile() | ~50ms | ~50ms | < 0.1ms |
| embed (per text) | ~100ms | ~100ms | ~20ms |
| getNode(id) | N/A | N/A | < 0.001ms |
| save (debounced) | N/A | N/A | < 5ms async |

---

## Competitive Matrix (After All Phases)

| Capability | Mem0 | Supermemory | AlekhDB v2 |
|------------|------|-------------|------------|
| LLM extraction | cloud | cloud | local (Ollama) + rules |
| Versioned DAG | no | yes | yes |
| 3 relations | no | yes | yes |
| Memory types | partial | 3-tier | 5-tier |
| Ebbinghaus | no | no | YES (unique) |
| Bi-temporal TMS | no | DAG only | YES (unique) |
| forgetAfter TTL | yes | yes | yes |
| Inferred + review | no | yes | yes |
| Agentic mass-forget | no | yes | yes |
| Episodic traces | no | episodes | yes |
| Multi-tenancy | yes | yes | yes |
| Filter expressions | V2 | yes | yes |
| Batch ops | yes | yes | yes |
| Export/import | yes | partial | yes |
| Multi-signal fusion | 4 signals | 2-3 | 5 signals |
| Reranking | multiple | optional | yes |
| Context packing | no | no | YES (unique) |
| User profiles | no | yes | yes |
| Configurable buckets | no | yes | yes |
| Git-aware branches | no | no | YES (unique) |
| PII redaction | no | no | YES (unique) |
| Tree-sitter multi-lang | no | no | YES (unique) |
| File watcher | no | connectors | YES (unique) |
| POSIX mount | no | SMFS (cloud) | yes |
| Local embeddings | API only | CF only | YES (unique) |
| Zero-dep core | no | no Postgres | YES (unique) |
| Sub-ms core | no | no | YES (unique) |
| Connectors | no | yes | SKIP |
| Browser ext | no | yes | SKIP |
| Production UI | yes | yes | CLI/MCP/API |
| Stars | 30K+ | 28K+ | 0 (starting) |