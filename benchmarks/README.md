# AlekhDB Benchmarks

Competitive benchmarks that run the **same agentic task** through three memory backends and rank them on identical metrics.

## What this directory contains

Each `NN-scenario-name/` subdirectory is a self-contained benchmark for one extreme use case. Every benchmark runs three memory backends through the same 14 operations on the same dataset and produces a side-by-side ranking.

| # | Scenario | What it tests |
|---|---|---|
| 01 | IDE multi-agent coding on 100K-file polyglot mono-repo | Scale, multi-language, branch fan-out, code understanding, PII redaction |
| 02 | Longitudinal EHR with HIPAA + GDPR (planned) | Privacy, bi-temporal, versioned DAG, agentic mass-forget |
| 03 | Litigation evidence graph (planned) | Bi-temporal, versioned recantations, review queue |
| 04 | Deep-space mission control (planned) | Offline, sub-ms, episodic replay |
| 05 | Game NPC civilization (planned) | Population-scale sub-ms, Ebbinghaus, versioned opinions |
| 06 | Lifelong AI companion (planned) | PII vault, episodic replay, agentic mass-forget |
| 07 | Factory predictive maintenance (planned) | Offline embedded, bi-temporal, versioned equipment |
| 08 | Customer-360 with GDPR (planned) | Mass-forget, container tags, profile buckets |
| 09 | Disaster response (planned) | Offline sub-ms, PII, episodic replay |
| 10 | Science lab notebook (planned) | Versioned hypotheses, episodic replay, retraction |

## Backends compared

For every scenario, the same operations are run on three backends:

1. **AlekhDB** — local-first, zero-dependency core, this repo
2. **Mem0** — local OSS (Postgres + Qdrant + Ollama) or cloud
3. **Supermemory** — cloud (https://supermemory.ai)

## Metrics

Every operation measures:

- **Latency**: p50, p95, p99 in milliseconds (after warmup, 1000 iterations)
- **Memory heap delta**: before/after in MB
- **DB size on disk**: in MB
- **Correctness**: recall@5, precision@5 against the expected-result set
- **Contradiction handling**: false positives / false negatives
- **Branch isolation**: leakage score (should be 0)
- **Privacy**: did the API key actually get redacted? (yes/no)

## Scoring rubric

The final ranking uses a weighted score:

- **40% latency** — the IDE hot path is the goal
- **25% correctness** — recall/precision against expected results
- **15% feature coverage** — does the backend support the operation natively (or did it have to SKIP)?
- **10% memory footprint** — heap delta + DB size
- **10% setup cost** — time to onboard the dataset

## Running a benchmark

```bash
# 1. Install dataset dependencies (only needed for the first run)
node benchmarks/01-ide-monorepo/dataset/load-vscode.js

# 2. Run all 3 backends through the 14 operations
node benchmarks/01-ide-monorepo/runner/run-all.js

# 3. Score and rank
node benchmarks/01-ide-monorepo/runner/score.js

# 4. Read the report
cat benchmarks/01-ide-monorepo/reports/04-ranking.md
```

## Per-scenario files

Each `NN-scenario-name/` follows this structure:

```
01-ide-monorepo/
  scenario.md              # the task spec — read this first
  dataset/                 # dataset loader (clones + indexes the real corpus)
  backends/                # one adapter per backend, all using _common.js
  runner/                  # the execution harness + scoring
  reports/                 # output: one report per backend + a final ranking
```

## Honest reporting

These benchmarks report **real numbers**, including when a backend is significantly slower or missing a feature. Where a backend cannot perform an operation natively, the report shows `SKIP` with a justification. The ranking is data, not opinion.

## Fairness rules

- All three backends receive the **same initial seed memories**
- All three run the **same 14 operations in the same order** with the **same warmup**
- All measurements use the same `benchmarks/01-ide-monorepo/backends/_common.js` helpers
- All reports write to `reports/0X-backend-report.md` plus a JSON `metrics.json` for machine-readable comparison
