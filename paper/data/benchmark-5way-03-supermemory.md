# Backend Report — 03-supermemory

Generated at: 2026-07-14T18:50:02.673Z
Local SuperMemory-style REST server (http://127.0.0.1:8123). Real HTTP round-trips against an Express-backed versioned DAG.

## Per-operation results

| # | Op | Status | p50 (ms) | p95 (ms) | p99 (ms) | Notes |
|---|---|---|---|---|---|---|
| 1 | Add a fact across branches | OK | 0.4135 | 1.1519 | 1.9104 | — |
| 2 | Semantic search | OK | 12.9911 | 15.7404 | 15.7404 | returned=7 |
| 3 | undefined | SKIP | — | — | — | Supermemory is not a graph DB — no multi-hop BFS over relations |
| 4 | undefined | SKIP | — | — | — | Supermemory's REST search returns flat top-k; no token-budget context packing API exposed |
| 5 | Branch isolation (add contradicting fact) | OK | 0.3394 | 2.2827 | 2.2827 | leakage=0 |
| 6 | undefined | SKIP | — | — | — | Supermemory has no scope-merge API; would require manual container-tag move + dedup |
| 7 | undefined | SKIP | — | — | — | Supermemory's search supports time filters but no bucket aggregation series |
| 8 | Inference review queue | OK | 0.0292 | 0.084 | 0.0884 | returned=1 |
| 9 | Agentic mass-forget | OK | 12.0162 | 13.237 | 13.237 | — |
| 10 | PII redaction | OK | 0 | 0 | 0 | leakage=1, redacted=false |
| 11 | Failure memory | OK | 0.2995 | 0.4773 | 0.4773 | — |
| 12 | Decision provenance | OK | 0.2837 | 0.3691 | 0.3691 | — |
| 13 | Optimization history | OK | 0.2817 | 0.5626 | 0.5626 | — |
| 14 | Episodic trace + replay | OK | 0.1949 | 0.2839 | 0.4007 | returned=2 |

## Summary

- Operations executed: 10 / 14
- Operations skipped: 4 / 14
- Setup time: 0.59s
- DB size on disk: 0.00 MB

