# Backend Report — 02-mem0

Generated at: 2026-07-15T04:27:36.921Z
Real local Mem0-compatible REST server (http://127.0.0.1:8124) with Ollama embeddings (nomic-embed-text, 768-dim) and in-memory vector store.

## Per-operation results

| # | Op | Status | p50 (ms) | p95 (ms) | p99 (ms) | Notes |
|---|---|---|---|---|---|---|
| 1 | Add a fact across branches | OK | 18.6606 | 21.8541 | 23.0378 | — |
| 2 | Semantic search | OK | 23.4402 | 27.0999 | 27.0999 | returned=10 |
| 3 | undefined | SKIP | — | — | — | Mem0 is vector store only — no graph traversal / multi-hop BFS |
| 4 | undefined | SKIP | — | — | — | Mem0 has no token-budget context packing API — closest is get_all which dumps everything |
| 5 | Branch isolation (add contradicting fact) | OK | 14.1148 | 14.6556 | 14.6556 | leakage=0 |
| 6 | undefined | SKIP | — | — | — | Mem0 has no scope merge API — would require manual copy + delete on user_id boundary |
| 7 | undefined | SKIP | — | — | — | Mem0 has no temporal aggregation / bucket query API — search returns flat top-k |
| 8 | undefined | SKIP | — | — | — | Mem0 has no inference review queue — all memories are trusted by default |
| 9 | Agentic mass-forget | OK | 0.0938 | 0.0977 | 0.0977 | — |
| 10 | PII redaction | OK | 0 | 0 | 0 | leakage=1, redacted=false |
| 11 | undefined | SKIP | — | — | — | Mem0 has no failure memory type — would require custom metadata, not queryable as a first-class concept |
| 12 | undefined | SKIP | — | — | — | Mem0 has no decision provenance — no alternatives, no chosen, no rationale structured fields |
| 13 | undefined | SKIP | — | — | — | Mem0 has no change/optimization history — would require custom metadata, not first-class queryable |
| 14 | undefined | SKIP | — | — | — | Mem0 has no episodic trace/replay API — closest is search by time, no chronological frame sequence |
| 15 | undefined | SKIP | — | — | — | Mem0 has no first-class principle/pattern/constraint knowledge type — all memories are flat text |
| 16 | undefined | SKIP | — | — | — | Mem0 has no typed knowledge edges (supersedes, contradicts, etc.) — graph is implicit |
| 17 | undefined | SKIP | — | — | — | Mem0 has no type-filtered unified search — only generic memory search |
| 18 | undefined | SKIP | — | — | — | Mem0 has no pre-action conflict guard API |

## Summary

- Operations executed: 5 / 18
- Operations skipped: 13 / 18
- Setup time: 1227.23s
- DB size on disk: 0.00 MB

