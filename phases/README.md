# AlekhDB v2 — Phase Build Guide

## What This Is

A set of 7 phase documents that detail how to upgrade **AlekhDB** from a prototype into a production-grade, sub-millisecond, local-first AI memory library for AI IDEs and agentic engineering.

## Repo

- **Source**: https://github.com/MAHADEVD369/AlekhDB
- **Core file**: `alekhdb.js` (~1268 lines, zero dependencies, JSON persistence)
- **Key constraint**: Build ON TOP of existing code. Edit, don't rewrite.
- **Speed constraint**: Core ops must stay sub-millisecond.
- **Dependency constraint**: Core stays zero-dep. Heavy features are elective modules.

## Files

| Phase | File | What It Does | New Deps |
|-------|------|-------------|----------|
| 1 | `phase1-core-engine.md` | Atomic writes, Map indexes, debounced save, inverted index, configurable decay, multi-hop | 0 |
| 2 | `phase2-memory-model.md` | Ollama extraction, versioned DAG, 3 relations, memory types, forgetAfter, contextual add | 0 (Ollama is external service) |
| 3 | `phase3-storage-multitenancy.md` | Container tags, filter expressions, batch ops, export/import, events, history | 0 |
| 4 | `phase4-retrieval-engine.md` | Multi-signal fusion (5 signals), local embeddings, reranking, context packing | @huggingface/transformers |
| 5 | `phase5-profiles-review.md` | Static/dynamic profiles, configurable buckets, inferred review, mass-forget, provenance | 0 |
| 6 | `phase6-ide-differentiators.md` | git-aware, PII redaction, tree-sitter AST, file watcher, LSP hooks | web-tree-sitter, chokidar |
| 7 | `phase7-integration.md` | MCP 12+ tools, REST 25+ endpoints, CLI 20+ commands, benchmarks | 0 |

## Build Order

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
```

Each phase depends on the previous. Do not skip.

## Key Design Decisions

1. **No new deps in core** — `alekhdb.js` stays zero-dependency
2. **Elective modules** — heavy features are `import`-optional, zero cost if unused
3. **Backward compatible** — legacy `Supermemory` alias preserved, existing API unchanged
4. **Sub-ms hot path** — `save()` removed from `addNode()`/`addEdge()`/`search()`, debounced to 500ms
5. **Atomic writes** — write to `.tmp` → `rename()` (crash-safe on POSIX)
6. **Inverted index** — `Map<token, Set<nodeId>>` for O(matches) search vs O(total nodes)

## Performance Targets (After All Phases)

| Operation | Target | Today |
|-----------|--------|-------|
| `addNode()` | < 0.01ms | ~40ms (with save) |
| `getNode(id)` | < 0.001ms | O(n) scan |
| `search()` keyword (10K) | < 0.05ms | ~14ms |
| `search()` hybrid fused (10K) | < 6ms | N/A |
| `profile()` | < 0.1ms | ~0.1ms |
| `save()` (debounced) | < 5ms async | ~40ms sync every op |
| Embed (per text) | ~20ms | N/A |
| Load DB (10K nodes) | ~20ms | N/A |

## Read Before Building

- `alekhdb.js` — the core engine you're editing
- `cli.js` — CLI interface (calls core methods)
- `api.js` — REST API (calls core methods)
- `mcp_server.js` — MCP server (calls core methods)
- `sampleData.js` — seed data structure
- `.cursorrules` — project conventions
- `DESIGN_PLAN.md` — high-level architecture

Each phase MD file is self-contained. A model reading just one phase file + `alekhdb.js` should be able to implement it.