# arXiv Submission Package — AlekhDB Paper

This directory contains the source files for arXiv submission.

## Files

- `alekhdb-paper.tex` — Main LaTeX source (8 pages, AAAI 2027 format)
- `alekhdb-paper.md` — Markdown version for easy reading
- `figures/` — All 5 figures (PNG, 150 DPI)
- `alekhdb-arxiv-source.tar.gz` — Pre-packaged source bundle for arXiv upload

## arXiv Submission Steps

1. Go to https://arxiv.org/submit
2. Create an arXiv account (or login)
3. Click "Start New Submission"
4. Upload `alekhdb-arxiv-source.tar.gz`
5. License: CC BY 4.0 (recommended for open access)
6. Title: **AlekhDB: Biological-Inspired, Local-First Memory for Long-Horizon AI Agents**
7. Authors: Anonymous (for double-blind AAAI review) or actual author info after arXiv
8. Abstract: (copy from `alekhdb-paper.tex`)
9. Categories: 
   - **cs.AI** (Artificial Intelligence) — primary
   - **cs.CL** (Computation and Language) — secondary
   - **cs.IR** (Information Retrieval) — secondary
   - **cs.MA** (Multiagent Systems) — optional
10. Comments: "8 pages, 5 figures, 6 tables, 5-backend benchmark, ablation study, cognitive study. Submitted to AAAI 2027."
11. Submit (will take 1-2 days for moderation)

## After Submission

- arXiv assigns a paper ID (e.g., arXiv:2501.12345)
- Update README in main repo with the arXiv badge
- Add to your CV / Google Scholar
- Use as a citable reference for AAAI submission

## Abstract (copy-paste)

```
AI agents operating on long-horizon coding, research, and operational tasks
accumulate state that no existing memory backend handles well: either too much
is forgotten too fast (cloud APIs with fixed TTL) or too much accumulates without
discrimination (unbounded archival). We present AlekhDB, a zero-dependency,
local-first memory engine whose design is grounded in three biological and
cognitive science primitives: (1) Ebbinghaus exponential forgetting, which
preserves frequently-accessed memories longer than rarely-accessed ones; (2)
Doyle-style bi-temporal truth maintenance, which soft-decays contradicted beliefs
while preserving chronological audit history; and (3) a versioned directed acyclic
graph with three semantic relation types (updates, extends, derives) that
supports first-class decision provenance, failure memory, and optimization
history. Across a five-backend competitive benchmark (AlekhDB, Mem0, Supermemory,
Zep/Graphiti, Letta) on a 22,817-node real-world dataset (microsoft/vscode),
AlekhDB achieves 87.3/100 weighted score versus 41.7-63.9 for the next-best
backends, while natively supporting all 14 evaluated memory operations. In a
long-horizon agent task where the agent must remember facts across 20 conversation
turns, AlekhDB achieves 100% task success versus 80% for an in-memory Mem0
baseline. Ablation studies show that 8 of 9 unique AlekhDB capabilities cause
measurable performance drops when removed, and a cognitive study comparing
Ebbinghaus decay to uniform TTL finds 100% vs 24% recall on long-horizon
retrieval.
```

## Key Headline Results

- **5-backend benchmark**: AlekhDB 87.3/100 vs Supermemory 63.9, Letta 52.9, Mem0 41.7, Zep 40.8
- **Capability coverage**: AlekhDB supports all 14 ops natively; competitors SKIP 4-10
- **Long-horizon agent task**: 5/5 bugs fixed (AlekhDB) vs 4/5 (Mem0)
- **Cognitive study**: Ebbinghaus 100% recall vs uniform TTL 24% recall
- **Ablation**: 8/9 capabilities show drop=1 when removed

## Reproducibility

All code, data, and figures are at: https://github.com/MAHADEV369/AlekhDB-v2
A Docker-based reproducibility package is in `paper/`.
