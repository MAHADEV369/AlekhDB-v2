#!/usr/bin/env python3
"""
load-vscode.py — Python variant of the dataset loader for mem0ai SDK.

Mirrors load-vscode.js but writes a JSONL file (one memory per line) that
mem0ai's add() method can ingest via the standard `messages` format.

Output: benchmarks/01-ide-monorepo/dataset/seed-memories.jsonl
  Each line: {"messages": [{"role": "user", "content": "<memory text>"}], "user_id": "<agent-branch>"}

Usage:
  pip install mem0ai
  python benchmarks/01-ide-monorepo/dataset/load-vscode.py
"""

import json
import os
import subprocess
import sys
from pathlib import Path

DATASET_DIR = Path(__file__).parent
REPO_DIR = DATASET_DIR / "vscode"
SEED_FILE = DATASET_DIR / "seed-memories.jsonl"
REPO_URL = "https://github.com/microsoft/vscode.git"
MAX_FILES = 100_000
LANGUAGES = {
    ".ts": "typescript", ".js": "javascript", ".py": "python",
    ".rs": "rust", ".go": "go", ".java": "java",
    ".cpp": "cpp", ".c": "c", ".h": "cpp", ".hpp": "cpp",
}
BRANCHES = ["branch:feat/auth", "branch:feat/payments", "branch:feat/search", "branch:feat/infra"]


def ensure_repo():
    if (REPO_DIR / ".git").exists():
        print(f"[load-vscode.py] Repo already cloned at {REPO_DIR}")
        return
    print(f"[load-vscode.py] Cloning {REPO_URL}...")
    if os.environ.get("BENCH_DATASET") == "synthetic":
        print("[load-vscode.py] BENCH_DATASET=synthetic — skipping clone")
        return
    try:
        subprocess.run(["git", "clone", "--depth", "1", REPO_URL, str(REPO_DIR)], check=True)
    except subprocess.CalledProcessError:
        print("Clone failed. Set BENCH_DATASET=synthetic to use a 10K synthetic dataset instead.")
        raise


def walk(dir_path: Path, acc: list, limit: int = MAX_FILES):
    if len(acc) >= limit:
        return acc
    try:
        entries = list(dir_path.iterdir())
    except (PermissionError, FileNotFoundError):
        return acc
    for entry in entries:
        if len(acc) >= limit:
            return acc
        if entry.name in (".git", "node_modules", "out"):
            continue
        if entry.is_dir():
            walk(entry, acc, limit)
        elif entry.is_file():
            acc.append(entry)
    return acc


def build_seed():
    use_synthetic = os.environ.get("BENCH_DATASET") == "synthetic" or not REPO_DIR.exists()
    files = []
    if use_synthetic:
        print("[load-vscode.py] Building 10K synthetic files...")
        langs = [l for l in set(LANGUAGES.values()) if l not in ("markdown", "json")]
        for i in range(10000):
            lang = langs[i % len(langs)]
            ext = next(k for k, v in LANGUAGES.items() if v == lang)
            files.append((f"synthetic/src/{lang}/module_{i}{ext}", lang, f"module_{i}"))
    else:
        print("[load-vscode.py] Walking repo...")
        files_paths = walk(REPO_DIR, [])
        print(f"[load-vscode.py] Found {len(files_paths)} files")
        for fp in files_paths[:MAX_FILES]:
            ext = fp.suffix
            lang = LANGUAGES.get(ext)
            if not lang:
                continue
            rel = str(fp.relative_to(REPO_DIR))
            files.append((rel, lang, fp.stem))

    lang_counts = {}
    branch_idx = 0
    with open(SEED_FILE, "w") as f:
        for i, (rel_path, lang, name) in enumerate(files):
            lang_counts[lang] = lang_counts.get(lang, 0) + 1
            branch = BRANCHES[branch_idx % len(BRANCHES)]
            branch_idx += 1
            memory_text = f"File: {rel_path} | Language: {lang} | Stem: {name}"
            entry = {
                "messages": [{"role": "user", "content": memory_text}],
                "user_id": branch,
            }
            f.write(json.dumps(entry) + "\n")

    print(f"[load-vscode.py] Wrote {len(files)} memories to {SEED_FILE}")
    print(f"[load-vscode.py] Languages: {lang_counts}")


if __name__ == "__main__":
    ensure_repo()
    build_seed()
