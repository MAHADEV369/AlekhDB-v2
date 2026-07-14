// alekhdb-ast.js — Elective: tree-sitter multi-language AST parser
// Deps: web-tree-sitter (auto-loaded) + per-language WASM grammars

let Parser = null;
let loadedLanguages = new Map();

export async function enableFullAST(db, config = {}) {
  const { languages = ['javascript', 'typescript', 'python'], grammarPath = null } = config;
  if (!Parser) {
    try {
      const webTreeSitter = await import('web-tree-sitter');
      Parser = webTreeSitter.default || webTreeSitter;
      await Parser.init();
    } catch (err) { console.error('[alekhdb-ast] Failed to load web-tree-sitter:', err.message); console.error('Install with: npm install web-tree-sitter'); return false; }
  }
  for (const lang of languages) {
    if (loadedLanguages.has(lang)) continue;
    try { const wasmPath = grammarPath ? `${grammarPath}/tree-sitter-${lang}.wasm` : `https://unpkg.com/web-tree-sitter-${lang}/tree-sitter-${lang}.wasm`; const Lang = await Parser.Language.load(wasmPath); loadedLanguages.set(lang, Lang); }
    catch (err) { console.warn(`[alekhdb-ast] Failed to load grammar for ${lang}:`, err.message); }
  }
  const EXT_TO_LANG = { '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp', '.rb': 'ruby', '.lua': 'lua', '.php': 'php' };
  function detectLanguage(fileName) { const ext = '.' + fileName.split('.').pop(); return EXT_TO_LANG[ext]; }
  const originalAstChunk = db.astChunkCode.bind(db);
  db.astChunkCode = function(codeContent, fileName = 'code.js') {
    const lang = detectLanguage(fileName);
    if (!lang || !loadedLanguages.has(lang)) return originalAstChunk(codeContent, fileName);
    return tsParse(db, codeContent, fileName, lang);
  };
  db.getImportGraph = function(fileName) {
    return db.nodes.filter(n => n.type === 'file' && n.label === fileName).flatMap(fileNode => db.edges.filter(e => e.source === fileNode.id && (e.label === 'imports' || e.label === 'exports')).map(e => ({ type: e.label, target: e.target, targetLabel: db.nodeMap.get(e.target)?.label })));
  };
  db.disableFullAST = () => { db.astChunkCode = originalAstChunk; };
  db.emit('ast:enabled', { languages: [...loadedLanguages.keys()] });
  return true;
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
  const cursor = tree.walk();

  function walk(node, lastClassId = null) {
    const type = node.type;
    if (type === 'function_definition' || type === 'method_definition' || type === 'function_declaration' || type === 'method_declaration' || type === 'arrow_function' || type === 'lexical_declaration') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : 'anonymous';
      const params = [];
      const paramsNode = node.childForFieldName('parameters');
      if (paramsNode) paramsNode.text && params.push(paramsNode.text);
      const methodId = `method-${name.toLowerCase().replace(/[^a-z0-9]/g,'')}-${db.generateId('fn').slice(-8)}`;
      db.addNode(methodId, `fn ${name}()`, 'function', { params: params.join(', '), sourceFile: fileName });
      chunkedNodes.push(methodId);
      const edgeId = `e-contain-${methodId}`;
      if (lastClassId) db.addEdge(edgeId, lastClassId, methodId, 'contains_method', 1, true);
      else db.addEdge(edgeId, fileId, methodId, 'contains_function', 1, true);
      chunkedEdges.push(edgeId);
    }
    if (type === 'class_definition' || type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : 'Anonymous';
      const classId = `class-${name.toLowerCase().replace(/[^a-z0-9]/g,'')}`;
      db.addNode(classId, `Class ${name}`, 'class', { sourceFile: fileName, language: langName });
      db.addEdge(`e-file-class-${classId}`, fileId, classId, 'contains_class', 1, true);
      chunkedNodes.push(classId);
      lastClassId = classId;
    }
    if (type === 'import_statement' || type === 'import_from_statement' || type === 'import_declaration' || type === 'use_statement' || type === 'include_directive') {
      const importText = node.text;
      const importedModule = extractModuleName(importText);
      if (importedModule) {
        const importId = `import-${importedModule.toLowerCase().replace(/[^a-z0-9]/g,'')}`;
        db.addNode(importId, importedModule, 'import', { raw: importText, sourceFile: fileName });
        db.addEdge(`e-import-${importId}`, fileId, importId, 'imports', 1, true);
        chunkedNodes.push(importId);
      }
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i), lastClassId);
  }
  walk(tree.rootNode);
  db.logAudit('CODE_CHUNK_TS', `Parsed ${fileName} (${langName}) via tree-sitter. Nodes: ${chunkedNodes.length}`);
  db._markDirty();
  return { nodes: chunkedNodes, edges: chunkedEdges };
}

function extractModuleName(importText) {
  const patterns = [/import\s+.*?\s+from\s+['"]([^'"]+)['"]/, /from\s+(['"][^'"]+['"])/, /import\s+(['"][^'"]+['"])/, /use\s+([^;]+)/, /#include\s+["<]([^>"]+)[>"]/];
  for (const p of patterns) { const m = importText.match(p); if (m) return m[1].replace['"'] || m[1]; }
  return null;
}
