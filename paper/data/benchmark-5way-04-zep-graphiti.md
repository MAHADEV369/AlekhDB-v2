# Backend Report — 04-zep-graphiti

Generated at: 2026-07-14T18:50:05.486Z
Local Zep/Graphiti-compatible REST server (http://127.0.0.1:8125) with Ollama LLM extraction (qwen3.5:9b).

## Per-operation results

| # | Op | Status | p50 (ms) | p95 (ms) | p99 (ms) | Notes |
|---|---|---|---|---|---|---|
| 1 | Add a fact across branches | OK | 0.92 | 1.1625 | 1.1625 | — |
| 2 | Semantic search | OK | 355.7259 | 368.9046 | 368.9046 | returned=10 |
| 3 | undefined | SKIP | — | — | — | Zep/Graphiti exposes a hybrid retriever, not direct BFS over edges — no low-level multi-hop walk API |
| 4 | undefined | SKIP | — | — | — | Zep/Graphiti doesn't expose a token-budget context packing API — returns ranked results |
| 5 | Branch isolation (add contradicting fact) | OK | 0.7759 | 4.109 | 4.109 | leakage=0 |
| 6 | undefined | SKIP | — | — | — | Zep/Graphiti's group_id is the scoping unit; merge would require manual episode replay |
| 7 | undefined | SKIP | — | — | — | Zep/Graphiti's search supports time filters but not bucket aggregation series |
| 8 | undefined | SKIP | — | — | — | Zep/Graphiti treats all extracted facts as trusted — no review queue concept |
| 9 | undefined | SKIP | — | — | — | Zep/Graphiti doesn't expose a bulk-forget-by-query API; would need episode-level deletes |
| 10 | PII redaction | OK | 0 | 0 | 0 | leakage=1, redacted=false |
| 11 | undefined | SKIP | — | — | — | Zep/Graphiti treats all episodes uniformly — no failure-type first-class concept |
| 12 | undefined | SKIP | — | — | — | Zep/Graphiti's LLM extraction may capture decisions, but no structured alternatives/chosen/rationale fields |
| 13 | undefined | SKIP | — | — | — | Zep/Graphiti's bi-temporal edges track validity, but no first-class change/replace semantics |
| 14 | undefined | SKIP | — | — | — | Zep/Graphiti's episode ingestion is the closest concept, but no frame-level append + replay API |

## Summary

- Operations executed: 4 / 14
- Operations skipped: 10 / 14
- Setup time: 0.04s
- DB size on disk: 0.00 MB

