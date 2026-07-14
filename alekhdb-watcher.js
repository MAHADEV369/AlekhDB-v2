// alekhdb-watcher.js — Elective: auto-index files on change
// Deps: chokidar (optional peer dep)

export async function enableWatcher(db, config = {}) {
  const { paths = [], exclude = ['node_modules', '.git', 'dist', 'build', '.venv', 'coverage'], debounce = 500, astParser = false, onDelete = 'archive', autoStart = true } = config;
  let chokidar;
  try { chokidar = (await import('chokidar')).default; }
  catch (err) { console.error('[alekhdb-watcher] chokidar not installed: npm install chokidar'); return null; }

  let watcher = null;
  let pending = new Map();
  let fileCount = 0;
  let indexedCount = 0;
  let isPaused = false;

  function indexFile(filePath, content) {
    if (isPaused) return;
    const basename = filePath.split('/').pop();
    const supportedExt = /\.(js|mjs|ts|tsx|jsx|py|rs|go|java|c|cpp|rb|php|lua|md|txt|json|yaml|yml)$/i;
    if (!supportedExt.test(basename)) return;
    try { db.astChunkCode(content, filePath); fileCount++; indexedCount++; db.emit('watcher:indexed', { path: filePath, total: indexedCount }); }
    catch (e) { db.emit('watcher:error', { path: filePath, error: e.message }); }
  }

  function archiveFile(filePath) {
    const fileId = 'file-' + filePath.toLowerCase().replace(/[^a-z0-9]/g, '');
    const node = db.nodeMap.get(fileId);
    if (node) {
      if (onDelete === 'archive') { node.properties.archived = true; db._unindexNode(fileId); db.logAudit('WATCHER_ARCHIVE', `Archived deleted file: ${filePath}`); }
      else if (onDelete === 'delete') { const idx = db.nodes.findIndex(n => n.id === fileId); if (idx >= 0) db.nodes.splice(idx, 1); db.nodeMap.delete(fileId); db._unindexNode(fileId); db.logAudit('WATCHER_DELETE', `Removed deleted file: ${filePath}`); }
      db._markDirty();
    }
  }

  function start() {
    if (watcher) return;
    isPaused = false;
    watcher = chokidar.watch(paths, { ignored: exclude.map(e => new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))), persistent: true });
    const debouncedIndex = (filePath) => {
      if (isPaused) return;
      if (pending.has(filePath)) clearTimeout(pending.get(filePath));
      pending.set(filePath, setTimeout(async () => {
        pending.delete(filePath);
        try { const fs = await import('fs'); if (fs.existsSync(filePath)) { const stat = fs.statSync(filePath); if (!stat.isFile()) return; const content = fs.readFileSync(filePath, 'utf8'); indexFile(filePath, content); } }
        catch (e) {}
      }, debounce));
    };
    watcher.on('add', debouncedIndex);
    watcher.on('change', debouncedIndex);
    watcher.on('unlink', (p) => archiveFile(p));
    db.emit('watcher:started', { paths });
  }

  function stop() { if (watcher) { watcher.close(); watcher = null; } }
  function pause() { isPaused = true; }
  function resume() { isPaused = false; }
  if (autoStart) start();
  db._watcherApi = { start, stop, pause, resume, getStatus: () => ({ paths, indexed: indexedCount, pending: pending.size, paused: isPaused }) };
  return db._watcherApi;
}
