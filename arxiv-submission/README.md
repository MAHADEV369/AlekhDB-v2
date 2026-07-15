# arXiv Submission Package — AlekhDB Paper (v2)

This directory contains the source files for arXiv submission of:

**"AlekhDB: An Experience Knowledge Graph for Multi-Agent AI Memory"** (target venue: AAAI 2027)

## What changed from v1

- **Title**: Now leads with "Experience Knowledge Graph" (the largest feature in the repo)
- **Abstract**: Updated to lead with multi-agent consistency and the 4 Experience Knowledge Graph operations
- **3-layer memory model**: Reasoning Memory + Experience Knowledge Graph + Forgetting
- **6 typed knowledge edges** documented: supersedes, contradicts, supports, dependsOn, appliesTo, triggers
- **5 typed knowledge nodes** documented: principle, pattern, constraint, tactic, observation
- **2 multi-agent mechanisms**: `checkConflict()` pre-action guard + `scanKnowledgeEdgeConflicts()` async scan
- **18-operation benchmark** (was 14): adds ops 15-18 for the knowledge graph
- **Multi-agent conflict study**: `checkConflict()` prevents 92% of cross-agent conflicts
- **Stale numbers updated**: LOC=2,379, MCP=24 tools, REST=53 endpoints, CLI=49 commands
- **Broader Impact section**: AAAI requirement

## Headline results (18-op benchmark)

- **AlekhDB**: 84.7/100 weighted score, all 18 ops native
- **Supermemory**: 59.3, 12/18 ops
- **Letta**: 50.1, 7/18 ops
- **Mem0**: 41.1, 5/18 ops
- **Zep/Graphiti**: 37.9, 4/18 ops

AlekhDB is the **only** backend that supports the 4 Experience Knowledge Graph operations (15-18).

## Files

- `alekhdb-paper.tex` — Main LaTeX source (8 pages, AAAI 2027 format)
- `alekhdb-paper.md` — Markdown version for easy reading
- `figures/` — 6 publication-quality figures (PNG, 150 DPI):
  - `fig1-overall-ranking.png` — 5-backend weighted scores
  - `fig2-scaling.png` — Latency vs dataset size (log scale)
  - `fig3-cognitive-decay.png` — Ebbinghaus vs TTL vs no-decay
  - `fig4-ablation.png` — Removing each of 9 unique capabilities
  - `fig5-agent-task.png` — Long-horizon agent task
  - `fig6-knowledge-graph.png` — **NEW**: 4 Experience KG operations only AlekhDB supports

## arXiv Submission Steps

1. Go to https://arxiv.org/submit
2. Create an arXiv account (or login)
3. Click "Start New Submission"
4. Upload `alekhdb-arxiv-source.tar.gz` (created below)
5. License: CC BY 4.0
6. Title: **AlekhDB: An Experience Knowledge Graph for Multi-Agent AI Memory**
7. Authors: Anonymous (for double-blind AAAI review)
8. Abstract: (copy from `alekhdb-paper.tex`)
9. Categories:
   - **cs.AI** (Artificial Intelligence) — primary
   - **cs.CL** (Computation and Language) — secondary
   - **cs.IR** (Information Retrieval) — secondary
10. Comments: "8 pages, 6 figures, 7 tables, 18-operation benchmark, multi-agent consistency study, AAAI 2027 submission."

## Build the tarball

```bash
cd arxiv-submission
tar -czf alekhdb-arxiv-source.tar.gz alekhdb-paper.tex alekhdb-paper.md figures/
```

## Abstract (copy-paste)

```
What makes a 15-year engineer irreplaceable is not raw knowledge of APIs—it
is the accumulated experience of how things break, which fixes stick, and
which patterns to apply in which contexts. We argue that this experience is
exactly what AI agents lack, and that current memory backends are not
designed to capture or share it. We present AlekhDB, a zero-dependency,
local-first memory engine that organizes an agent's evolving experience as
a typed knowledge graph with three layers: (1) the Reasoning Memory Layer
storing first-class decision, failure, and change memories with provenance
and alternatives; (2) the Experience Knowledge Graph Layer storing 5
typed knowledge nodes (principle, pattern, constraint, tactic, observation)
and 6 typed edges (supersedes, contradicts, supports, dependsOn, appliesTo,
triggers); and (3) the Forgetting Layer implementing Ebbinghaus
biological decay with bi-temporal truth maintenance. A unified
searchKnowledge() API and a checkConflict() pre-action guard enable
multi-agent consistency: when 4 agents work in parallel on the same
codebase, the consolidator's scanKnowledgeEdgeConflicts() detects
cross-scope contradictions before they become bugs. Across a five-backend
competitive benchmark (AlekhDB, Mem0, Supermemory, Zep/Graphiti, Letta)
on a 22,817-node real-world dataset (microsoft/vscode), AlekhDB achieves
84.7/100 weighted score and natively supports all 18 evaluated memory
operations. In a multi-agent long-horizon coding task, AlekhDB's
checkConflict() prevents 92% of cross-agent conflicts that the same agents
produce without it. Ablation shows that all 4 Experience Knowledge Graph
operations are load-bearing—removing any of them causes measurable task
success drops.
```

## Key contributions

1. **Experience Knowledge Graph model**: typed knowledge nodes (principle, pattern, constraint, tactic, observation) + typed edges (supersedes, contradicts, supports, dependsOn, appliesTo, triggers)
2. **Multi-agent consistency**: `checkConflict()` pre-action guard prevents 92% of cross-agent conflicts
3. **Biology-grounded forgetting**: Ebbinghaus decay + bi-temporal TMS
4. **Reproducible evaluation**: 5 backends, N=5 trials, scaling curves, Docker package

## Reproducibility

All code, data, and figures are at: https://github.com/MAHADEV369/AlekhDB-v2
A Docker-based reproducibility package is in `paper/`.

```bash
docker compose -f paper/docker-compose.yml up -d
docker compose -f paper/docker-compose.yml exec alekhdb bash

# Inside the container:
node benchmarks/01-ide-monorepo/dataset/load-vscode.js
node benchmarks/01-ide-monorepo/runner/run-all.js
node benchmarks/01-ide-monorepo/runner/score.js
node paper/scripts/scaling-benchmark.js
node paper/scripts/statistical-trials.js
node paper/agent-task/cognitive-decay.js
node paper/agent-task/advanced-ablation.js
node paper/agent-task/long-horizon-coding.js
python3 paper/scripts/generate-figures.py
```

## License

MIT (same as the main AlekhDB repo).
