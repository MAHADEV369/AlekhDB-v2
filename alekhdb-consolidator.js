// alekhdb-consolidator.js — Async Offline Consolidation Daemon
// Elective module. Import only when needed:
//   import { enableConsolidator } from './alekhdb-consolidator.js';
//   enableConsolidator(db, { intervalMs: 300000 });
// Zero cost when not imported.

/**
 * Enable the async offline consolidation daemon on an AlekhDB instance.
 * Runs schema induction, belief revision, cross-domain linking, and trust recalculation on a setInterval.
 * All inferred outputs route through the review queue (isInference=true, reviewStatus='unreviewed') — nothing auto-merges.
 * Zero cost until enabled. Timer is unref()'d so it never blocks process exit.
 * @param {import('./alekhdb.js').AlekhDB} db - AlekhDB instance to consolidate.
 * @param {Object} [opts={}] - Consolidator options.
 * @param {number} [opts.intervalMs=300000] - Run cadency in milliseconds. Default 5 minutes.
 * @param {Array<string>|null} [opts.taskList=null] - Subset of tasks to run. Defaults to all four: ['induceSchemas', 'reviseBeliefs', 'linkCrossDomain', 'recalcTrust'].
 * @returns {{ stop: Function }} Handle with a stop() method to clear the timer.
 * @example
 * import { enableConsolidator } from './alekhdb-consolidator.js';
 * const handle = enableConsolidator(db, { intervalMs: 60000 });
 * // ... later
 * handle.stop();
 */
export function enableConsolidator(db, opts = {}) {
  const { intervalMs = 300000, taskList = null } = opts;
  if (!db) throw new Error("Consolidator requires an AlekhDB instance");

  const defaultTasks = ["induceSchemas", "reviseBeliefs", "linkCrossDomain", "recalcTrust"];
  const tasks = taskList || defaultTasks;
  const taskSet = new Set(tasks);

  async function runOnce() {
    try {
      if (taskSet.has("induceSchemas")) induceSchemas(db);
      if (taskSet.has("reviseBeliefs")) reviseBeliefs(db);
      if (taskSet.has("linkCrossDomain")) linkCrossDomain(db);
      if (taskSet.has("recalcTrust")) recalcTrust(db);
      db._markDirty();
    } catch (err) {
      console.error("Consolidator error:", err);
    }
  }

  const timer = setInterval(runOnce, intervalMs);
  if (timer.unref) timer.unref();
  if (db._consolidatorTimer) clearInterval(db._consolidatorTimer);
  db._consolidatorTimer = timer;

  // Run first tick after a short delay (don't block startup)
  setTimeout(runOnce, 5000);

  return { stop: () => { clearInterval(timer); db._consolidatorTimer = null; } };
}

/**
 * Induce shared schemas across project scopes by scanning property-shape signatures.
 * When two scopes share nodes with similar property shapes, infers a shared 'schema' node with isInference=true, reviewStatus='unreviewed'.
 * Routes through the existing review queue. No auto-merge.
 * @param {import('./alekhdb.js').AlekhDB} db - AlekhDB instance.
 * @returns {void}
 * @example
 * induceSchemas(db);  // called by consolidator daemon
 */
function induceSchemas(db) {
  const scopeGroups = {};
  db.nodes.forEach(n => {
    if (n.isForgotten || n.properties?.archived || n.properties?.compacted) return;
    const s = n.scope || "default";
    if (!scopeGroups[s]) scopeGroups[s] = [];
    scopeGroups[s].push(n);
  });
  const scopes = Object.keys(scopeGroups);
  if (scopes.length < 2) return;
  // Build property-shape signatures per scope
  const shapeMap = {};
  scopes.forEach(s => {
    const shapeCounts = {};
    scopeGroups[s].forEach(n => {
      if (!n.properties || typeof n.properties !== "object") return;
      const keys = Object.keys(n.properties).filter(k => !["cognitiveStrength", "lastAccessedAt", "compacted", "archived", "embedding", "embeddingModel", "sourceTrace", "sourceAgent"].includes(k)).sort();
      if (keys.length === 0) return;
      const sig = keys.join(",");
      shapeCounts[sig] = (shapeCounts[sig] || 0) + 1;
    });
    Object.entries(shapeCounts).forEach(([sig, count]) => {
      if (!shapeMap[sig]) shapeMap[sig] = {};
      shapeMap[sig][s] = count;
    });
  });
  // Find shapes shared across >= 2 scopes
  Object.entries(shapeMap).forEach(([sig, scopeCounts]) => {
    const sharedScopes = Object.keys(scopeCounts);
    if (sharedScopes.length < 2) return;
    const schemaId = `schema-${sig.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40)}`;
    if (db.nodeMap.has(schemaId)) return;
    const keys = sig.split(",");
    db.addNode(schemaId, `Schema: ${keys.join(", ")}`, "concept", { schemaType: "inferred", shape: keys, scopes: sharedScopes }, "all", { memoryType: "note", isInference: true, reviewStatus: "unreviewed" });
    sharedScopes.forEach(s => {
      db.addEdge(db.generateId("e-schema-scope"), schemaId, s, "describes_scope", 0.8, true);
    });
  });
}

/**
 * Revise beliefs by comparing outcomes across sessions for similar tasks.
 * When the same task has contradictory outcomes across sessions, creates an inference node for review.
 * Does NOT mutate cognitiveStrength — only generates review-queue entries.
 * @param {import('./alekhdb.js').AlekhDB} db - AlekhDB instance.
 * @returns {void}
 * @example
 * reviseBeliefs(db);  // called by consolidator daemon
 */
function reviseBeliefs(db) {
  const sessionGroups = {};
  db.traces.forEach(t => {
    if (t.status !== "finalized") return;
    const s = t.sessionId || "session-default";
    if (!sessionGroups[s]) sessionGroups[s] = [];
    sessionGroups[s].push(t);
  });
  const sessions = Object.keys(sessionGroups);
  if (sessions.length < 2) return;
  // Compare outcomes across sessions for similar taskIds
  const taskPatterns = {};
  Object.entries(sessionGroups).forEach(([sid, traces]) => {
    traces.forEach(t => {
      const key = t.taskId || "task-default";
      if (!taskPatterns[key]) taskPatterns[key] = [];
      taskPatterns[key].push({ sessionId: sid, outcome: t.outcome, traceId: t.traceId });
    });
  });
  Object.entries(taskPatterns).forEach(([taskId, occurrences]) => {
    if (occurrences.length < 2) return;
    const outcomes = new Set(occurrences.map(o => o.outcome));
    if (outcomes.size <= 1) return;
    // Contradictory outcomes for the same task across sessions
    const sessionsInvolved = [...new Set(occurrences.map(o => o.sessionId))];
    const sessionStr = sessionsInvolved.join(", ");
    const nodeId = `belief-revision-${taskId.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 30)}`;
    if (db.nodeMap.has(nodeId)) return;
    const detail = occurrences.map(o => `${o.sessionId}: ${o.outcome}`).join("; ");
    db.addNode(nodeId, `Belief Revision: ${taskId}`, "concept", { schemaType: "belief_revision", taskId, sessions: sessionsInvolved, detail }, "all", { memoryType: "note", isInference: true, reviewStatus: "unreviewed" });
  });

  // Scan knowledge edges for cross-session/scope contradictions
  scanKnowledgeEdgeConflicts(db);
}

/**
 * Scan knowledge nodes and typed edges for structural contradictions across the database.
 * Creates inference-review nodes when contradictions, supersessions, or related-edge chains exist
 * between knowledge nodes in different scopes or sessions.
 * Called by reviseBeliefs(). No auto-merge — routes through review queue.
 * @param {import('./alekhdb.js').AlekhDB} db - AlekhDB instance.
 * @returns {void}
 */
function scanKnowledgeEdgeConflicts(db) {
  const knowledgeNodes = [];
  for (const [id, node] of db.nodeMap) {
    const kt = db._getKnowledgeType ? db._getKnowledgeType(node) : null;
    if (kt && !node.isForgotten && !node.properties?.archived) knowledgeNodes.push({ node, type: kt });
  }
  if (knowledgeNodes.length < 2) return;

  // Find active contradicts edges between knowledge nodes
  for (const kn of knowledgeNodes) {
    const edges = db.adjacency.get(kn.node.id) || [];
    const contradicts = edges.filter(e => e.edge.label === 'contradicts' && e.edge.active);
    if (contradicts.length === 0) continue;
    for (const ce of contradicts) {
      const targetNode = db.nodeMap.get(ce.neighborId);
      if (!targetNode) continue;
      const targetIsKnowledge = knowledgeNodes.some(k => k.node.id === targetNode.id);
      if (!targetIsKnowledge) continue;
      if (kn.node.scope === targetNode.scope) continue; // same scope — expected
      const nodeId = `conflict-${kn.node.id}-${targetNode.id}`;
      if (db.nodeMap.has(nodeId)) continue;
      const detail = `"${kn.node.label}" contradicts "${targetNode.label}" across scopes "${kn.node.scope}" → "${targetNode.scope}"`;
      db.addNode(nodeId, `Cross-Scope Conflict: ${kn.node.label} ↔ ${targetNode.label}`, "concept", { schemaType: "knowledge_conflict", sourceId: kn.node.id, targetId: targetNode.id, sourceScope: kn.node.scope, targetScope: targetNode.scope, detail, edgeId: ce.edge.id }, "all", { memoryType: "note", isInference: true, reviewStatus: "unreviewed" });
    }
  }

  // Find supersedes chains that span different domains
  const supersedesEdges = db.edges.filter(e => e.label === 'supersedes' && e.active);
  for (const se of supersedesEdges) {
    const sourceNode = db.nodeMap.get(se.source);
    const targetNode = db.nodeMap.get(se.target);
    if (!sourceNode || !targetNode) continue;
    if (sourceNode.scope === targetNode.scope) continue;
    const nodeId = `supersedes-cross-${se.source}-${se.target}`;
    if (db.nodeMap.has(nodeId)) continue;
    const detail = `"${sourceNode.label}" (${sourceNode.scope}) supersedes "${targetNode.label}" (${targetNode.scope})`;
    db.addNode(nodeId, `Cross-Scope Supersession: ${sourceNode.label} → ${targetNode.label}`, "concept", { schemaType: "supersedes_chain", sourceScope: sourceNode.scope, targetScope: targetNode.scope, detail, edgeId: se.id }, "all", { memoryType: "note", isInference: true, reviewStatus: "unreviewed" });
  }
}

/**
 * Link cross-domain concepts by finding nodes with matching labels across different scopes.
 * Creates 'related' edges with `crossScope: true` between matching nodes. Skips inferred nodes.
 * @param {import('./alekhdb.js').AlekhDB} db - AlekhDB instance.
 * @returns {void}
 * @example
 * linkCrossDomain(db);  // called by consolidator daemon
 */
function linkCrossDomain(db) {
  const labelGroups = {};
  db.nodes.forEach(n => {
    if (n.isForgotten || n.properties?.archived || n.properties?.compacted || n.isInference) return;
    const s = n.scope || "default";
    if (!labelGroups[n.label]) labelGroups[n.label] = [];
    if (!labelGroups[n.label].find(x => x.scope === s)) labelGroups[n.label].push({ id: n.id, scope: s });
  });
  Object.entries(labelGroups).forEach(([label, entries]) => {
    if (entries.length < 2) return;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const eid = `e-cross-${entries[i].id}-${entries[j].id}`;
        if (db.edgeMap.has(eid)) continue;
        db.addEdge(eid, entries[i].id, entries[j].id, "related", 0.7, true, { crossScope: true, relationType: "cross_domain_link", inferredAt: new Date().toISOString() });
      }
    }
  });
}

/**
 * Recalculate trust scores for all nodes and event frames based on age, recency of access, and contradiction history.
 * Writes a separate `sourceTrust` field on node.properties (does NOT touch cognitiveStrength).
 * Trust decays with age, boosts for recent access, and penalizes for contradictions.
 * @param {import('./alekhdb.js').AlekhDB} db - AlekhDB instance.
 * @returns {void}
 * @example
 * recalcTrust(db);  // called by consolidator daemon
 */
function recalcTrust(db) {
  const now = new Date();
  db.nodes.forEach(n => {
    if (n.isForgotten || n.properties?.compacted) return;
    if (n.properties?.sourceTrust === undefined) n.properties.sourceTrust = 1.0;
    const ageDays = (now - new Date(n.createdAt)) / 86400000;
    const accessRecency = n.properties.lastAccessedAt ? (now - new Date(n.properties.lastAccessedAt)) / 86400000 : ageDays;
    const contradictionPenalty = n.properties.contradictionCount || 0;
    let trust = 1.0 - (ageDays * 0.0005) - (contradictionPenalty * 0.1);
    if (accessRecency < 7) trust += 0.1;
    if (n.properties?.cognitiveStrength && n.properties.cognitiveStrength > 1.5) trust += 0.05;
    n.properties.sourceTrust = parseFloat(Math.max(0.1, Math.min(1.0, trust)).toFixed(3));
  });
  db.eventFrames.forEach(frame => {
    const ageDays = (now - new Date(frame.ts)) / 86400000;
    let trust = frame.sourceTrust || 1.0;
    trust -= ageDays * 0.001;
    frame.sourceTrust = parseFloat(Math.max(0.1, Math.min(1.0, trust)).toFixed(3));
  });
}
