# Backend Report — 02-mem0

Generated at: 2026-07-14T18:50:02.082Z
Real local Mem0-compatible REST server (http://127.0.0.1:8124) with Ollama embeddings (nomic-embed-text, 768-dim) and in-memory vector store.

## Per-operation results

| # | Op | Status | p50 (ms) | p95 (ms) | p99 (ms) | Notes |
|---|---|---|---|---|---|---|
| 1 | Add a fact across branches | OK | 24.2233 | 34.9871 | 36.5537 | — |
| 2 | Semantic search | OK | 32.2452 | 39.9886 | 39.9886 | returned=10 |
| 3 | undefined | SKIP | — | — | — | Mem0 is vector store only — no graph traversal / multi-hop BFS |
| 4 | undefined | SKIP | — | — | — | Mem0 has no token-budget context packing API — closest is get_all which dumps everything |
| 5 | Branch isolation (add contradicting fact) | OK | 23.0335 | 28.1198 | 28.1198 | leakage=0 |
| 6 | undefined | SKIP | — | — | — | Mem0 has no scope merge API — would require manual copy + delete on user_id boundary |
| 7 | undefined | SKIP | — | — | — | Mem0 has no temporal aggregation / bucket query API — search returns flat top-k |
| 8 | undefined | SKIP | — | — | — | Mem0 has no inference review queue — all memories are trusted by default |
| 9 | Agentic mass-forget | OK | 0.1636 | 0.1822 | 0.1822 | — |
| 10 | PII redaction | OK | 0 | 0 | 0 | leakage=1, redacted=false |
| 11 | undefined | SKIP | — | — | — | Mem0 has no failure memory type — would require custom metadata, not queryable as a first-class concept |
| 12 | undefined | SKIP | — | — | — | Mem0 has no decision provenance — no alternatives, no chosen, no rationale structured fields |
| 13 | undefined | SKIP | — | — | — | Mem0 has no change/optimization history — would require custom metadata, not first-class queryable |
| 14 | undefined | SKIP | — | — | — | Mem0 has no episodic trace/replay API — closest is search by time, no chronological frame sequence |

## Summary

- Operations executed: 5 / 14
- Operations skipped: 9 / 14
- Setup time: 88.79s
- DB size on disk: 0.00 MB

