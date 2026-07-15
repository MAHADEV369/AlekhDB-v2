"""
Generate figures and tables for the paper from the collected data.

Outputs:
  paper/figures/fig1-overall-ranking.png
  paper/figures/fig2-scaling.png
  paper/figures/fig3-cognitive-decay.png
  paper/figures/fig4-ablation.png
  paper/figures/fig5-agent-task.png
  paper/figures/fig6-knowledge-graph.png (NEW)
  paper/tables/table1-overall-ranking.csv
  paper/tables/table2-scaling.csv
  paper/tables/table3-cognitive-decay.csv
  paper/tables/table4-ablation.csv
  paper/tables/table5-agent-task.csv
  paper/tables/table6-statistical-trials.csv
  paper/tables/table7-knowledge-graph.csv (NEW)
"""

import json
import os
import matplotlib.pyplot as plt
import numpy as np

PAPER_DIR = os.path.join(os.path.dirname(__file__), "..")
FIG_DIR = os.path.join(PAPER_DIR, "figures")
TBL_DIR = os.path.join(PAPER_DIR, "tables")
DATA_DIR = os.path.join(PAPER_DIR, "data")
os.makedirs(FIG_DIR, exist_ok=True)
os.makedirs(TBL_DIR, exist_ok=True)

# Set matplotlib style
plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 10,
    "axes.spines.top": False,
    "axes.spines.right": False,
})

# === Load all data ===
# Prefer the 18-op benchmark if available, fall back to 5-way
metrics_file = "benchmark-18op-metrics.json" if os.path.exists(os.path.join(DATA_DIR, "benchmark-18op-metrics.json")) else "benchmark-5way-metrics.json"
with open(os.path.join(DATA_DIR, metrics_file)) as f:
    metrics = json.load(f)
with open(os.path.join(DATA_DIR, "scaling-all.json")) as f:
    scaling = json.load(f)
with open(os.path.join(DATA_DIR, "statistical-trials.json")) as f:
    trials = json.load(f)
with open(os.path.join(DATA_DIR, "cognitive-decay-results.json")) as f:
    cognitive = json.load(f)
with open(os.path.join(DATA_DIR, "advanced-ablation.json")) as f:
    ablation = json.load(f)
with open(os.path.join(DATA_DIR, "agent-task-results.json")) as f:
    agent_task = json.load(f)

TOTAL_OPS = max(len(metrics[b].get("results", [])) for b in metrics)

BACKEND_NAMES = {
    "01-alekhdb": "AlekhDB",
    "02-mem0": "Mem0",
    "03-supermemory": "Supermemory",
    "04-zep-graphiti": "Zep/Graphiti",
    "05-letta": "Letta",
}

# === Figure 1: Overall Ranking Bar Chart ===
def fig1_overall_ranking():
    backends = list(metrics.keys())
    scores = []
    ok_counts = []
    skip_counts = []
    for b in backends:
        ok = sum(1 for r in metrics[b]["results"] if r.get("status") == "OK")
        skip = sum(1 for r in metrics[b]["results"] if r.get("status") == "SKIP")
        ok_counts.append(ok)
        skip_counts.append(skip)
        isFallback = metrics[b].get("extras", {}).get("isFallback", False)
        coverage = ok / TOTAL_OPS * 100
        ok_results = [r for r in metrics[b]["results"] if r.get("status") == "OK"]
        latencies = [r.get("metrics", {}).get("p50", 0) for r in ok_results if r.get("metrics", {}).get("p50")]
        recalls = [r.get("metrics", {}).get("recall", 0) for r in ok_results if r.get("metrics", {}).get("recall")]
        avg_lat = sum(latencies) / len(latencies) if latencies else 0
        avg_recall = sum(recalls) / len(recalls) if recalls else 0
        latency_score = max(0, 100 - np.log10(avg_lat + 1) * 30) if avg_lat > 0 else 0
        correctness_score = avg_recall * 100
        features_score = coverage
        db_size = metrics[b].get("extras", {}).get("dbSizeMB", 0)
        footprint_score = 100 - min(100, db_size * 2)
        setup_ms = metrics[b].get("extras", {}).get("setupTimeMs", 0)
        setup_score = max(0, 100 - setup_ms / 1000)
        fallback_penalty = 50 if isFallback else 0
        total = max(0, (
            latency_score * 0.40 +
            correctness_score * 0.25 +
            features_score * 0.15 +
            footprint_score * 0.10 +
            setup_score * 0.10
        ) - fallback_penalty)
        scores.append(round(total, 1))
    fig, ax = plt.subplots(figsize=(8, 4.5))
    colors = ["#2E7D32", "#1976D2", "#F57C00", "#C62828", "#6A1B9A"]
    bars = ax.bar([BACKEND_NAMES[b] for b in backends], scores, color=colors)
    for bar, score, ok, skip in zip(bars, scores, ok_counts, skip_counts):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1,
                f"{score}\n({ok}/{TOTAL_OPS} OK)", ha="center", va="bottom", fontsize=9)
    ax.set_ylabel("Weighted Score (0-100)")
    ax.set_title(f"Overall Ranking: 5-Backend Memory Benchmark\n(22,817-node microsoft/vscode dataset, {TOTAL_OPS} operations)")
    ax.set_ylim(0, 110)
    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "fig1-overall-ranking.png"), dpi=150, bbox_inches="tight")
    plt.close()
    # CSV
    with open(os.path.join(TBL_DIR, "table1-overall-ranking.csv"), "w") as f:
        f.write("backend,score,ops_ok,ops_skip,ops_total\n")
        for b, s, ok, skip in zip(backends, scores, ok_counts, skip_counts):
            f.write(f"{BACKEND_NAMES[b]},{s},{ok},{skip},{TOTAL_OPS}\n")
    print(f"  fig1-overall-ranking.png + table1 saved")

# === Figure 2: Scaling ===
def fig2_scaling():
    sizes = ["500", "2000", "5000", "10000"]
    if not all(s in scaling["sizes"] for s in sizes):
        print("  Not all sizes in scaling data, skipping")
        return
    # Get AlekhDB add and search p50 at each size
    alekhdb_add = []
    alekhdb_search = []
    mem0_add = []
    mem0_search = []
    for s in sizes:
        bd = scaling["sizes"][s]["backends"].get("01-alekhdb", {})
        results = {r["op"]: r for r in bd.get("results", []) if r.get("status") == "OK"}
        alekhdb_add.append(results.get(1, {}).get("metrics", {}).get("p50", 0))
        alekhdb_search.append(results.get(2, {}).get("metrics", {}).get("p50", 0))
        bd = scaling["sizes"][s]["backends"].get("02-mem0", {})
        results = {r["op"]: r for r in bd.get("results", []) if r.get("status") == "OK"}
        mem0_add.append(results.get(1, {}).get("metrics", {}).get("p50", 0))
        mem0_search.append(results.get(2, {}).get("metrics", {}).get("p50", 0))
    x = np.arange(len(sizes))
    width = 0.35
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.5))
    ax1.bar(x - width/2, alekhdb_add, width, label="AlekhDB", color="#2E7D32")
    ax1.bar(x + width/2, mem0_add, width, label="Mem0 (Ollama)", color="#1976D2")
    ax1.set_yscale("log")
    ax1.set_ylabel("p50 latency (ms, log scale)")
    ax1.set_title("Add operation scaling")
    ax1.set_xticks(x)
    ax1.set_xticklabels([f"{s}\nfiles" for s in sizes])
    ax1.legend()
    ax2.bar(x - width/2, alekhdb_search, width, label="AlekhDB", color="#2E7D32")
    ax2.bar(x + width/2, mem0_search, width, label="Mem0 (Ollama)", color="#1976D2")
    ax2.set_yscale("log")
    ax2.set_ylabel("p50 latency (ms, log scale)")
    ax2.set_title("Semantic search scaling")
    ax2.set_xticks(x)
    ax2.set_xticklabels([f"{s}\nfiles" for s in sizes])
    ax2.legend()
    plt.suptitle("Scaling: AlekhDB vs Mem0 (log scale)")
    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "fig2-scaling.png"), dpi=150, bbox_inches="tight")
    plt.close()
    with open(os.path.join(TBL_DIR, "table2-scaling.csv"), "w") as f:
        f.write("size_files,alekhdb_add_p50,alekhdb_search_p50,mem0_add_p50,mem0_search_p50\n")
        for i, s in enumerate(sizes):
            f.write(f"{s},{alekhdb_add[i]:.3f},{alekhdb_search[i]:.3f},{mem0_add[i]:.3f},{mem0_search[i]:.3f}\n")
    print(f"  fig2-scaling.png + table2 saved")

# === Figure 3: Cognitive Decay ===
def fig3_cognitive_decay():
    strategies = [r["strategy"] for r in cognitive["results"]]
    recalls = [r["avgRecall"] * 100 for r in cognitive["results"]]
    fig, ax = plt.subplots(figsize=(7, 4.5))
    colors = ["#2E7D32", "#C62828", "#6A1B9A"]
    bars = ax.bar(strategies, recalls, color=colors)
    for bar, recall in zip(bars, recalls):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1,
                f"{recall:.0f}%", ha="center", va="bottom", fontsize=11, fontweight="bold")
    ax.set_ylabel("Recall accuracy (%)")
    ax.set_title("Cognitive Study: Decay Strategy vs Long-Horizon Recall\n(30 days, 300 facts, 50 retrieval tasks)")
    ax.set_ylim(0, 120)
    plt.xticks(rotation=10, ha="right")
    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "fig3-cognitive-decay.png"), dpi=150, bbox_inches="tight")
    plt.close()
    with open(os.path.join(TBL_DIR, "table3-cognitive-decay.csv"), "w") as f:
        f.write("strategy,recall_accuracy\n")
        for s, r in zip(strategies, recalls):
            f.write(f'"{s}",{r:.1f}\n')
    print(f"  fig3-cognitive-decay.png + table3 saved")

# === Figure 4: Ablation ===
def fig4_ablation():
    caps = list(ablation.keys())
    baselines = [ablation[c]["baseline"] for c in caps]
    drops = [ablation[c]["drop"] for c in caps]
    fig, ax = plt.subplots(figsize=(9, 4.5))
    x = np.arange(len(caps))
    width = 0.35
    ax.bar(x - width/2, baselines, width, label="Baseline (with capability)", color="#2E7D32")
    ax.bar(x + width/2, drops, width, label="Drop when ablated", color="#C62828")
    ax.set_xticks(x)
    ax.set_xticklabels([c.replace("-", " ") for c in caps], rotation=20, ha="right")
    ax.set_ylabel("Task success (0-1)")
    ax.set_title("Ablation Study: Removing Each of 9 Unique Capabilities")
    ax.legend()
    ax.set_ylim(0, 1.2)
    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "fig4-ablation.png"), dpi=150, bbox_inches="tight")
    plt.close()
    with open(os.path.join(TBL_DIR, "table4-ablation.csv"), "w") as f:
        f.write("capability,baseline,ablated,drop\n")
        for c, b, d in zip(caps, baselines, drops):
            f.write(f"{c},{b},{b-d},{d}\n")
    print(f"  fig4-ablation.png + table4 saved")

# === Figure 5: Agent Task ===
def fig5_agent_task():
    backends = [r["backend"] for r in agent_task["results"]]
    task_success = [r["taskSuccess"] * 100 for r in agent_task["results"]]
    recall = [r["recallAccuracy"] * 100 for r in agent_task["results"]]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 4.5))
    colors = ["#2E7D32", "#1976D2"]
    bars1 = ax1.bar(backends, task_success, color=colors)
    for bar, val in zip(bars1, task_success):
        ax1.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1,
                f"{val:.0f}%", ha="center", va="bottom", fontsize=11, fontweight="bold")
    ax1.set_ylabel("Task success (%)")
    ax1.set_title("Long-Horizon Bug Fixing: Task Success")
    ax1.set_ylim(0, 120)
    bars2 = ax2.bar(backends, recall, color=colors)
    for bar, val in zip(bars2, recall):
        ax2.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 1,
                f"{val:.0f}%", ha="center", va="bottom", fontsize=11, fontweight="bold")
    ax2.set_ylabel("Memory recall accuracy (%)")
    ax2.set_title("Long-Horizon Bug Fixing: Memory Recall")
    ax2.set_ylim(0, 100)
    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "fig5-agent-task.png"), dpi=150, bbox_inches="tight")
    plt.close()
    with open(os.path.join(TBL_DIR, "table5-agent-task.csv"), "w") as f:
        f.write("backend,task_success_pct,recall_pct,bugs_fixed,total_bugs,memory_lookups,memory_hits\n")
        for r in agent_task["results"]:
            f.write(f"{r['backend']},{r['taskSuccess']*100:.1f},{r['recallAccuracy']*100:.1f},{r['bugsFixed']},{r['totalBugs']},{r['memoryLookups']},{r['memoryHits']}\n")
    print(f"  fig5-agent-task.png + table5 saved")

# === Table 6: Statistical Trials ===
def table6_statistical_trials():
    with open(os.path.join(TBL_DIR, "table6-statistical-trials.csv"), "w") as f:
        f.write("backend,op,status,n,mean_ms,stddev_ms,ci95_ms,min_ms,max_ms\n")
        for backend_id, ops in trials["stats"].items():
            for op, s in ops.items():
                if s.get("status") == "OK":
                    f.write(f"{BACKEND_NAMES[backend_id]},{op},{s['status']},{s['n']},{s['mean']},{s['stddev']},{s['ci95']},{s['min']},{s['max']}\n")
    print(f"  table6-statistical-trials.csv saved")

# === Figure 6: Experience Knowledge Graph — 4 operations vs competitors ===
def fig6_knowledge_graph():
    if TOTAL_OPS < 18:
        print("  Not 18 ops, skipping fig6")
        return
    backends = list(metrics.keys())
    op_names = {15: "addPrinciple", 16: "addSupersedes", 17: "searchKnowledge", 18: "checkConflict"}
    fig, axes = plt.subplots(1, 4, figsize=(14, 4))
    for i, op in enumerate([15, 16, 17, 18]):
        ax = axes[i]
        names = []
        latencies = []
        colors = []
        for b in backends:
            names.append(BACKEND_NAMES[b])
            r = next((r for r in metrics[b]["results"] if r.get("op") == op), None)
            if r and r.get("status") == "OK" and r.get("metrics", {}).get("p50"):
                latencies.append(r["metrics"]["p50"])
                colors.append("#2E7D32" if b == "01-alekhdb" else "#999999")
            else:
                latencies.append(0)
                colors.append("#cccccc")
        bars = ax.bar(names, latencies, color=colors)
        for bar, lat in zip(bars, latencies):
            if lat > 0:
                ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.01,
                        f"{lat:.3f}ms", ha="center", va="bottom", fontsize=8)
            else:
                ax.text(bar.get_x() + bar.get_width() / 2, 0.05, "SKIP", ha="center", va="bottom", fontsize=8, color="gray")
        ax.set_title(f"Op {op}: {op_names[op]}", fontsize=10)
        ax.set_xticklabels(names, rotation=30, ha="right", fontsize=8)
        if i == 0:
            ax.set_ylabel("p50 latency (ms, log scale)")
        ax.set_yscale("log")
    plt.suptitle("Experience Knowledge Graph: 4 operations only AlekhDB supports (18-op benchmark)", y=1.02)
    plt.tight_layout()
    plt.savefig(os.path.join(FIG_DIR, "fig6-knowledge-graph.png"), dpi=150, bbox_inches="tight")
    plt.close()
    with open(os.path.join(TBL_DIR, "table7-knowledge-graph.csv"), "w") as f:
        f.write("operation,alekhdb_p50_ms,mem0,supermemory,zep_graphiti,letta\n")
        for op in [15, 16, 17, 18]:
            row = [op_names[op]]
            for b in backends:
                r = next((r for r in metrics[b]["results"] if r.get("op") == op), None)
                if r and r.get("status") == "OK" and r.get("metrics", {}).get("p50"):
                    row.append(f"{r['metrics']['p50']:.4f}")
                else:
                    row.append("SKIP")
            f.write(",".join(row) + "\n")
    print(f"  fig6-knowledge-graph.png + table7 saved")

# === Generate everything ===
fig1_overall_ranking()
fig2_scaling()
fig3_cognitive_decay()
fig4_ablation()
fig5_agent_task()
fig6_knowledge_graph()
table6_statistical_trials()
print("\nAll figures and tables generated successfully.")
print(f"Figures: {FIG_DIR}")
print(f"Tables: {TBL_DIR}")
