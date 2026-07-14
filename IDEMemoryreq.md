# AI IDE Memory Requirements — AlekhDB Gap Analysis & Production Plan

## Part 1: Verified Weaknesses (tested against actual code)

| # | Weakness | Verified | Impact |
|---|----------|----------|--------|
| 1 | **No vector search** | ✅ "charging customers" returns 0 matches against "payment" nodes | Pure `String.includes()` keyword matching. No semantic retrieval. |
| 2 | **JSON full rewrite every op** | ✅ Empty=382B → 1 node=799B → 2 nodes=1214B | No WAL, no atomic writes. Crash = silent wipe (`this.nodes = []` in catch). |
| 3 | **O(n) save bottleneck** | ✅ 9K adds with autoSave timed out at 30s | Each `addNode` rewrites entire JSON. Search itself is 14ms at 10K — save is the killer. |
| 4 | **Regex AST, JS only** | ✅ Python parsed 0 nodes. JSX/decorators missed | `classRegex`/`methodRegex` break on real code. Zero multi-language support. |
| 5 | **1-hop traversal only** | ✅ A→B→C→D chain: found B (1-hop), missed C (2-hop) and D (3-hop) | No multi-hop reasoning. Can't trace call chains. |
| 6 | **Full graph dumped to LLM** | ✅ 1000 nodes = 206KB prompt | `JSON.stringify(this.nodes)` on every ingestion. Exceeds LLM context window at scale. |
| 7 | **No import/export graph** | ✅ `import express` produced 0 import nodes | AST extracts classes+methods only. No dependency graph. |
| 8 | **No crash recovery** | ✅ Corrupted JSON → `this.nodes = []` silently | No backup, no WAL, no atomic write. Data loss is silent. |
| 9 | **Ebbinghaus decay = 6 min half-life** | ✅ `decayRate=0.002` with seconds | Demo-tuned. Real IDE sessions last hours/days. |
| 10 | **No IDE integration** | ✅ MCP has 3 tools, no file watcher | No `didChange`/`didSave`, no LSP, no cursor awareness. |

---

## Part 2: Production Research — What Real Systems Do

### Mem0 (mem0.ai) — Key Takeaways

| Feature | How Mem0 Does It | Our Application |
|---------|-----------------|-----------------|
| **Additive storage** | Single-pass ADD-only. No UPDATE/DELETE during add. App handles reconciliation. | Simpler than current TMS. Add facts, don't mutate on ingestion. |
| **Hybrid retrieval** | Fuses 4 signals: semantic (vector) + keyword (BM25) + entity (graph) + temporal (recency) into one `score` | Our search should fuse vector + keyword + graph, not pick one. |
| **Memory decay at search time** | Boosts recent, dampens stale at query — never deletes | Aligns with AlekhDB's Ebbinghaus model. Keep decay at search, not at write. |
| **Multi-tenancy** | `user_id` / `agent_id` / `run_id` hierarchy | AlekhDB has `scope` — extend to project/workspace hierarchy. |
| **PII handling** | Policy-driven, no built-in redaction (a gap) | Our privacy layer fills this gap — redact BEFORE storage. |
| **9 MCP tools** | `add`, `search`, `get`, `update`, `delete`, `delete_all`, `delete_entities`, `list_entities` | Expand from 3 tools to 9+. |
| **Sub-second p50** | ~0.88–1.09s with cloud LLM. Local would be faster. | Our local-first approach should beat this easily. |

### Zep (getzep.com) — Key Takeaways

| Feature | How Zep Does It | Our Application |
|---------|-----------------|-----------------|
| **Bi-temporal edges** | `valid_at`, `invalid_at`, `created_at`, `expired_at` on every fact | Upgrade AlekhDB's "decay to 0.15" to real temporal invalidation. |
| **Fact invalidation, not deletion** | Old edge gets `invalid_at` timestamp. Both versions queryable. | Preserve history. Don't destroy contradictions — timestamp them. |
| **Sub-200ms retrieval** | Near-constant time regardless of graph size | Target: keep sub-50ms locally with indexes. |
| **Hybrid retrieval** | Vector + BM25 + BFS, fused via RRF/MMR/cross-encoder | Same multi-signal fusion as Mem0. Confirms our approach. |
| **Token-budget context packing** | `auto` search: runs all scopes, reranks, packs to `max_characters` budget, returns prompt-ready string | Our token-aware context packing — exactly this. |
| **Episode provenance** | Every derived fact links back to raw source data | AlekhDB's traces already do this. Strengthen the link. |
| **Governance in substrate** | RBAC, ABAC, audit, BYOK, SOC2, HIPAA | Our privacy layer is step 1 of this. |

### Local Embeddings (@huggingface/transformers)

| Aspect | Value |
|--------|-------|
| **Package** | `@huggingface/transformers` (formerly `@xenova/transformers`) |
| **Model** | `Xenova/all-MiniLM-L6-v2` — 384-dim, ~25MB (q8), ~40MB RAM |
| **Code model** | `jinaai/jina-embeddings-v2-base-code` — 768-dim, ~135MB (upgrade path) |
| **Latency** | ~15-40ms per embedding on CPU (WASM, q8) |
| **Runtime** | ONNX Runtime Web (WASM) — no native deps in browser, optional `onnxruntime-node` in Node |
| **Search at scale** | Brute-force cosine: fine for <10K. sqlite-vec for 10K-100K. hnswlib for 1M+. |
| **API** | `pipeline('feature-extraction', model, {dtype:'q8'})` → `embed(text, {pooling:'mean', normalize:true})` |

### Vector Storage Decision

| Scale | Approach | Why |
|-------|----------|-----|
| **< 10K vectors** | `Float32Array` + brute-force cosine (~50 lines) | Zero deps, sub-10ms, trivially serializable |
| **10K - 100K** | `sqlite-vec` extension + `better-sqlite3` | Single DB file, ACID, SQL joins with graph data |
| **> 100K** | `hnswlib-node` (ANN) | Millisecond queries at scale, but manual persistence |

**Start with brute-force cosine. Upgrade path is a single bulk INSERT into sqlite-vec.**

---

## Part 3: Revised Architecture — AlekhDB v2

### Design Principles

1. **Build on top of existing code** — edit `alekhdb.js`, don't rewrite
2. **Keep core sub-millisecond** — no new deps in the hot path
3. **Elective features** — heavy modules are `import`-optional, zero cost if unused
4. **No GraphRAG overhead** — vector search is opt-in, not default path

### File Structure

```
alekhdb.js              ← core (optimized: atomic writes, Map indexes, debounced save, bi-temporal)
alekhdb-embed.js        ← elective: local embeddings + vector search (transformers.js)
alekhdb-context.js      ← elective: token-aware context packing
alekhdb-git.js          ← elective: git-aware branch scoping
alekhdb-privacy.js      ← elective: PII/secret redaction before storage
alekhdb-ast.js          ← elective: tree-sitter multi-language AST (100+ langs)
alekhdb-watcher.js      ← elective: file system watcher for auto-indexing
mcp_server.js           ← improved: 9+ tools, streaming
api.js                  ← improved: expose new features
cli.js                  ← improved: expose new features
```

---

### Phase 1: Core Fixes (zero speed loss, no new deps)

| Fix | Change | Impact |
|-----|--------|--------|
| **Atomic writes** | Write to `*.tmp` → `fs.renameSync()` | Crash-safe. Zero overhead. |
| **Map indexes** | `this.nodeMap = new Map()`, `this.edgeMap = new Map()` alongside arrays | O(1) lookups. ~5 lines added. |
| **Debounced save** | Queue writes, flush every 500ms or on explicit `save()` | From 1-write-per-op to 1-write-per-batch. Fixes save timeout. |
| **Backup on corruption** | If parse fails, load `.bak` file instead of `[]` | Crash recovery without data loss. |
| **Configurable decay** | `decayRate` in hours (default: 168h = 1 week half-life) | Real-world forgetting, not demo. |
| **Multi-hop traversal** | `search(query, {maxDepth: N})` — defaults to 1 for speed | Optional depth. Solves 1-hop limit. |
| **Bi-temporal edges** | Add `valid_at`, `invalid_at` to edges (borrowed from Zep) | Fact invalidation, not destruction. Preserves history. |
| **Scoped LLM prompts** | Only send relevant subgraph to LLM (matched nodes + neighbors) | From 206KB → ~2KB per ingestion. Fixes token explosion. |

### Phase 2: Elective Features (opt-in, separate files)

#### 2a. Local Embeddings (`alekhdb-embed.js`)
```
db.enableEmbeddings({ model: 'Xenova/all-MiniLM-L6-v2' })
  → embeds all nodes on add()
  → adds db.searchVector(query, k) alongside existing db.search()
  → hybrid: searchVector() + keyword search fused via score
  → brute-force cosine for <10K, sqlite-vec upgrade path
  → ~25MB model, ~40MB RAM, ~20ms/embedding
  → works offline, no API key
```

#### 2b. Token-Aware Context Packing (`alekhdb-context.js`)
```
db.getContext(query, { maxTokens: 8000 })
  → runs search (keyword + optional vector)
  → reranks results by relevance × recency × cognitiveStrength
  → packs top results into a token budget
  → returns prompt-ready string: "## Context\n\n1. [node] ...\n2. ..."
  → like Zep's `auto` search — what AI IDEs actually need
```

#### 2c. Git-Aware Memory (`alekhdb-git.js`)
```
db.enableGit(projectPath)
  → detects current branch via `git rev-parse --abbrev-ref HEAD`
  → scopes memory to branch: db.setBranch('feature/new-auth')
  → merge: db.mergeBranch('feature/new-auth', 'main')
  → unique feature no competitor has
```

#### 2d. Privacy/Redaction Layer (`alekhdb-privacy.js`)
```
db.enablePrivacy({
  redactPatterns: ['apiKeys', 'emails', 'phoneNumbers', 'awsKeys', 'jwtTokens']
})
  → regex-based PII detection before add()
  → replaces secrets with [REDACTED] before storage
  → optional LLM-based entity detection for complex cases
  → audit log of all redactions
```

#### 2e. Multi-Language AST (`alekhdb-ast.js`)
```
db.enableFullAST()
  → tree-sitter for 100+ languages (Python, Rust, Go, TS, Java, C++)
  → extracts: classes, functions, imports, exports, types
  → builds import/export dependency graph
  → incremental parsing (only re-parse changed files)
  → falls back to regex parser if tree-sitter unavailable
```

#### 2f. File Watcher (`alekhdb-watcher.js`)
```
db.watchDirectory('./src')
  → chokidar-based file system watcher
  → auto-index on create/modify/delete
  → auto-archive memory for deleted files
  → debounced (500ms) to avoid thrashing
```

### Phase 3: Integration

| Interface | Current | Upgrade |
|-----------|---------|---------|
| **MCP server** | 3 tools | 9+ tools: `add`, `search`, `search_vector`, `get_context`, `profile`, `trace_start`, `trace_append`, `trace_replay`, `analyze` |
| **REST API** | 11 endpoints | + `/api/search/vector`, `/api/context`, `/api/git/branch`, `/api/privacy/redact` |
| **CLI** | 17 commands | + `alekhdb search-vector`, `alekhdb context`, `alekhdb git-branch`, `alekhdb embed` |

---

## Part 4: What Makes This Production-Grade

| Requirement | How We Address It |
|-------------|-------------------|
| **Crash safety** | Atomic writes + backup file |
| **Data recovery** | `.bak` file on corruption, not silent wipe |
| **Performance at scale** | Map indexes + debounced save + elective vector index |
| **Semantic search** | Local embeddings via transformers.js (offline, no API key) |
| **Context budget management** | Token-aware context packing (returns prompt-ready string) |
| **Multi-project isolation** | Git-aware branch scoping + scope hierarchy |
| **Privacy/compliance** | Redaction layer before storage (regex + optional LLM) |
| **Multi-language support** | Tree-sitter (elective) with regex fallback |
| **Real-time reactivity** | File watcher (elective) for auto-indexing |
| **IDE integration** | MCP server with 9+ tools + streaming |
| **Observability** | `db.stats()` — hit rate, latency, memory growth |
| **Temporal reasoning** | Bi-temporal edges (valid_at, invalid_at) |
| **No GraphRAG overhead** | Vector search is opt-in. Core stays keyword+graph. |
| **Zero new deps in core** | All heavy features are elective imports |

---

## Part 5: Unique Differentiators

| Feature | AlekhDB v2 | Mem0 | Zep | Cursor |
|---------|-----------|------|-----|--------|
| Bi-temporal memory | ✅ | ❌ | ✅ | ❌ |
| Local embeddings (offline) | ✅ | ❌ (cloud) | ❌ (cloud) | ❌ (cloud) |
| Ebbinghaus forgetting | ✅ | ❌ | ❌ (decay at search) | ❌ |
| Doyle TMS contradictions | ✅ | ❌ | ❌ (temporal) | ❌ |
| Episodic traces | ✅ | ❌ | ✅ (episodes) | ❌ |
| Git-aware branches | ✅ | ❌ | ❌ | ❌ |
| Token-aware context packing | ✅ | ❌ | ✅ (auto search) | ❌ |
| PII redaction | ✅ | ❌ (policy-only) | ❌ | ❌ |
| POSIX virtual mount | ✅ | ❌ | ❌ | ❌ |
| Multi-language AST | ✅ (elective) | ❌ | ❌ | ✅ (tree-sitter) |
| MCP server | ✅ | ✅ | ✅ | ❌ |
| Zero-dep core | ✅ | ❌ | ❌ | ❌ |
| Local-first / offline | ✅ | ❌ (OSS partial) | ❌ (graph DB) | ❌ |

**AlekhDB v2 is the only system that combines: bi-temporal concept memory + local embeddings + git-awareness + PII redaction + zero-dependency core.**