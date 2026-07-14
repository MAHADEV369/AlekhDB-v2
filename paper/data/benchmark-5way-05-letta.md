# Backend Report — 05-letta

Generated at: 2026-07-14T18:52:10.100Z
Local Letta-compatible REST server (http://127.0.0.1:8126) with Ollama embeddings (nomic-embed-text). Recall + archival memory architecture.

## Per-operation results

| # | Op | Status | p50 (ms) | p95 (ms) | p99 (ms) | Notes |
|---|---|---|---|---|---|---|
| 1 | Add a fact across branches | OK | 0.7475 | 1.022 | 1.022 | — |
| 2 | Semantic search | OK | 1.2891 | 1.3641 | 1.3641 | returned=6 |
| 3 | undefined | SKIP | — | — | — | Letta's archival memory is a flat vector store — no edge graph BFS API |
| 4 | undefined | SKIP | — | — | — | Letta's recall memory is in-context blocks; no token-budget packing API exposed via REST |
| 5 | Branch isolation (add contradicting fact) | OK | 0.5951 | 0.8933 | 0.8933 | leakage=0 |
| 6 | undefined | SKIP | — | — | — | Letta's per-agent memory is isolated; merge would require manual copy + recall rewrite |
| 7 | undefined | SKIP | — | — | — | Letta's archival search supports recency filter, not bucket aggregation |
| 8 | undefined | SKIP | — | — | — | Letta has no inference review queue — all memories are trusted |
| 9 | Agentic mass-forget | OK | 0.456 | 0.5788 | 0.5788 | — |
| 10 | PII redaction | OK | 0 | 0 | 0 | leakage=1, redacted=false |
| 11 | undefined | SKIP | — | — | — | Letta has no failure memory type — all archival passages are uniform |
| 12 | undefined | SKIP | — | — | — | Letta's recall memory can hold decisions but no structured alternatives/chosen/rationale fields |
| 13 | undefined | SKIP | — | — | — | Letta has no change/replace semantic — just append/delete |
| 14 | undefined | SKIP | — | — | — | Letta's archival memory is the closest concept but no frame-level append + replay API |

## Summary

- Operations executed: 5 / 14
- Operations skipped: 9 / 14
- Setup time: 124.19s
- DB size on disk: 0.00 MB

