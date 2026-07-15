# Backend Report — 03-supermemory

Generated at: 2026-07-15T04:27:38.011Z
Local SuperMemory-style REST server (http://127.0.0.1:8123). Real HTTP round-trips against an Express-backed versioned DAG.

## Per-operation results

| # | Op | Status | p50 (ms) | p95 (ms) | p99 (ms) | Notes |
|---|---|---|---|---|---|---|
| 1 | Add a fact across branches | OK | 0.1852 | 0.306 | 0.3617 | — |
| 2 | Semantic search | OK | 22.0415 | 38.4708 | 38.4708 | returned=10 |
| 3 | undefined | SKIP | — | — | — | Supermemory is not a graph DB — no multi-hop BFS over relations |
| 4 | undefined | SKIP | — | — | — | Supermemory's REST search returns flat top-k; no token-budget context packing API exposed |
| 5 | Branch isolation (add contradicting fact) | OK | 0.2084 | 1.3123 | 1.3123 | leakage=0 |
| 6 | undefined | SKIP | — | — | — | Supermemory has no scope-merge API; would require manual container-tag move + dedup |
| 7 | undefined | SKIP | — | — | — | Supermemory's search supports time filters but no bucket aggregation series |
| 8 | Inference review queue | OK | 0.04 | 0.501 | 0.6713 | returned=1 |
| 9 | Agentic mass-forget | OK | 22.0167 | 23.1514 | 23.1514 | — |
| 10 | PII redaction | OK | 0 | 0 | 0 | leakage=1, redacted=false |
| 11 | Failure memory | OK | 0.1927 | 0.2227 | 0.2227 | — |
| 12 | Decision provenance | OK | 0.1942 | 3.5232 | 3.5232 | — |
| 13 | Optimization history | OK | 0.1914 | 0.2825 | 0.2825 | — |
| 14 | Episodic trace + replay | OK | 0.1242 | 0.1692 | 0.171 | returned=2 |
| 15 | undefined | SKIP | — | — | — | Supermemory has no first-class principle/pattern/constraint knowledge type — all memories are flat text |
| 16 | undefined | SKIP | — | — | — | Supermemory has no typed knowledge edges (supersedes, contradicts) — graph is implicit |
| 17 | undefined | SKIP | — | — | — | Supermemory has no type-filtered unified search — only generic memory search |
| 18 | undefined | SKIP | — | — | — | Supermemory has no pre-action conflict guard API |

## Summary

- Operations executed: 10 / 18
- Operations skipped: 8 / 18
- Setup time: 1.09s
- DB size on disk: 0.00 MB

