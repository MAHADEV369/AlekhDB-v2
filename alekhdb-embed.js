// alekhdb-embed.js — Elective local embeddings module
// Deps: @huggingface/transformers (auto-installed on first use, or pre-installed)
// Model: Xenova/all-MiniLM-L6-v2 (384-dim, ~25MB, ~20ms per embedding on CPU)

let pipeline = null;
let modelLoaded = false;

export async function enableEmbeddings(db, config = {}) {
  const { model = 'Xenova/all-MiniLM-L6-v2', dtype = 'q8', autoEmbed = true } = config;
  if (!pipeline) {
    try {
      const transformers = await import('@huggingface/transformers');
      pipeline = await transformers.pipeline('feature-extraction', model, { dtype });
      modelLoaded = true;
    } catch (err) {
      console.error('[alekhdb-embed] Failed to load transformers.js:', err.message);
      console.error('Install with: npm install @huggingface/transformers');
      return false;
    }
  }
  const embedFn = async (text) => {
    const output = await pipeline(text, { pooling: 'mean', normalize: true });
    return Float32Array.from(output.data);
  };
  db._embedFn = embedFn;
  db._embedModel = model;
  db._embedConfig = { autoEmbed };
  if (autoEmbed) {
    const originalAddNode = db.addNode.bind(db);
    db.addNode = function(id, label, type, properties = {}, scope = "work", options = {}) {
      originalAddNode(id, label, type, properties, scope, options);
      const node = db.nodeMap.get(id);
      if (node && autoEmbed) {
        const text = `${label} ${type} ${JSON.stringify(properties)}`;
        embedFn(text).then(vec => { node.properties.embedding = vec; node.properties.embeddingModel = model; node.properties.embeddingsVersion = 1; db._markDirty(); }).catch(err => console.error('[alekhdb-embed] Embed failed:', err.message));
      }
      return node;
    };
  }
  db.embedAll = async function() {
    let count = 0;
    for (const [id, node] of db.nodeMap) {
      if (node.properties?.archived || node.isForgotten) continue;
      const text = `${node.label} ${node.type} ${JSON.stringify(node.properties)}`;
      node.properties.embedding = await embedFn(text);
      node.properties.embeddingModel = model;
      node.properties.embeddingsVersion = 1;
      count++;
      if (count % 100 === 0) console.log(`[alekhdb-embed] Embedded ${count}...`);
    }
    db._markDirty();
    return count;
  };
  db.searchVector = async function(query, k = 10) {
    return db.searchHybrid(query, 'all', { signals: { keyword: 0, vector: 1.0, entity: 0, temporal: 0, cognitive: 0 }, limit: k });
  };
  db.disableEmbeddings = function() { db._embedFn = null; db._embedModel = null; };
  return true;
}

export async function enableReranking(db, config = {}) {
  const { model = 'Xenova/ms-marco-MiniLM-L-6-v2' } = config;
  let rerankPipeline = null;
  try {
    const transformers = await import('@huggingface/transformers');
    rerankPipeline = await transformers.pipeline('text-classification', model, { dtype: 'q8' });
  } catch (err) {
    console.error('[rerank] Failed to load reranker:', err.message);
    return false;
  }
  db._rerankFn = async (query, results) => {
    for (const r of results) {
      try {
        const score = await rerankPipeline(`${query} [SEP] ${r.node.label}`);
        r.rerankScore = score[0]?.score || r.score;
      } catch (e) { r.rerankScore = r.score; }
    }
  };
  return true;
}
