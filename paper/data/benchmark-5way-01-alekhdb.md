# Backend Report — 01-alekhdb

Generated at: 2026-07-14T18:48:30.444Z
Local-first, zero-dep, sub-ms core. Uses AlekhDB v2 with all Phase 1-8 features.

## Per-operation results

| # | Op | Status | p50 (ms) | p95 (ms) | p99 (ms) | Notes |
|---|---|---|---|---|---|---|
| 1 | Add a fact across branches | OK | 0.0955 | 0.1238 | 0.186 | — |
| 2 | Semantic search | OK | 0.1363 | 0.1614 | 0.1627 | recall@5=0.6, returned=35 |
| 3 | Multi-hop graph traversal | OK | 0.0782 | 0.0867 | 0.0909 | returned=5 |
| 4 | Token-budget context packing | OK | 3.9172 | 4.2779 | 4.3931 | returned=0 |
| 5 | Branch isolation (add contradicting fact) | OK | 0.0748 | 0.116 | 0.2328 | leakage=0 |
| 6 | Cross-scope merge | OK | 2.3689 | 3.6255 | 4.5904 | returned=4259 |
| 7 | Temporal evolution query | OK | 2.351 | 2.8711 | 3.6583 | returned=5 |
| 8 | Inference review queue | OK | 0.05479199999990669 | 0.05479199999990669 | 0.05479199999990669 | returned=1 |
| 9 | Agentic mass-forget | OK | 0.0182 | 0.0346 | 0.0346 | — |
| 10 | PII redaction | OK | 0.0869 | 0.2377 | 0.5636 | redacted=false |
| 11 | Failure memory | OK | 0.1048 | 0.1064 | 0.1098 | — |
| 12 | Decision provenance | OK | 0.0983 | 0.1071 | 0.3995 | — |
| 13 | Optimization history | OK | 0.1004 | 0.142 | 0.4571 | — |
| 14 | Episodic trace + replay | OK | 0.0004 | 0.0004 | 0.001 | returned=2 |

## Summary

- Operations executed: 14 / 14
- Operations skipped: 0 / 14
- Setup time: 0.08s
- DB size on disk: 0.00 MB

