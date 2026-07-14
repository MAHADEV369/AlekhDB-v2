// alekhdb-context.js — Elective: token-aware context packing
// No new deps. Uses db.searchHybrid() + string packing.
// Returns prompt-ready markdown string within a token budget.

export async function getContext(db, options = {}) {
  const { query, maxTokens = 4000, includeProfile = true, includeRelations = true, includeTraces = false, signals = { keyword: 0.3, vector: 0.5, entity: 0.2 }, filters = null, scope = "all" } = options;
  if (!query?.trim()) return { context: "", sources: [], tokenCount: 0 };

  const searchResults = await db.searchHybrid(query, scope, { signals, filters, limit: 50 });

  let profileText = "";
  if (includeProfile) {
    const profile = db.profile();
    if (profile) profileText = `## User Profile\n${profile}\n\n`;
  }

  const approxToken = (text) => Math.ceil(text.length / 4);
  let currentTokens = approxToken(profileText);
  const packedMemories = [];
  const sources = [];

  for (const result of searchResults.results) {
    const memoryText = `${result.label} (type: ${result.type}, score: ${result.score.toFixed(3)})\n`;
    const memTokens = approxToken(memoryText);
    if (currentTokens + memTokens > maxTokens) break;
    packedMemories.push(`${packedMemories.length + 1}. ${memoryText.trim()}`);
    sources.push({ id: result.id, score: result.score, type: result.type });
    currentTokens += memTokens;
    if (includeRelations && result.id) {
      const history = db.getHistory(result.id);
      if (history.length > 1) {
        const histText = `   ^ Updated through ${history.length} versions (latest: v${history[0].version})\n`;
        if (currentTokens + approxToken(histText) <= maxTokens) { packedMemories[packedMemories.length - 1] += "\n" + histText.trim(); currentTokens += approxToken(histText); }
      }
    }
  }

  let tracesText = "";
  if (includeTraces && db.traces.length > 0) {
    const recentTraces = db.traces.slice(-3);
    tracesText = `\n## Recent Agent Activity\n`;
    recentTraces.forEach(t => {
      const tText = `- Trace ${t.traceId}: ${t.taskId} (${t.status}, outcome: ${t.outcome})\n`;
      if (currentTokens + approxToken(tText) <= maxTokens) { tracesText += tText; currentTokens += approxToken(tText); }
    });
  }

  let context = "";
  if (profileText) context += profileText;
  if (packedMemories.length > 0) context += `## Relevant Memories\n${packedMemories.join('\n')}\n\n`;
  if (tracesText) context += tracesText;

  return { context: context.trim(), sources, tokenCount: currentTokens, profileIncluded: !!profileText, memoriesIncluded: packedMemories.length };
}
