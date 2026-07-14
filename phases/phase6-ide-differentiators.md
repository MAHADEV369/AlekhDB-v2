# Phase 6 — IDE-Specific Differentiators

> **New files**: `alekhdb-git.js`, `alekhdb-privacy.js`, `alekhdb-ast.js`, `alekhdb-watcher.js`, `alekhdb-lsp.js`
> **Edit**: `alekhdb.js` (hooks for embed/git/privacy/ast modules)
> **New deps**: `web-tree-sitter` (elective), `chokidar` (elective)
> **Goal**: 6 features NO competitor has. These make AlchemyDB specifically an "AI IDE memory" vs generic "AI memory".
> **Depends on**: Phase 1 (inverted index), Phase 2 (memory types), Phase 3 (scopes), Phase 4 (embeddings)

---

## Context

These are **elective modules** — `import`-optional, zero cost if unused. They give AlekhDB its IDE-specific identity.

| Module | Unique? | What It Does |
|--------|---------|--------------|
| git-aware | NO ONE has this | Branch-scoped memory + merge |
| privacy/redaction | NO ONE has this | PII redaction BEFORE storage |
| tree-sitter AST | Only Cursor has (closed) | 100+ language parsing + import graph |
| file watcher | Only IDE-embedded | Auto-index on file save |
| LSP hooks | Only IDE-embedded | VS Code didSave/didChange |
| local embeddings | They need API keys | (Already in Phase 4.2, listed here for completeness) |

---

## Step 6.1: Git-Aware Memory (`alekhdb-git.js`)

### New file `alekhdb-git.js`:

```javascript
// alekhdb-git.js — Elective: git-aware branch memory
// No new deps — uses child_process.execSync to call git CLI

import { execSync } from 'child_process';
import * as path from 'path';

export async function enableGit(db, projectPath = '.') {
  // Detect current branch
  function detectBranch() {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath, encoding: 'utf8' }).trim();
    } catch (e) {
      return null;
    }
  }
  
  let currentBranch = detectBranch();
  if (!currentBranch) {
    console.error('[alekhdb-git] Not a git repo or git not installed');
    return null;
  }
  
  // Build scope path from project + branch
  const projectName = path.basename(path.resolve(projectPath));
  function branchScope(branch) {
    return `project:${projectName}/branch:${branch}`;
  }
  
  // Set scope on db
  db.setScope(branchScope(currentBranch));
  
  // Track current branch
  db._gitBranch = currentBranch;
  db._gitProject = projectName;
  
  // API
  const api = {
    getBranch() { return db._gitBranch; },
    getScope(branch) { return branchScope(branch || db._gitBranch); },
    
    setBranch(branch) {
      db._gitBranch = branch;
      db.setScope(branchScope(branch));
      db.emit('git:branch-switched', { branch });
      console.log(`[alekhdb-git] Switched to branch: ${branch}`);
    },
    
    async switchBranch() {
      const newBranch = detectBranch();
      if (newBranch && newBranch !== db._gitBranch) {
        api.setBranch(newBranch);
      }
      return db._gitBranch;
    },
    
    async mergeBranch(fromBranch, toBranch, options = {}) {
      const { dryRun = false, policy = 'copy' } = options;
      const fromScope = branchScope(fromBranch);
      const toScope = branchScope(toBranch);
      
      const sourceNodes = db.nodes.filter(n => n.scope === fromScope && !n.isForgotten);
      
      if (dryRun) return { sourceCount: sourceNodes.length, dryRun: true };
      
      // Copy source memories into target scope
      let copied = 0;
      let skipped = 0;
      sourceNodes.forEach(srcNode => {
        const existing = db.nodes.find(n =>
          n.scope === toScope &&
          n.label === srcNode.label &&
          n.memoryType === srcNode.memoryType
        );
        if (existing) {
          skipped++;
        } else {
          const id = db.generateId('mem');
          db.addNode(id, srcNode.label, srcNode.type, { ...srcNode.properties }, toScope, {
            memoryType: srcNode.memoryType,
            forgetAfter: srcNode.forgetAfter,
          });
          // Mark provenance
          const newNode = db.nodeMap.get(id);
          if (newNode) {
            newNode.properties.mergedFromBranch = fromBranch;
            newNode.properties.mergedAt = new Date().toISOString();
          }
          // Hook: extends relation
          db.addRelation(id, srcNode.id, 'extends');
          copied++;
        }
      });
      
      db.logAudit('GIT_MERGE', `Merged ${fromBranch} → ${toBranch}: ${copied} copied, ${skipped} already existed`);
      db.emit('git:merged', { from: fromBranch, to: toBranch, copied, skipped });
      db._markDirty();
      return { copied, skipped, sourceCount: sourceNodes.length };
    },
    
    getStatus() {
      return {
        branch: db._gitBranch,
        project: db._gitProject,
        scope: db.currentScope,
        activeMemories: db.nodes.filter(n => n.scope === branchScope(db._gitBranch)).length,
      };
    },
    
    // Watch for branch changes (polls every 5s — lightweight)
    watch(pollMs = 5000) {
      const interval = setInterval(() => {
        const newBranch = detectBranch();
        if (newBranch && newBranch !== db._gitBranch) {
          api.setBranch(newBranch);
        }
      }, pollMs);
      if (interval.unref) interval.unref();
      return () => clearInterval(interval);
    },
  };
  
  return api;
}
```

### Usage:
```javascript
import { enableGit } from './alekhdb-git.js';

const db = new AlekhDB(true);
const git = await enableGit(db, './my-project');
// Now all db.addMemory()/search() scoped to branch:main

await db.addMemory('Using JWT for auth');  // scope: 'project:my-project/branch:main'

// Switch branches (or auto-detected via git.switchBranch())
git.setBranch('feature/new-auth');
// Now search only returns feature branch memories

// Merge feature → main
git.mergeBranch('feature/new-auth', 'main');
// Copies feature branch memories into main scope

// Auto-poll for branch changes (works when user runs `git checkout` in IDE)
const stop = git.watch();
// stop() to cancel polling
```

---

## Step 6.2: PII/Secret Redaction (`alekhdb-privacy.js`)

### New file `alekhdb-privacy.js`:

```javascript
// alekhdb-privacy.js — Elective: PII/secret redaction before storage
// No new deps — regex-based with optional LLM enhancement

const DEFAULT_PATTERNS = {
  // API keys
  openai_key: /sk-[a-zA-Z0-9]{20,}/g,
  anthropic_key: /sk-ant-[a-zA-Z0-9]{20,}/g,
  generic_api_key: /(?:api[_-]?key|apikey|secret)\s*[:=]\s*['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,
  // AWS
  aws_access: /AKIA[0-9A-Z]{16}/g,
  aws_secret: /aws_secret_access_key\s*[:=]\s*['"]?([a-zA-Z0-9/+=]{40})['"]?/gi,
  // JWT tokens
  jwt: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  // Email
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // Phone (US)
  phone: /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g,
  // Credit card (basic)
  credit_card: /\b(?:\d[ -]*?){13,16}\b/g,
  // IP addresses (private warning only)
  private_ip: /\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  // SSN
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
};

const REPLACEMENT_LABELS = {
  openai_key: '[REDACTED_OPENAI_KEY]',
  anthropic_key: '[REDACTED_ANTHROPIC_KEY]',
  generic_api_key: '[REDACTED_API_KEY]',
  aws_access: '[REDACTED_AWS_ACCESS_KEY]',
  aws_secret: '[REDACTED_AWS_SECRET]',
  jwt: '[REDACTED_JWT]',
  email: '[REDACTED_EMAIL]',
  phone: '[REDACTED_PHONE]',
  credit_card: '[REDACTED_CREDIT_CARD]',
  private_ip: '[REDACTED_IP]',
  ssn: '[REDACTED_SSN]',
};

export async function enablePrivacy(db, config = {}) {
  const {
    patterns = {},            // user overrides
    disablePatterns = [],   // user turnoffs
    customPatterns = {},    // user additions
    audit = true,            // log redactions
  } = config;
  
  // Merge configs
  const activePatterns = { ...DEFAULT_PATTERNS, ...patterns, ...customPatterns };
  disablePatterns.forEach(p => delete activePatterns[p]);
  
  // Wrap addMemory to redact before storage
  const originalAddMemory = db.addMemory.bind(db);
  db.addMemory = async function(text, scope = db.currentScope || "work", options = {}) {
    const { original, redactions } = redactText(text, activePatterns);
    
    if (audit && redactions.length > 0) {
      redactions.forEach(r => {
        db.logAudit('PII_REDACTED', `Pattern ${r.pattern} matched in input text. Replaced ${r.count} occurrence(s).`);
      });
      db._privacyAuditLog = (db._privacyAuditLog || []).concat(redactions.map(r => ({
        timestamp: new Date().toISOString(),
        pattern: r.pattern,
        count: r.count,
        // Don't store the secret! Store first 3 chars only as a fingerprint:
        fingerprint: r.firstMatch?.slice(0, 3) + '***',
        replacedWith: r.replacement,
      })));
    }
    
    // Pass redacted text to original addMemory
    return originalAddMemory(original, scope, options);
  };
  
  // Wrap addNode too (in case direct addNode is called with sensitive data)
  const originalAddNode = db.addNode.bind(db);
  db.addNode = function(id, label, type, properties = {}, scope = db.currentScope || "work", options = {}) {
    if (typeof label === 'string') {
      const { original } = redactText(label, activePatterns);
      label = original;
    }
    if (properties && typeof properties === 'object') {
      properties = redactProperties(properties, activePatterns);
    }
    return originalAddNode(id, label, type, properties, scope, options);
  };
  
  // Audit log access
  db.getPrivacyLog = () => db._privacyAuditLog || [];
  db.clearPrivacyLog = () => { db._privacyAuditLog = []; };
  
  db.disablePrivacy = () => {
    db.addMemory = originalAddMemory;
    db.addNode = originalAddNode;
    delete db.getPrivacyLog;
    delete db.clearPrivacyLog;
    delete db.disablePrivacy;
    delete db._privacyAuditLog;
  };
  
  db.emit('privacy:enabled', { patterns: Object.keys(activePatterns) });
}

function redactText(text, patterns) {
  let result = text;
  const redactions = [];
  
  for (const [name, pattern] of Object.entries(patterns)) {
    const matches = text.match(pattern);
    if (matches) {
      const replacement = REPLACEMENT_LABELS[name] || `[REDACTED_${name.toUpperCase()}]`;
      const count = matches.length;
      result = result.replace(pattern, replacement);
      redactions.push({
        pattern: name,
        count,
        firstMatch: matches[0],
        replacement,
      });
    }
  }
  
  return { original: result, redactions };
}

function redactProperties(props, patterns) {
  const result = { ...props };
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      result[key] = redactText(value, patterns).original;
    }
  }
  return result;
}
```

### Usage:
```javascript
import { enablePrivacy } from './alekhdb-privacy.js';

const db = new AlekhDB(true);
await enablePrivacy(db, {
  audit: true,
  customPatterns: {
    // Add your own
    github_token: /ghp_[a-zA-Z0-9]{36}/g,
  },
  disablePatterns: ['email'],  // don't redact emails if you want them stored
});

await db.addMemory('My API key is sk-abc... and email is alice@example.com');
// Stored as: "My API key is [REDACTED_OPENAI_KEY] and email is [REDACTED_EMAIL]"

const log = db.getPrivacyLog();
// [{ timestamp, pattern: 'openai_key', count: 1, fingerprint: 'sk-***', replacedWith: '[REDACTED_OPENAI_KEY]' }]
```

---

## Step 6.3: Multi-Language Tree-Sitter AST (`alekhdb-ast.js`)

### New file `alekhdb-ast.js`:

```javascript
// alekhdb-ast.js — Elective: tree-sitter multi-language AST parser
// Deps: web-tree-sitter (auto-loaded) + per-language WASM grammars
// Replaces the regex-based astChunkCode for polyglot codebases.

let Parser = null;
let loadedLanguages = new Map();  // langName → tree-sitter Language object

export async function enableFullAST(db, config = {}) {
  const {
    languages = ['javascript', 'typescript', 'python'],
    grammarPath = null,  // override default CDN path
  } = config;
  
  if (!Parser) {
    try {
      const webTreeSitter = await import('web-tree-sitter');
      Parser = webTreeSitter.default || webTreeSitter;
      await Parser.init();  // load WASM runtime
    } catch (err) {
      console.error('[alekhdb-ast] Failed to load web-tree-sitter:', err.message);
      console.error('Install with: npm install web-tree-sitter');
      return false;
    }
  }
  
  // Load each language's WASM grammar
  for (const lang of languages) {
    if (loadedLanguages.has(lang)) continue;
    try {
      const wasmPath = grammarPath
        ? `${grammarPath}/tree-sitter-${lang}.wasm`
        : await resolveGrammarPath(lang);  // try npm/cdn/local
      const Lang = await Parser.Language.load(wasmPath);
      loadedLanguages.set(lang, Lang);
    } catch (err) {
      console.warn(`[alekhdb-ast] Failed to load grammar for ${lang}:`, err.message);
    }
  }
  
  // Detect language from file extension
  const EXT_TO_LANG = {
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.c': 'c', '.h': 'c',
    '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp',
    '.rb': 'ruby',
    '.lua': 'lua',
    '.php': 'php',
  };
  
  function detectLanguage(fileName) {
    const ext = '.' + fileName.split('.').pop();
    return EXT_TO_LANG[ext];
  }
  
  // Replace astChunkCode with tree-sitter version
  const originalAstChunk = db.astChunkCode.bind(db);
  db.astChunkCode = function(codeContent, fileName = 'code.js') {
    const lang = detectLanguage(fileName);
    if (!lang || !loadedLanguages.has(lang)) {
      // Fall back to original regex parser for JS/TS
      return originalAstChunk(codeContent, fileName);
    }
    
    return tsParse(db, codeContent, fileName, lang);
  };
  
  // New method: extract import/export graph
  db.getImportGraph = function(fileName) {
    // Returns [{ source: 'src/auth.ts', imports: ['express', './middleware/jwt'] }, ...]
    return db.nodes
      .filter(n => n.type === 'file' && n.label === fileName)
      .flatMap(fileNode => db.edges
        .filter(e => e.source === fileNode.id && (e.label === 'imports' || e.label === 'exports'))
        .map(e => ({ type: e.label, target: e.target, targetLabel: db.nodeMap.get(e.target)?.label }))
      );
  };
  
  db.disableFullAST = () => { db.astChunkCode = originalAstChunk; };
  db.emit('ast:enabled', { languages: [...loadedLanguages.keys()] });
  return true;
}

async function resolveGrammarPath(lang) {
  // Try local node_modules path first
  // Fallback to unpkg CDN
  return `https://unpkg.com/web-tree-sitter-${lang}/tree-sitter-${lang}.wasm`;
}

function tsParse(db, code, fileName, langName) {
  const Lang = loadedLanguages.get(langName);
  const parser = new Parser();
  parser.setLanguage(Lang);
  
  const tree = parser.parse(code);
  const chunkedNodes = [];
  const chunkedEdges = [];
  
  const fileId = 'file-' + fileName.toLowerCase().replace(/[^a-z0-9]/g, '');
  db.addNode(fileId, fileName, 'file', { path: fileName, language: langName });
  chunkedNodes.push(fileId);
  
  // Walk the tree for definitions
  const cursor = tree.walk();
  
  function walk(node, lastClassId = null) {
    const type = node.type;
    
    // Function definitions
    if (type === 'function_definition' || type === 'method_definition' ||
        type === 'function_declaration' || type === 'method_declaration' ||
        type === 'arrow_function' || type === 'lexical_declaration') {
      
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : 'anonymous';
      const params = [];
      const paramsNode = node.childForFieldName('parameters');
      if (paramsNode) paramsNode.text && params.push(paramsNode.text);
      
      const methodId = `method-${name.toLowerCase().replace(/[^a-z0-9]/g,'')}-${db.generateId('fn').slice(-8)}`;
      db.addNode(methodId, `fn ${name}()`, 'function', { params: params.join(', '), sourceFile: fileName });
      chunkedNodes.push(methodId);
      
      const edgeId = `e-contain-${methodId}`;
      if (lastClassId) {
        db.addEdge(edgeId, lastClassId, methodId, 'contains_method', 1, true);
      } else {
        db.addEdge(edgeId, fileId, methodId, 'contains_function', 1, true);
      }
      chunkedEdges.push(edgeId);
    }
    
    // Class definitions
    if (type === 'class_definition' || type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : 'Anonymous';
      const classId = `class-${name.toLowerCase().replace(/[^a-z0-9]/g,'')}`;
      db.addNode(classId, `Class ${name}`, 'class', { sourceFile: fileName, language: langName });
      db.addEdge(`e-file-class-${classId}`, fileId, classId, 'contains_class', 1, true);
      chunkedNodes.push(classId);
      lastClassId = classId;
    }
    
    // Import statements
    if (type === 'import_statement' || type === 'import_from_statement' ||
        type === 'import_declaration' ||
        type === 'use_statement' || type === 'include_directive') {
      
      const importText = node.text;
      const importedModule = extractModuleName(importText);
      if (importedModule) {
        const importId = `import-${importedModule.toLowerCase().replace(/[^a-z0-9]/g,'')}`;
        db.addNode(importId, importedModule, 'import', { raw: importText, sourceFile: fileName });
        db.addEdge(`e-import-${importId}`, fileId, importId, 'imports', 1, true);
        chunkedNodes.push(importId);
      }
    }
    
    // Recurse
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i), lastClassId);
    }
  }
  
  walk(tree.rootNode);
  
  // Permanently exempt code nodes from decay (preserves existing behavior)
  // Already handled by addNode() defaults (file/class/function types)
  
  db.logAudit('CODE_CHUNK_TS', `Parsed ${fileName} (${langName}) via tree-sitter. Nodes: ${chunkedNodes.length}`);
  db._markDirty();
  return { nodes: chunkedNodes, edges: chunkedEdges };
}

function extractModuleName(importText) {
  // Extract module name from various import syntaxes
  const patterns = [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/,  // JS/TS
    /from\s+(['"][^'"]+['"])/,                    // Python
    /import\s+(['"][^'"]+['"])/,                  // Python
    /use\s+([^;]+)/,                              // Rust
    /#include\s+["<]([^>"]+)[>"]/,                // C/C++
  ];
  for (const p of patterns) {
    const m = importText.match(p);
    if (m) return m[1].replace['"'] || m[1];
  }
  return null;
}
```

### Usage:
```javascript
import { enableFullAST } from './alekhdb-ast.js';

const db = new AlekhDB(true);
await enableFullAST(db, { languages: ['javascript', 'python', 'rust'] });

// Parses Python correctly now:
db.astChunkCode(pythonCode, 'processor.py');
// → extracts classes, methods, imports

// Import graph available:
db.getImportGraph('app.ts');
// → [{ type: 'imports', target: 'import-express', targetLabel: 'express' }, ...]
```

---

## Step 6.4: File Watcher (`alekhdb-watcher.js`)

### New file `alekhdb-watcher.js`:

```javascript
// alekhdb-watcher.js — Elective: auto-index files on change
// Deps: chokidar (optional peer dep)

export async function enableWatcher(db, config = {}) {
  const {
    paths = [],
    exclude = ['node_modules', '.git', 'dist', 'build', '.venv', 'coverage'],
    debounce = 500,
    astParser = false,
    onDelete = 'archive',  // 'archive' | 'delete' | 'ignore'
    autoStart = true,
  } = config;
  
  let chokidar;
  try {
    chokidar = (await import('chokidar')).default;
  } catch (err) {
    console.error('[alekhdb-watcher] chokidar not installed: npm install chokidar');
    return null;
  }
  
  let watcher = null;
  let pending = new Map();  // path → timeout
  let fileCount = 0;
  let indexedCount = 0;
  let isPaused = false;
  
  function indexFile(filePath, content) {
    if (isPaused) return;
    const basename = filePath.split('/').pop();
    // Filter by extension
    const supportedExt = /\.(js|mjs|ts|tsx|jsx|py|rs|go|java|c|cpp|rb|php|lua|md|txt|json|yaml|yml)$/i;
    if (!supportedExt.test(basename)) return;
    
    try {
      const rel = filePath;
      db.astChunkCode(content, rel);
      fileCount++;
      indexedCount++;
      db.emit('watcher:indexed', { path: rel, total: indexedCount });
    } catch (e) {
      db.emit('watcher:error', { path: filePath, error: e.message });
    }
  }
  
  function archiveFile(filePath) {
    const fileId = 'file-' + filePath.toLowerCase().replace(/[^a-z0-9]/g, '');
    const node = db.nodeMap.get(fileId);
    if (node) {
      if (onDelete === 'archive') {
        node.properties.archived = true;
        db._unindexNode(fileId);
        db.logAudit('WATCHER_ARCHIVE', `Archived deleted file: ${filePath}`);
      } else if (onDelete === 'delete') {
        const idx = db.nodes.findIndex(n => n.id === fileId);
        if (idx >= 0) db.nodes.splice(idx, 1);
        db.nodeMap.delete(fileId);
        db._unindexNode(fileId);
        db.logAudit('WATCHER_DELETE', `Removed deleted file: ${filePath}`);
      }
      db._markDirty();
    }
  }
  
  function start() {
    if (watcher) return;
    isPaused = false;
    
    watcher = chokidar.watch(paths, {
      ignored: exclude.map(e => new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
      persistent: true,
    });
    
    const debouncedIndex = (filePath) => {
      if (isPaused) return;
      // Debounce per-file
      if (pending.has(filePath)) clearTimeout(pending.get(filePath));
      pending.set(filePath, setTimeout(async () => {
        pending.delete(filePath);
        try {
          const fs = await import('fs');
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) return;
            const content = fs.readFileSync(filePath, 'utf8');
            indexFile(filePath, content);
          }
        } catch (e) { /* file may have been deleted */ }
      }, debounce));
    };
    
    watcher.on('add', debouncedIndex);
    watcher.on('change', debouncedIndex);
    watcher.on('unlink', (p) => archiveFile(p));
    
    db.emit('watcher:started', { paths });
  }
  
  function stop() {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  }
  
  function pause() { isPaused = true; }
  function resume() { isPaused = false; }
  
  if (autoStart) start();
  
  db._watcherApi = { start, stop, pause, resume, getStatus: () => ({ paths, indexed: indexedCount, pending: pending.size, paused: isPaused }) };
  return db._watcherApi;
}
```

### Usage:
```javascript
import { enableWatcher } from './alekhdb-watcher.js';

const db = new AlekhDB(true);
const watcher = await enableWatcher(db, {
  paths: ['./src'],
  exclude: ['node_modules', '.git', 'dist'],
  debounce: 1000,
  astParser: true,
  onDelete: 'archive',
});
// Now any file change in ./src auto-indexes into memory

watcher.pause();  // during builds
watcher.resume(); // after build done
watcher.stop();   // shutdown
watcher.getStatus();  // { paths, indexed, pending }
```

---

## Step 6.5: Optional LSP Hooks (`alekhdb-lsp.js`)

### New file `alekhdb-lsp.js` (designed for VS Code extension integration):

```javascript
// alekhdb-lsp.js — Elective: VS Code LSP hooks
// Designed to be called from a VS Code extension's event handlers.
// Not auto-loaded — extension calls these hooks directly.

export function enableLSP(db, config = {}) {
  const {
    autoAstOnSave = true,
    autoAstOnChange = false,  // off by default — high frequency
    autoDiagToMemory = true,
  } = config;
  
  return {
    // Call from VS Code's workspace.onDidSaveTextDocument
    onDidSave(document) {
      if (!autoAstOnSave) return;
      const fileName = document.uri.fsPath;
      const content = document.getText();
      try {
        db.astChunkCode(content, fileName);
        db.emit('lsp:saved', { path: fileName });
      } catch (e) {
        console.error('[alekhdb-lsp] onDidSave error:', e.message);
      }
    },
    
    // Call from workspace.onDidChangeTextDocument (throttled)
    onDidChange(event) {
      if (!autoAstOnChange) return;
      const fileName = event.document.uri.fsPath;
      const content = event.document.getText();
      // Update existing file node
      const fileId = 'file-' + fileName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const node = db.nodeMap.get(fileId);
      if (node) {
        node.properties.content = content;
        node.properties.updatedAt = new Date().toISOString();
        db._markDirty();
      }
    },
    
    // Call from VS Code's.languages.onDidChangeDiagnostics
    onDiagnostic(diagnostic) {
      if (!autoDiagToMemory) return;
      const msg = `Error: ${diagnostic.message} at ${diagnostic.file}:${diagnostic.line}`;
      db.addMemory(msg, db.currentScope || 'work', { memoryType: 'note' });
      db.emit('lsp:diagnostic', { message: diagnostic.message, file: diagnostic.file });
    },
    
    // Call from window.onDidChangeActiveTextEditor
    onActiveEditorChanged(editor) {
      if (!editor) return;
      const fileName = editor.document.uri.fsPath;
      db.emit('lsp:active-file', { path: fileName });
      // Optional: boosts LLM context for currently-open file
      const fileId = 'file-' + fileName.toLowerCase().replace(/[^a-z0-9]/g, '');
      db.reinforceNodeMemory(fileId);
    },
  };
}
```

### Usage (from VS Code extension):
```javascript
import { AlekhDB } from 'alekhdb';
import { enableGit } from 'alekhdb/git';
import { enableLSP } from 'alekhdb/lsp';

const db = new AlekhDB(true);
await enableGit(db, workspace.rootPath);
const lsp = enableLSP(db);

// Wire up VS Code events:
context.subscriptions.push(
  workspace.onDidSaveTextDocument(doc => lsp.onDidSave(doc)),
  languages.onDidChangeDiagnostics(diag => lsp.onDiagnostic(diag)),
  window.onDidChangeActiveTextEditor(ed => lsp.onActiveEditorChanged(ed)),
);
```

---

## Verification

```bash
# 6.1 Git
node -e "
import { AlekhDB } from './alekhdb.js';
import { enableGit } from './alekhdb-git.js';
const db = new AlekhDB(true);
db.clearToDefault();
const git = await enableGit(db, '/tmp');  // any path
console.log('Branch:', git?.getBranch());
git?.setBranch('test-branch');
console.log('Scope:', db.getScope());
"

# 6.2 Privacy
node -e "
import { AlekhDB } from './alekhdb.js';
import { enablePrivacy } from './alekhdb-privacy.js';
const db = new AlekhDB(true);
db.clearToDefault();
await enablePrivacy(db);
await db.addMemory('My key is sk-abcdefghijklmnopqrstuvwxyz123456');
const node = db.nodes.find(n => n.label.includes('REDACTED'));
console.log('Redacted?', !!node);
console.log('Log entries:', db.getPrivacyLog().length);
"

# 6.3 Tree-sitter (skip if not installed; just verify fallback)
node -e "
import { AlekhDB } from './alekhdb.js';
const db = new AlekhDB(true);
db.clearToDefault();
const r = db.astChunkCode('class Foo { bar() {} }', 'foo.js');
console.log('Regex AST still works:', r.nodes.length > 0);
"
```

## Files

- `alekhdb-git.js` — NEW
- `alekhdb-privacy.js` — NEW
- `alekhdb-ast.js` — NEW
- `alekhdb-watcher.js` — NEW
- `alekhdb-lsp.js` — NEW
- `package.json` — add `web-tree-sitter` and `chokidar` as optional peer deps