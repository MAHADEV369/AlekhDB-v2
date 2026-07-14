# ⚡ AlekhDB v2: Local-First Cognitive GraphRAG for AI Agents & IDEs

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D%2018.0.0-green.svg)](package.json)
[![Phases](https://img.shields.io/badge/Phases-1%E2%80%948_%2B_8_Complete-emerald.svg)](DESIGN_PLAN.md)
[![Latency](https://img.shields.io/badge/Core-Sub--Millisecond-purple.svg)](bench/run.js)
[![Zero Deps](https://img.shields.io/badge/Core-Zero--Dependency-glowing.svg)](package.json)

**AlekhDB** (*meaning "graph, record, drawing"* in Sanskrit) is a high-performance, **local-first GraphRAG database and cognitive memory engine** built for AI agents, IDEs, and agentic engineering.

Traditional vector databases store flat, append-only embeddings and lack relational topology. AlekhDB v2 engineers a **biological, self-editing AI memory layer** with exponential Ebbinghaus attention curves, Doyle-style bi-temporal truth maintenance, AST-aware codebase mapping, chronological action tracing, and a zero-dependency virtual POSIX filesystem mount. The v2 release adds **reasoning memory**, **offline consolidation**, **cross-session briefing**, and **temporal trend queries**.

---

## Why AlekhDB v2

| Feature | Mem0 | Supermemory | ⚡ AlekhDB v2 |
| :--- | :--- | :--- | :--- |
| Sub-millisecond core ops | ❌ (~880ms hybrid) | ❌ (~92ms hybrid) | 🟢 **< 1ms** |
| Multi-hop graph traversal | ❌ (vector only) | ❌ | 🟢 **0.22ms (5-hop BFS)** |
| Token-budget context packing | ❌ | ❌ | 🟢 **`getContext(maxTokens)`** |
| Cross-scope merge | ❌ | ❌ | 🟢 **`mergeScopes()` 7.7ms** |
| Temporal evolution series | ❌ | ❌ | 🟢 **`getEvolution()` 7.2ms** |
| Ebbinghaus biological forgetting | ❌ | ❌ | 🟢 **Yes (configurable half-life)** |
| Bi-temporal TMS (Doyle) | ❌ | ❌ | 🟢 **Yes** |
| PII redaction before storage | ❌ | ❌ | 🟢 **11 regex patterns** |
| First-class decision provenance | ❌ | ❌ | 🟢 **`addDecision()` + rejected/chosen edges** |
| First-class failure memory | ❌ | ❌ | 🟢 **`addFailure()` queryable by errorSignature** |
| Optimization history | ❌ | ❌ | 🟢 **`addChange()` with replaces edge** |
| Episodic trace + frame replay | ❌ | ❌ | 🟢 **`startTrace/replayTrace()` 0.0004ms** |
| Inferred memory review queue | ❌ | ✅ (cloud) | 🟢 **`db.review.approve/decline/undo`** |
| Agentic mass-forget | ✅ | ✅ | 🟢 **`forgetMatch()` 0.019ms** |
| Git-aware branch scoping | ❌ | ❌ | 🟢 **Zero leakage** |
| Local embeddings offline | ❌ (cloud) | ❌ (cloud) | 🟢 **MiniLM via transformers.js** |
| Zero-dependency core | ❌ (Postgres) | ❌ (Express) | 🟢 **Single JSON file** |
| MCP server | ✅ (9 tools) | ✅ | 🟢 **21 tools** |

**9 capabilities no competitor has.** See `benchmarks/01-ide-monorepo/reports/04-ranking.md` for the latest 3-way benchmark.

---

## Quick Start

```bash
git clone https://github.com/MAHADEV369/AlekhDB-v2.git
cd AlekhDB-v2
npm install
npm run doctor       # run health check
npm test             # run full test suite
```

5-second setup, zero cloud dependency. Works offline.

### Seed Sample Data

```bash
node cli.js seed    # load sample data (Trident developer profile)
```

### Run the 3-Backend Competitive Benchmark

```bash
# Clone the dataset (one-time, ~5 min)
node benchmarks/01-ide-monorepo/dataset/load-vscode.js

# Run all 3 backends (AlekhDB, Mem0, Supermemory)
npm run bench:ide

# Score and rank
npm run bench:ide:score

# Read the report
cat benchmarks/01-ide-monorepo/reports/04-ranking.md
```

---

## Core Cognitive Senses

### Memory Tiers (6 layers)

- 🌐 **Semantic Memory** *(Ontological Graph)*: Entities (Nodes) connected by Weighted Relationships (Edges). Subject to Ebbinghaus decay and spaced repetition.
- 🎬 **Episodic Memory** *(Execution Traces)*: Chronological frames with tool calls, results, errors, snapshots. Replayable in 0.0004ms.
- ⚡ **Working Memory** *(Active Context)*: A token-budgeted subset that fits the LLM prompt window.
- 🗄️ **Subconscious Memory** *(Decayed / Archived)*: Strength < 0.15, instantly revived via Spaced Repetition if queried.
- 💻 **Procedural Code Memory** *(AST Graph)*: File/Class/Function hierarchies. Exempt from decay.
- 📂 **Virtual Memory** *(POSIX Mount)*: Graph states mapped to virtual files (`/memory/profile.md`).

### Cognitive Mechanisms

- **Ebbinghaus Relevance Decay**: $S_t = S_0 e^{-\lambda \Delta t}$ — biological forgetting with configurable half-life (default 168h = 1 week).
- **Spaced Repetition Reinforcement**: Querying a node boosts strength by +0.35 (capped at 2.0).
- **Doyle-Style Bi-Temporal TMS**: New facts audited against active beliefs; conflicts get `dissonanceScore`, conflicting edges soft-decayed to weight 0.15 (preserved, not deleted).
- **Context-Change-1 Self-Editing**: When context window exceeds 80% of `contextCapacity`, redundant nodes pruned automatically.
- **POSIX Mounted Directory**: Project memory states as virtual files. Read with `cat /memory/profile.md` from the shell.

---

## Phase 8: Reasoning Memory (new in v2)

- **`addDecision(id, { context, alternatives, chosen, rationale })`** — Structured decision with rejected/chosen edges. Query "every time we chose Redis because cross-region replication".
- **`addFailure(id, { approach, error, errorSignature, context })`** — First-class failure memory, queryable by error signature.
- **`addChange(id, { removed, removedReason, added, addedReason, justification })`** — Optimization history. Old node's `isLatest=false`, `forgetReason=justification`.
- **`emitReasoned(eventName, { action, reason, payload })`** — Emit + log atomic event with action+reason in one record.
- **`db.review.list/approve/decline/undo`** — Inferred memory review queue.
- **`enableConsolidator(db, { intervalMs: 300000 })`** — Async offline daemon: schema induction, belief revision, cross-domain linking, trust recalculation.
- **`getBriefing({ since, until, sessionIds })`** — Cross-session summary.
- **`getEvolution({ since, until, bucket })`** — Temporal trend series (day/week/month).
- **`getTemporalSeries(field, { since, until, bucket })`** — Field-over-time tracking (cognitiveStrength, version, sourceTrust).

---

## Integration Surfaces

### MCP Server (21 tools)

```json
{
  "mcpServers": {
    "alekhdb": {
      "command": "node",
      "args": ["/absolute/path/to/AlekhDB-v2/mcp_server.js"]
    }
  }
}
```

Connect Claude Code, Claude Desktop, Cursor, or any MCP client. Tools include `alekhdb_add`, `alekhdb_search`, `alekhdb_search_hybrid`, `alekhdb_get_context`, `alekhdb_profile`, `alekhdb_add_decision`, `alekhdb_add_failure`, `alekhdb_add_change`, `alekhdb_review_inferred`, `alekhdb_forget_match`, `alekhdb_trace_start`, `alekhdb_git_status`, `alekhdb_get_briefing`, `alekhdb_get_evolution`, and more.

### REST API (50 endpoints)

```bash
npm run api    # starts on http://localhost:3000
```

Full OpenAPI spec at `openapi.json`. Endpoints for ingest, search (keyword + hybrid), profile, trace start/append/finalize/replay, git branch/merge, batch operations, export/import, embed, watch, briefing, evolution, decision/failure/change, PII redaction.

### CLI (41 commands)

```bash
node cli.js add "User prefers Bun over Node.js"
node cli.js search "auth flow"
node cli.js profile
node cli.js trace start my-trace
node cli.js decision dec-db --chosen Redis --alt "Redis,Memcached,Postgres" --why "cross-region replication"
node cli.js failure fail-1 --approach auth --error "EconnRefused"
node cli.js change chg-rest --removed REST --added GraphQL --why "over-fetching"
node cli.js review list
node cli.js briefing --since "2026-07-10"
node cli.js evolution --since "30 days ago" --bucket week
node cli.js export
node cli.js mcp
node cli.js server
```

### Elective Modules (zero cost when not imported)

| Module | Purpose | New Dep |
| :--- | :--- | :--- |
| `alekhdb-extract.js` | LLM-based fact extraction (Ollama, OpenAI, Gemini, Anthropic, Grok) | None (uses `fetch`) |
| `alekhdb-embed.js` | Local MiniLM embeddings via transformers.js | `@huggingface/transformers` |
| `alekhdb-context.js` | Token-aware context packing | None |
| `alekhdb-git.js` | Git-aware branch scoping and merge | None (uses `git` CLI) |
| `alekhdb-privacy.js` | PII redaction (11 regex patterns) | None |
| `alekhdb-ast.js` | Tree-sitter multi-language AST (100+ languages) | `web-tree-sitter` |
| `alekhdb-watcher.js` | File system watcher (chokidar) | `chokidar` |
| `alekhdb-lsp.js` | LSP hooks (onDidSave, onDiagnostic, etc.) | None |
| `alekhdb-consolidator.js` | Async offline consolidation daemon | None |

---

## Performance Scorecard (latest 3-backend benchmark)

Real dataset: `microsoft/vscode` (2,000 files → 22,817 nodes + 21,161 edges).

| Backend | Score | Ops Native | Ops Skipped | Backend type |
|---|---|---|---|---|
| **01-alekhdb** | **84.06** | **14/14 (100%)** | 0 | **Real local** |
| 03-supermemory | 58.41 | 10/14 (71%) | 4 | Real (local REST) |
| 02-mem0 | 15.34 | 5/14 (36%) | 9 | FALLBACK (in-mem sim) |

Full report: `benchmarks/01-ide-monorepo/reports/04-ranking.md`. Re-run anytime with `npm run bench:ide`.

---

## Documentation

- [`DESIGN_PLAN.md`](DESIGN_PLAN.md) — High-level architecture
- [`phases/`](phases/) — Phase-by-phase implementation spec
- [`benchmarks/README.md`](benchmarks/README.md) — How to run the 3-way benchmark
- [`IDEMemoryreq.md`](IDEMemoryreq.md) — Production IDE requirements analysis

---

## Research Paper

A research paper based on this codebase is in progress:

**"AlekhDB: Biological-Inspired, Local-First Memory for Long-Horizon AI Agents"** (target venue: AAAI 2027)

- `paper/paper.md` and `paper/paper.tex` — full paper draft
- `paper/figures/` — 5 publication-quality figures
- `paper/tables/` — 6 data tables (CSV)
- `paper/agent-task/` — long-horizon agent task, ablation, cognitive study
- `paper/scripts/` — scaling benchmark, statistical trials, figure generation
- `paper/README.md` — reproducibility guide
- `arxiv-submission/` — ready-to-upload arXiv package

Headline results: AlekhDB 87.3/100 vs Supermemory 63.9, Letta 52.9, Mem0 41.7, Zep 40.8 on the 5-backend benchmark. 8/9 unique capabilities show drop=1 when ablated. Ebbinghaus decay achieves 100% recall vs uniform TTL 24% on long-horizon retrieval.

## License

AlekhDB v2 is open-source software licensed under the [MIT License](LICENSE).
