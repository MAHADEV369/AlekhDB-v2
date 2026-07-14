// alekhdb-git.js — Elective: git-aware branch memory
// No new deps — uses child_process.execSync to call git CLI

import { execSync } from 'child_process';
import * as path from 'path';

export async function enableGit(db, projectPath = '.') {
  function detectBranch() {
    try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath, encoding: 'utf8' }).trim(); }
    catch (e) { return null; }
  }
  let currentBranch = detectBranch();
  if (!currentBranch) { console.error('[alekhdb-git] Not a git repo or git not installed'); return null; }
  const projectName = path.basename(path.resolve(projectPath));
  function branchScope(branch) { return `project:${projectName}/branch:${branch}`; }
  db.setScope(branchScope(currentBranch));
  db._gitBranch = currentBranch;
  db._gitProject = projectName;

  const api = {
    getBranch() { return db._gitBranch; },
    getScope(branch) { return branchScope(branch || db._gitBranch); },
    setBranch(branch) { db._gitBranch = branch; db.setScope(branchScope(branch)); db.emit('git:branch-switched', { branch }); console.log(`[alekhdb-git] Switched to branch: ${branch}`); },
    async switchBranch() { const newBranch = detectBranch(); if (newBranch && newBranch !== db._gitBranch) api.setBranch(newBranch); return db._gitBranch; },
    async mergeBranch(fromBranch, toBranch, options = {}) {
      const { dryRun = false, policy = 'copy' } = options;
      const fromScope = branchScope(fromBranch);
      const toScope = branchScope(toBranch);
      const sourceNodes = db.nodes.filter(n => n.scope === fromScope && !n.isForgotten);
      if (dryRun) return { sourceCount: sourceNodes.length, dryRun: true };
      let copied = 0, skipped = 0;
      sourceNodes.forEach(srcNode => {
        const existing = db.nodes.find(n => n.scope === toScope && n.label === srcNode.label && n.memoryType === srcNode.memoryType);
        if (existing) { skipped++; }
        else {
          const id = db.generateId('mem');
          db.addNode(id, srcNode.label, srcNode.type, { ...srcNode.properties }, toScope, { memoryType: srcNode.memoryType, forgetAfter: srcNode.forgetAfter });
          const newNode = db.nodeMap.get(id);
          if (newNode) { newNode.properties.mergedFromBranch = fromBranch; newNode.properties.mergedAt = new Date().toISOString(); }
          db.addRelation(id, srcNode.id, 'extends');
          copied++;
        }
      });
      db.logAudit('GIT_MERGE', `Merged ${fromBranch} → ${toBranch}: ${copied} copied, ${skipped} already existed`);
      db.emit('git:merged', { from: fromBranch, to: toBranch, copied, skipped });
      db._markDirty();
      return { copied, skipped, sourceCount: sourceNodes.length };
    },
    getStatus() { return { branch: db._gitBranch, project: db._gitProject, scope: db.currentScope, activeMemories: db.nodes.filter(n => n.scope === branchScope(db._gitBranch)).length }; },
    watch(pollMs = 5000) {
      const interval = setInterval(() => { const newBranch = detectBranch(); if (newBranch && newBranch !== db._gitBranch) api.setBranch(newBranch); }, pollMs);
      if (interval.unref) interval.unref();
      return () => clearInterval(interval);
    },
  };

  if (db) db._gitApi = api;
  return api;
}
