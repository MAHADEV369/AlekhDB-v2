# Benchmark 01 — AI IDE Multi-Agent Coding on a 100K-File Polyglot Mono-Repo

## Scenario

A 4-engineer team is working on **microsoft/vscode** (a real 100K-file polyglot mono-repo spanning TypeScript, JavaScript, Python, Rust, Go, Java, C++) using four parallel coding agents — one per feature branch:

- **Agent A** — `branch:feat/auth` — adding a new OAuth2 provider to VS Code's authentication system
- **Agent B** — `branch:feat/payments` — integrating a billing service into the extensions marketplace
- **Agent C** — `branch:feat/search` — improving the workspace search index
- **Agent D** — `branch:feat/infra` — adding telemetry for CI runs

All four agents share a memory layer. The memory backend must:

1. **Index the entire repo** (~100K files, 6 languages)
2. **Store agent facts** across 4 parallel branches with full isolation
3. **Find semantically-related code** that doesn't share keywords
4. **Trace multi-hop call chains** across files
5. **Pack relevant context** within an LLM token budget
6. **Switch branches cleanly** without leakage
7. **Merge feature branches** into main
8. **Time-travel** ("what changed in auth last week?")
9. **Manage LLM-derived inferences** with a review queue
10. **Agentic mass-forget** ("forget all references to v1 API")
11. **Redact PII** (API keys pasted in chat)
12. **Capture failures** with error signatures
13. **Capture decisions** with alternatives + rationale
14. **Capture changes** ("removed X because Y, added Z")
15. **Replay an episodic CI-failure trace**

This benchmark runs all 15 operations against three memory backends (AlekhDB, Mem0, Supermemory) and ranks them on identical metrics.

## Dataset

- **Source**: https://github.com/microsoft/vscode (cloned to `benchmarks/01-ide-monorepo/dataset/vscode/`)
- **Files indexed**: ~100K files across 6 languages
- **Initial seed memories**: ~50K (file paths, class names, function signatures, import edges)
- **Loader**: `dataset/load-vscode.js` (Node) and `dataset/load-vscode.py` (Python for mem0ai SDK)
- **Deterministic**: same seed on every run, so re-runs are comparable

## The 14 operations (canonical, in order)

| # | Op | What it tests | Success criterion |
|---|---|---|---|
| 1 | `add("VS Code uses JWT for session tokens", scope=branch:feat/auth)` | Append speed under contention | < 5ms |
| 2 | `search("authentication controller")` (should find "OAuth2Provider" by semantic similarity) | Vector vs keyword | recall@5 includes "OAuth2Provider" |
| 3 | `search("MainThread", maxDepth=5)` — find the 5-hop call chain | Graph traversal | traversedNodeIds length >= 5 |
| 4 | `getContext({query: "auth", maxTokens: 8000})` | Context packing | returns a string within 8K tokens, contains > 3 results |
| 5 | Switch to `branch:feat/payments`, add `("VS Code uses API keys for billing")` (contradicts #1) | Branch isolation | no leakage to auth branch |
| 6 | `mergeScopes("branch:feat/auth", "branch:main")` | Cross-scope merge | returns {copied: N} |
| 7 | `getEvolution({bucket: "week", since: "30 days ago"})` | Temporal query | returns per-week bucket with byType breakdown |
| 8 | `addInference("Likely auth uses refresh tokens")` (route to review queue) | Inference management | review.list() includes the inference |
| 9 | `forgetMatch({query: "v1 API"})` | Bulk deletion | forgets all matching memories |
| 10 | `add("My API key is sk-abc123def456ghi789")` then search for it | PII redaction | search returns 0 hits for the key |
| 11 | `addFailure("auth-flow", error: "EconnRefused", errorSignature: "ECONN_REFUSED")` | Failure memory | searchable by errorSignature |
| 12 | `addDecision("dec-db", alternatives: ["PostgreSQL", "MySQL", "SQLite"], chosen: "PostgreSQL", rationale: "scales horizontally")` | Decision provenance | alternatives are queryable as edges |
| 13 | `addChange("chg-rest", removed: "REST", added: "GraphQL", justification: "reduces over-fetching")` | Optimization history | searchable by removed/added |
| 14 | `startTrace → appendEventFrame (CI failed with ExitCode 137) → finalizeTrace("failure") → replayTrace` | Trace replay | replay returns the CI failure frame |

## Backend-specific expectations

Some operations are **only supported** by certain backends. The runner records `SKIP` for any operation a backend cannot do, with a justification:

| Operation | AlekhDB | Mem0 | Supermemory |
|---|---|---|---|
| 1. Add fact | ✅ | ✅ | ✅ |
| 2. Semantic search | ✅ (local embeddings) | ✅ (vector) | ✅ (vector) |
| 3. Multi-hop traversal | ✅ (BFS adjacency) | ❌ (Mem0 is vector-only) | partial (DAG walk) |
| 4. Context packing | ✅ (token-aware) | ❌ (no token-budget API) | ✅ (`auto` search) |
| 5. Branch isolation | ✅ (git-aware) | ❌ (flat namespace) | partial (container tags) |
| 6. Scope merge | ✅ (mergeScopes) | ❌ | partial |
| 7. Temporal query | ✅ (getEvolution) | ❌ | partial (filters) |
| 8. Inference review queue | ✅ (review.approve/decline/undo) | ❌ | ✅ (review endpoint) |
| 9. Agentic mass-forget | ✅ (forgetMatch) | ✅ (delete_all) | ✅ (forget API) |
| 10. PII redaction | ✅ (privacy module) | ❌ | ❌ |
| 11. Failure memory | ✅ (first-class) | implicit only | implicit only |
| 12. Decision provenance | ✅ (alternatives + chosen + rationale) | ❌ | partial |
| 13. Optimization history | ✅ (change nodes with removed/added) | ❌ | partial |
| 14. Trace + replay | ✅ (startTrace / appendEventFrame / replayTrace) | ❌ (no episodic) | partial (episodes) |

## Latency targets

These are the targets for the **AlekhDB** baseline. Competitors will likely be slower — the report will show by how much.

| Operation | Target p50 | Target p99 |
|---|---|---|
| 1. Add fact | < 0.5ms | < 2ms |
| 2. Semantic search (50K memories) | < 10ms | < 30ms |
| 3. Multi-hop (5 hops, 50K memories) | < 10ms | < 30ms |
| 4. Context packing (8K budget) | < 15ms | < 40ms |
| 6. Scope merge (100 nodes) | < 5ms | < 15ms |
| 7. Temporal query (30 days, weekly buckets) | < 15ms | < 50ms |
| 9. Mass-forget (100 matches) | < 20ms | < 60ms |
| 14. Trace replay (10 frames) | < 1ms | < 5ms |

## Scoring rubric (weighted)

- **40% latency** — the IDE hot path is the goal. We expect AlekhDB to dominate here.
- **25% correctness** — recall@5 and precision@5 against expected results. We expect parity.
- **15% feature coverage** — does the backend support the operation natively (or did it have to SKIP)? We expect AlekhDB to win on git-branches, PII, decision/failure/change provenance.
- **10% memory footprint** — heap delta + DB size. We expect AlekhDB to win (zero-dep, JSON file).
- **10% setup cost** — time to onboard the dataset. We expect AlekhDB to win (no Postgres, no vector DB to spin up).

## Output reports

After running, the benchmark produces:

1. `reports/01-alekhdb-report.md` — per-operation metrics for AlekhDB
2. `reports/02-mem0-report.md` — per-operation metrics for Mem0
3. `reports/03-supermemory-report.md` — per-operation metrics for Supermemory
4. `reports/04-ranking.md` — final side-by-side ranking with verdict

Plus a `reports/metrics.json` for machine-readable comparison.

## How to run

```bash
# 1. Clone the dataset (one-time, ~5 min for vscode)
node benchmarks/01-ide-monorepo/dataset/load-vscode.js

# 2. Run the 14 ops against all 3 backends
node benchmarks/01-ide-monorepo/runner/run-all.js

# 3. Score and rank
node benchmarks/01-ide-monorepo/runner/score.js

# 4. Read the final report
cat benchmarks/01-ide-monorepo/reports/04-ranking.md
```

## Honest reporting

The benchmark reports **real numbers** for each backend, including when one is significantly slower or missing a feature. Where a backend cannot perform an operation natively, the report shows `SKIP` with a justification. The ranking is data, not opinion.

## What this benchmark is NOT testing

- **Real-time concurrent agents** — all 4 agents run sequentially in the bench, not in parallel
- **LLM extraction quality** — the bench uses `rules` (regex) provider for fairness; cloud LLM extraction quality is a separate concern
- **Long-term Ebbinghaus decay** — the bench runs in seconds, not weeks; decay is measured at the configured rate, not over time
- **Multi-user collaboration** — only single-user, single-tenant scenarios

## Known limitations

- Mem0's local OSS requires Postgres + Qdrant running locally. If they're not running, the runner falls back to a SKIP for Mem0 and logs the reason.
- Supermemory is cloud-only. The runner needs `SUPERMEMORY_API_KEY` in env. Without it, the runner SKIPs Supermemory.
- The dataset cloning step takes ~5 min for vscode. A 10K-file synthetic dataset is available as a fallback (set `BENCH_DATASET=synthetic`).
