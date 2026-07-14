// alekhdb-lsp.js — Elective: VS Code LSP hooks
// Designed to be called from a VS Code extension's event handlers.
// Not auto-loaded — extension calls these hooks directly.

export function enableLSP(db, config = {}) {
  const { autoAstOnSave = true, autoAstOnChange = false, autoDiagToMemory = true } = config;
  return {
    onDidSave(document) {
      if (!autoAstOnSave) return;
      const fileName = document.uri.fsPath;
      const content = document.getText();
      try { db.astChunkCode(content, fileName); db.emit('lsp:saved', { path: fileName }); }
      catch (e) { console.error('[alekhdb-lsp] onDidSave error:', e.message); }
    },
    onDidChange(event) {
      if (!autoAstOnChange) return;
      const fileName = event.document.uri.fsPath;
      const content = event.document.getText();
      const fileId = 'file-' + fileName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const node = db.nodeMap.get(fileId);
      if (node) { node.properties.content = content; node.properties.updatedAt = new Date().toISOString(); db._markDirty(); }
    },
    onDiagnostic(diagnostic) {
      if (!autoDiagToMemory) return;
      const msg = `Error: ${diagnostic.message} at ${diagnostic.file}:${diagnostic.line}`;
      db.addMemory(msg, db.currentScope || 'work', { memoryType: 'note' });
      db.emit('lsp:diagnostic', { message: diagnostic.message, file: diagnostic.file });
    },
    onActiveEditorChanged(editor) {
      if (!editor) return;
      const fileName = editor.document.uri.fsPath;
      db.emit('lsp:active-file', { path: fileName });
      const fileId = 'file-' + fileName.toLowerCase().replace(/[^a-z0-9]/g, '');
      db.reinforceNodeMemory(fileId);
    },
  };
}
