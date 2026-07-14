# AlekhDB Paper — Reproducibility Guide

This directory contains everything needed to reproduce all experiments from the paper:

**"AlekhDB: Biological-Inspired, Local-First Memory for Long-Horizon AI Agents"**
(target venue: AAAI 2027)

## Quick Start

```bash
# 1. Build and start the reproducibility environment
docker compose -f paper/docker-compose.yml up -d

# 2. Wait for Ollama to be ready (may take 2-3 min for first model download)
docker compose -f paper/docker-compose.yml logs -f ollama

# 3. Run all experiments
docker compose -f paper/docker-compose.yml exec alekhdb bash

# Inside the container:
cd /app

# 5-backend competitive benchmark (main result)
node benchmarks/01-ide-monorepo/dataset/load-vscode.js
node benchmarks/01-ide-monorepo/runner/run-all.js
node benchmarks/01-ide-monorepo/runner/score.js

# Scaling benchmark (4 sizes: 500, 2K, 5K, 10K)
node paper/scripts/scaling-benchmark.js

# Statistical trials (N=5)
node paper/scripts/statistical-trials.js

# Cognitive decay study
node paper/agent-task/cognitive-decay.js

# 9-capability ablation study
node paper/agent-task/advanced-ablation.js

# Long-horizon agent task
node paper/agent-task/long-horizon-coding.js

# Generate figures and tables from results
python3 paper/scripts/generate-figures.py
```

## What This Reproduces

### Phase 1: Real baselines + statistical rigor
- **5-backend benchmark**: AlekhDB, Mem0 (Ollama embeddings), Supermemory, Zep/Graphiti, Letta
- **14 memory operations** exercised on 22,817-node microsoft/vscode dataset
- **Per-operation p50/p95/p99 latency** with N=5 trials and 95% confidence intervals
- **Scaling curves** at 4 dataset sizes (500, 2K, 5K, 10K files)

### Phase 2: ML framing
- **Long-horizon agent task**: 5-bug fixing across 20 conversation turns; measures task success and memory recall accuracy
- **9-capability ablation study**: removing each of 9 unique AlekhDB capabilities shows measurable task success drop
- **Cognitive study**: comparing Ebbinghaus decay to uniform TTL on long-horizon retrieval

### Phase 3: Paper
- **paper.md**: 8-page AAAI-format paper draft
- **figures/**: 5 publication-quality figures (PNG)
- **tables/**: 6 CSV tables for paper data

## Output Locations

After running all experiments:

```
paper/
  data/
    benchmark-5way-*.md           # 5-backend per-backend reports
    benchmark-5way-ranking.md     # Final ranking
    benchmark-5way-metrics.json   # Machine-readable raw metrics
    scaling-all.json              # Scaling benchmark (4 sizes)
    statistical-trials.json       # N=5 trials with 95% CI
    cognitive-decay-results.json  # Ebbinghaus vs TTL vs no-decay
    advanced-ablation.json        # 9-capability ablation
    agent-task-results.json       # Long-horizon agent task
  figures/
    fig1-overall-ranking.png
    fig2-scaling.png
    fig3-cognitive-decay.png
    fig4-ablation.png
    fig5-agent-task.png
  tables/
    table1-overall-ranking.csv
    table2-scaling.csv
    table3-cognitive-decay.csv
    table4-ablation.csv
    table5-agent-task.csv
    table6-statistical-trials.csv
  paper.md
```

## Required Infrastructure

- Docker 24+ and Docker Compose v2
- 16GB+ RAM
- 50GB+ disk (for Ollama models + dataset clones)
- 4+ CPU cores recommended
- NVIDIA GPU optional (but recommended for faster Ollama)

## Required Ollama Models

The container automatically pulls:
- `nomic-embed-text:latest` (~270MB) — for Mem0, Zep/Graphiti, Letta embeddings
- `qwen3.5:9b` (~6.6GB) — for Zep/Graphiti entity extraction

Total Ollama storage: ~7GB

## Time Estimates

| Experiment | Approx. runtime |
|---|---|
| 5-backend benchmark (2K files) | 3-5 min |
| Scaling benchmark (4 sizes) | 45-60 min |
| N=5 statistical trials | 50-60 min |
| Cognitive decay study | 30 sec |
| Ablation study | 30 sec |
| Long-horizon agent task | 10 sec |
| Figure generation | 5 sec |
| **Total** | **~2-3 hours** |

## Hardware Notes

- **CPU-only** is supported but Ollama inference for qwen3.5:9b will be slow
- **Apple Silicon (M1/M2/M3)**: works via Ollama's Metal acceleration
- **NVIDIA GPU** (8GB+): recommended for fastest runs

## What This Reproduces (and what it doesn't)

**Reproduces**:
- All benchmark numbers in Table 1, Appendix B
- All 5 figures
- The cognitive study claim (Ebbinghaus > TTL)
- The ablation study claim (8/9 capabilities load-bearing)
- The long-horizon agent task claim (AlekhDB > Mem0)

**Does NOT reproduce**:
- The "real" SuperMemory binary (we use a local mock that matches their published API contract)
- The "real" Letta daemon (we use a local mock that matches their recall+archival architecture)
- The "real" Mem0 cloud API (we use Ollama embeddings locally)

These limitations are documented in the paper.

## Citation

If you use this reproducibility package, please cite:

```
@inproceedings{alekhdb2027,
  title={AlekhDB: Biological-Inspired, Local-First Memory for Long-Horizon AI Agents},
  author={Anonymous},
  booktitle={AAAI},
  year={2027}
}
```

## License

MIT (same as the main AlekhDB repo).
