# Backend Report — 05-letta

Generated at: 2026-07-15T04:48:50.005Z
Local Letta-compatible REST server (http://127.0.0.1:8126) with Ollama embeddings (nomic-embed-text). Recall + archival memory architecture.

## Per-operation results

| # | Op | Status | p50 (ms) | p95 (ms) | p99 (ms) | Notes |
|---|---|---|---|---|---|---|
| 1 | Add a fact across branches | OK | 2.3208 | 3.6959 | 3.6959 | — |
| 2 | Semantic search | OK | 2.0005 | 2.2377 | 2.2377 | returned=6 |
| 3 | undefined | SKIP | — | — | — | Letta's archival memory is a flat vector store — no edge graph BFS API |
| 4 | undefined | SKIP | — | — | — | Letta's recall memory is in-context blocks; no token-budget packing API exposed via REST |
| 5 | Branch isolation (add contradicting fact) | OK | 1.0881 | 1.1518 | 1.1518 | leakage=0 |
| 6 | undefined | SKIP | — | — | — | Letta's per-agent memory is isolated; merge would require manual copy + recall rewrite |
| 7 | undefined | SKIP | — | — | — | Letta's archival search supports recency filter, not bucket aggregation |
| 8 | undefined | SKIP | — | — | — | Letta has no inference review queue — all memories are trusted |
| 9 | Agentic mass-forget | OK | 0.4184 | 0.4763 | 0.4763 | — |
| 10 | PII redaction | OK | 0 | 0 | 0 | leakage=1, redacted=false |
| 11 | undefined | SKIP | — | — | — | Letta has no failure memory type — all archival passages are uniform |
| 12 | undefined | SKIP | — | — | — | Letta's recall memory can hold decisions but no structured alternatives/chosen/rationale fields |
| 13 | undefined | SKIP | — | — | — | Letta has no change/replace semantic — just append/delete |
| 14 | undefined | SKIP | — | — | — | Letta's archival memory is the closest concept but no frame-level append + replay API |
| 15 | undefined | SKIP | — | — | — | Letta's recall memory holds free-form blocks — no typed principle/pattern/constraint knowledge |
| 16 | undefined | SKIP | — | — | — | Letta has no typed knowledge edges — only block references |
| 17 | undefined | SKIP | — | — | — | Letta's archival search is not type-filtered — no unified knowledge search |
| 18 | undefined | SKIP | — | — | — | Letta has no pre-action conflict guard API |

## Summary

- Operations executed: 5 / 18
- Operations skipped: 13 / 18
- Setup time: 208.57s
- DB size on disk: 0.00 MB

