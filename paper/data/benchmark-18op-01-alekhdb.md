# Backend Report — 01-alekhdb

Generated at: 2026-07-15T04:07:07.276Z
Local-first, zero-dep, sub-ms core. Uses AlekhDB v2 with all Phase 1-8 features.

## Per-operation results

| # | Op | Status | p50 (ms) | p95 (ms) | p99 (ms) | Notes |
|---|---|---|---|---|---|---|
| 1 | Add a fact across branches | OK | 0.2149 | 0.2698 | 0.6187 | — |
| 2 | Semantic search | OK | 0.66 | 0.7426 | 0.9732 | recall@5=0.6, returned=171 |
| 3 | Multi-hop graph traversal | OK | 0.1993 | 0.2076 | 0.2393 | returned=5 |
| 4 | Token-budget context packing | OK | 11.1284 | 11.7765 | 12.445 | returned=0 |
| 5 | Branch isolation (add contradicting fact) | OK | 0.2114 | 0.2782 | 0.6651 | leakage=0 |
| 6 | Cross-scope merge | OK | 8.213 | 10.6564 | 13.2729 | returned=11771 |
| 7 | Temporal evolution query | OK | 7.2079 | 8.1847 | 9.0403 | returned=5 |
| 8 | Inference review queue | OK | 0.057792000000063126 | 0.057792000000063126 | 0.057792000000063126 | returned=1 |
| 9 | Agentic mass-forget | OK | 0.0199 | 0.0456 | 0.0456 | — |
| 10 | PII redaction | OK | 0.2539 | 0.5382 | 0.8783 | redacted=false |
| 11 | Failure memory | OK | 0.3019 | 0.3103 | 0.315 | — |
| 12 | Decision provenance | OK | 0.2218 | 0.3096 | 0.6256 | — |
| 13 | Optimization history | OK | 0.227 | 0.3906 | 0.611 | — |
| 14 | Episodic trace + replay | OK | 0.0004 | 0.0004 | 0.0013 | returned=2 |
| 15 | Add a knowledge principle | OK | 0.2417 | 0.2564 | 0.5006 | — |
| 16 | Add supersedes edge | OK | 0.0037 | 0.0048 | 0.017 | — |
| 17 | Unified knowledge search | OK | 1.0631 | 2.1605 | 3.9702 | returned=3 |
| 18 | Pre-action conflict guard | OK | 1.1128 | 1.3454 | 1.4934 | returned=1 |

## Summary

- Operations executed: 18 / 18
- Operations skipped: 0 / 18
- Setup time: 0.25s
- DB size on disk: 0.00 MB

