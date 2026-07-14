// load-vscode.js — Clone microsoft/vscode and produce a deterministic seed-memory file.
//
// Output: benchmarks/01-ide-monorepo/dataset/seed-memories.json
//   { nodes: [...], edges: [...], meta: { totalFiles, languages, generatedAt } }
//
// Each seed node is a deterministic file/function/class from the cloned repo.
// Re-running with the same clone produces the same output (id hashes are stable).

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const DATASET_DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO_DIR = path.join(DATASET_DIR, "vscode");
const SEED_FILE = path.join(DATASET_DIR, "seed-memories.json");
const REPO_URL = "https://github.com/microsoft/vscode.git";
const MAX_FILES = 100000;
const LANGUAGES = {
  ".ts": "typescript",
  ".js": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".cpp": "cpp",
  ".c": "c",
  ".h": "cpp",
  ".hpp": "cpp",
  ".md": "markdown",
  ".json": "json",
};

function stableId(prefix, content) {
  return `${prefix}-${crypto.createHash("sha1").update(content).digest("hex").slice(0, 12)}`;
}

function walk(dir, acc, cap) {
  if (acc.length >= cap) return acc;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return acc;
  }
  for (const entry of entries) {
    if (acc.length >= cap) return acc;
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "out") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc, cap);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
}

function extractSymbols(filePath) {
  const ext = path.extname(filePath);
  const lang = LANGUAGES[ext];
  if (!lang) return [];
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return [];
  }
  const symbols = [];
  const classRe = /(?:class|interface|struct)\s+(\w+)/g;
  const fnRe = /(?:function|def|fn|func|void|async)\s+(\w+)\s*\(/g;
  const importRe = /(?:import|require|from|use)\s+["']?([\w./-]+)["']?/g;
  let m;
  while ((m = classRe.exec(content))) {
    symbols.push({ kind: "class", name: m[1], file: filePath });
    if (symbols.length >= 50) break;
  }
  while ((m = fnRe.exec(content))) {
    symbols.push({ kind: "function", name: m[1], file: filePath });
    if (symbols.length >= 100) break;
  }
  while ((m = importRe.exec(content))) {
    symbols.push({ kind: "import", name: m[1], file: filePath });
    if (symbols.length >= 150) break;
  }
  return symbols;
}

function ensureRepo() {
  if (fs.existsSync(path.join(REPO_DIR, ".git"))) {
    console.log(`[load-vscode] Repo already cloned at ${REPO_DIR}`);
    return;
  }
  console.log(`[load-vscode] Cloning ${REPO_URL} (this may take a few minutes)...`);
  if (process.env.BENCH_DATASET === "synthetic") {
    console.log("[load-vscode] BENCH_DATASET=synthetic — skipping clone, will generate synthetic instead");
    return;
  }
  try {
    execSync(`git clone --depth 1 ${REPO_URL} ${REPO_DIR}`, { stdio: "inherit" });
  } catch (err) {
    console.error("[load-vscode] Clone failed. Set BENCH_DATASET=synthetic to use a 10K synthetic dataset instead.");
    throw err;
  }
}

function buildSeed() {
  const useSynthetic = process.env.BENCH_DATASET === "synthetic" || !fs.existsSync(REPO_DIR);
  const fileCap = parseInt(process.env.BENCH_MAX_FILES || "10000", 10);
  const MAX_FILES_RUNTIME = Math.min(MAX_FILES, fileCap);
  const nodes = [];
  const edges = [];
  const langCounts = {};
  let files = [];

  if (useSynthetic) {
    console.log("[load-vscode] Building 10K synthetic files...");
    const langs = Object.values(LANGUAGES).filter(l => l !== "markdown" && l !== "json");
    for (let i = 0; i < 10000; i++) {
      const lang = langs[i % langs.length];
      const ext = Object.keys(LANGUAGES).find(k => LANGUAGES[k] === lang);
      const filePath = `synthetic/src/${lang}/module_${i}.${ext}`;
      const id = stableId("file", filePath);
      nodes.push({
        id, label: `module_${i}`, type: "file", memoryType: "note",
        properties: { language: lang, synthetic: true, path: filePath },
        createdAt: new Date(Date.now() - (10000 - i) * 60000).toISOString(),
      });
      if (i % 10 === 0) {
        const cls = `Class${i}`;
        const clsId = stableId("class", cls + i);
        nodes.push({
          id: clsId, label: cls, type: "class", memoryType: "note",
          properties: { fileId: id, language: lang },
          createdAt: new Date(Date.now() - (10000 - i) * 60000).toISOString(),
        });
        edges.push({ id: stableId("e", id + clsId), source: id, target: clsId, label: "defines", weight: 1.0, active: true, properties: {} });
      }
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    }
  } else {
    console.log("[load-vscode] Walking repo...");
    files = walk(REPO_DIR, [], MAX_FILES_RUNTIME);
    console.log(`[load-vscode] Found ${files.length} files (cap=${MAX_FILES_RUNTIME}). Extracting symbols...`);
    for (let i = 0; i < files.length; i++) {
      const fp = files[i];
      const ext = path.extname(fp);
      const lang = LANGUAGES[ext];
      if (!lang) continue;
      langCounts[lang] = (langCounts[lang] || 0) + 1;
      const relPath = path.relative(REPO_DIR, fp);
      const fileId = stableId("file", relPath);
      nodes.push({
        id: fileId, label: path.basename(fp), type: "file", memoryType: "note",
        properties: { language: lang, path: relPath },
        createdAt: new Date(Date.now() - (files.length - i) * 1000).toISOString(),
      });
      const symbols = extractSymbols(fp);
      for (const sym of symbols) {
        const symId = stableId(sym.kind, sym.name + sym.file);
        if (nodes.some(n => n.id === symId)) continue;
        nodes.push({
          id: symId, label: sym.name, type: sym.kind, memoryType: "note",
          properties: { fileId, file: relPath, language: lang },
          createdAt: new Date(Date.now() - (files.length - i) * 1000).toISOString(),
        });
        edges.push({
          id: stableId("e", fileId + symId), source: fileId, target: symId, label: "defines",
          weight: 1.0, active: true, properties: {},
        });
      }
    }
  }

  const seed = {
    nodes,
    edges,
    meta: {
      totalFiles: files.length,
      languages: langCounts,
      generatedAt: new Date().toISOString(),
      synthetic: useSynthetic,
    },
  };
  fs.writeFileSync(SEED_FILE, JSON.stringify(seed));
  console.log(`[load-vscode] Wrote ${nodes.length} nodes + ${edges.length} edges to ${SEED_FILE}`);
  console.log(`[load-vscode] Languages:`, langCounts);
}

ensureRepo();
buildSeed();
