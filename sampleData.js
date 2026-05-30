// AlekhDB Core - Pre-seeded Sample Data & Timeline Timeline (sampleData.js)

export const initialNodes = [
  // --- SOFTWARE DEVELOPMENT AGENT DOMAIN ---
  {
    id: "user-trident",
    label: "Trident (Developer)",
    type: "user",
    properties: { name: "Trident", occupation: "Software Engineer" },
    scope: "personal"
  },
  {
    id: "project-alekhdb",
    label: "Project AlekhDB",
    type: "project",
    properties: { description: "GraphRAG AI memory layer", version: "v1.0.0" },
    scope: "work"
  },
  {
    id: "tech-nodejs",
    label: "Node.js",
    type: "technology",
    properties: { category: "Runtime", version: "20.x", performance: "High" },
    scope: "work"
  },
  {
    id: "tech-bun",
    label: "Bun.sh",
    type: "technology",
    properties: { category: "Runtime/Bundler", version: "1.1.x", performance: "Ultra-Fast" },
    scope: "work"
  },
  {
    id: "db-sqlite",
    label: "SQLite",
    type: "database",
    properties: { type: "Relational", storage: "File-based", latency: "<2ms" },
    scope: "work"
  },

  // --- B2B SALES & ACCOUNT MANAGEMENT AGENT DOMAIN ---
  {
    id: "company-cluely",
    label: "Cluely Inc.",
    type: "company",
    properties: { sector: "B2B SaaS", size: "Enterprise", status: "Active Pipeline" },
    scope: "work"
  },
  {
    id: "client-sarah",
    label: "Sarah (Product Lead)",
    type: "client",
    properties: { role: "Decision Maker", status: "Champion", preferredChannel: "Email" },
    scope: "work"
  },
  {
    id: "client-john",
    label: "John (VP Engineering)",
    type: "client",
    properties: { role: "Executive Sign-off", status: "Gatekeeper", preferredChannel: "Discord" },
    scope: "work"
  },

  // --- LEGAL CASE STRATEGY AGENT DOMAIN ---
  {
    id: "case-alpha",
    label: "Alpha vs Beta Corp",
    type: "legal-case",
    properties: { jurisdiction: "Delaware Court of Chancery", type: "IP Trade Secret Theft" },
    scope: "legal"
  },
  {
    id: "precedent-law-a",
    label: "Dupont v. Christopher (1970)",
    type: "precedent",
    properties: { coreHolding: "Aerial photography of unfinished plant constitutes trade secret theft" },
    scope: "legal"
  }
];

export const initialEdges = [
  // Software connections
  { id: "e1", source: "user-trident", target: "project-alekhdb", label: "architects", weight: 1.0, active: true },
  { id: "e2", source: "project-alekhdb", target: "tech-nodejs", label: "uses_backend", weight: 1.0, active: true },
  { id: "e3", source: "project-alekhdb", target: "db-sqlite", label: "uses_storage", weight: 1.0, active: true },

  // B2B Sales connections
  { id: "e4", source: "user-trident", target: "company-cluely", label: "manages_deal", weight: 1.0, active: true },
  { id: "e5", source: "client-sarah", target: "company-cluely", label: "works_at", weight: 1.0, active: true },
  { id: "e6", source: "client-john", target: "company-cluely", label: "works_at", weight: 1.0, active: true },
  { id: "e7", source: "client-sarah", target: "client-john", label: "reports_to", weight: 1.0, active: true },

  // Legal connections
  { id: "e8", source: "user-trident", target: "case-alpha", label: "litigates", weight: 1.0, active: true },
  { id: "e9", source: "case-alpha", target: "precedent-law-a", label: "cites_precedent", weight: 1.0, active: true }
];

// Chronological timeline steps demonstrating dynamic Graph conflicts and compaction (Time-Travel)
export const timelineEvents = [
  {
    day: 1,
    title: "Initial Setup",
    description: "The core stack runs on Node.js. Sarah is our active contact at Cluely via Email.",
    changes: {
      edgesToActivate: ["e2"],
      edgesToDecay: [],
      propertiesToUpdate: {
        "client-sarah": { status: "Champion", preferredChannel: "Email" }
      }
    }
  },
  {
    day: 5,
    title: "Bun Migration & Deal Shifting",
    description: "CONFLICT RESOLUTION EVENT: Project AlekhDB migrates backend from Node.js to Bun. Sarah gets promoted and John takes over her budget (John prefers Discord).",
    changes: {
      edgesToActivate: [],
      edgesToDecay: ["e2"], // Node.js connection decayed
      newEdges: [
        { id: "e-bun-migration", source: "project-alekhdb", target: "tech-bun", label: "uses_backend", weight: 1.0, active: true }
      ],
      propertiesToUpdate: {
        "client-sarah": { role: "VP Product", preferredChannel: "Email" },
        "client-john": { role: "Decision Maker / Budget Holder", preferredChannel: "Discord" }
      },
      conflictLog: "Decayed 'uses_backend' Node.js link. Migrated dependency stack to Bun.sh at 14:02. John took over budget control for Cluely deal."
    }
  },
  {
    day: 10,
    title: "Preemptive Compaction",
    description: "CONTEXT COMPACTION EVENT: Context usage reaches 85%. Automated core scheduler compresses old raw webhook receipts and logs into a single compact Node.",
    changes: {
      newNodes: [
        {
          id: "node-compaction-summary",
          label: "Q2 Core Activity Summary",
          type: "summary",
          properties: { contents: "Consolidated all active code chunk migrations (Node -> Bun) and verified SQLite db indexes.", compactedAt: "Day 10" },
          scope: "work"
        }
      ],
      newEdges: [
        { id: "e-compaction-link", source: "project-alekhdb", target: "node-compaction-summary", label: "summarized_in", weight: 1.0, active: true }
      ],
      compactionEvent: true
    }
  }
];

export const initialTraces = [
  {
    traceId: "trace-demo-deployment",
    agentId: "codex",
    sessionId: "session-42",
    taskId: "deploy-production",
    status: "finalized",
    outcome: "failure",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    finalizedAt: new Date(Date.now() - 3000000).toISOString(),
    quarantined: false,
    compacted: false
  }
];

export const initialEventFrames = [
  {
    id: "frame-seed-1",
    traceId: "trace-demo-deployment",
    stepIdx: 0,
    ts: new Date(Date.now() - 3500000).toISOString(),
    toolCallJson: { tool: "shell", cmd: "docker build -t cluely:v1.0.0 ." },
    toolResultJson: { exit_code: 0, stdout: "Successfully built image cluely:v1.0.0" },
    stateSnapshotJson: { cluster: "production", service: "payments" },
    errorSignature: "",
    privacyTags: ["infrastructure"],
    sourceTrust: 1.0,
    extractedBeliefs: []
  },
  {
    id: "frame-seed-2",
    traceId: "trace-demo-deployment",
    stepIdx: 1,
    ts: new Date(Date.now() - 3200000).toISOString(),
    toolCallJson: { tool: "shell", cmd: "kubectl apply -f deployment.yaml" },
    toolResultJson: { exit_code: 1, stderr: "ImagePullBackOff: Repository tag cluely:v1.0.0 not found; registry has migrated to v1.1.x due to security vulnerability remediation." },
    stateSnapshotJson: { cluster: "production", service: "payments" },
    errorSignature: "kubernetes:image-pull-back-off",
    privacyTags: ["infrastructure"],
    sourceTrust: 1.0,
    extractedBeliefs: []
  }
];
