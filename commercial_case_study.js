// AlekhDB Enterprise - Commercial Medical & Infrastructure Case Study (commercial_case_study.js)
// This script seeds and tests high-fidelity GraphRAG models for Medical & Industrial Infrastructure domains.

import { AlekhDB } from "./alekhdb.js";

async function runCaseStudy() {
  console.log("==========================================================================");
  console.log("🏥 STARTING COMMERCIAL CASE STUDY: MEDICAL & INFRASTRUCTURE GRAPHRAG SEED");
  console.log("==========================================================================\n");

  const sm = new AlekhDB(true);
  sm.autoSave = false; // Disable auto-save for atomicity
  sm.clearToDefault();

  // ==========================================
  // 1. MEDICAL DOMAIN: ONCOLOGY PATIENT HUB
  // ==========================================
  console.log("🩺 Seeding Medical Oncology Patient Graph...");
  
  // Base Patient & Clinicians
  sm.addNode("patient-elizabeth", "Elizabeth Miller (Patient)", "client", {
    age: 58,
    diagnosis: "Stage II Breast Cancer",
    allergyRestriction: "Penicillin",
    primaryDiet: "Ketogenic"
  }, "medical");

  sm.addNode("doctor-adams", "Dr. Charles Adams (Oncologist)", "clinician", {
    department: "Clinical Oncology",
    subSpecialty: "Immunotherapy",
    prefCommChannel: "Secure Portal"
  }, "medical");

  // Clinical treatment history & files
  sm.addNode("file-lab-q1", "Biopsy Report Q1 2026", "file", {
    path: "/records/biopsy_elizabeth_q1.pdf",
    tumorSize: "2.1 cm",
    receptorStatus: "ER+/PR+/HER2-"
  }, "medical");

  sm.addNode("tech-regimen-ac", "ACT Chemotherapy Regimen", "technology", {
    dosingInterval: "14 Days",
    activeAgents: "Doxorubicin, Cyclophosphamide, Paclitaxel"
  }, "medical");

  // Build medical relationships
  sm.addEdge("e-med-1", "doctor-adams", "patient-elizabeth", "treats_patient", 1.0, true);
  sm.addEdge("e-med-2", "doctor-adams", "tech-regimen-ac", "prescribes_regimen", 1.0, true);
  sm.addEdge("e-med-3", "patient-elizabeth", "file-lab-q1", "has_medical_file", 0.9, true);

  // Link Elizabeth directly to her AC regimen
  sm.addEdge("e-med-active-regimen", "patient-elizabeth", "tech-regimen-ac", "undergoing_regimen", 1.0, true);

  console.log("✔ Oncology patient records indexed.");

  // ==========================================
  // 2. INFRASTRUCTURE DOMAIN: POWER GRID CONTROL
  // ==========================================
  console.log("\n⚡ Seeding Industrial Smart Grid Infrastructure Graph...");

  // Control Center & Substation
  sm.addNode("grid-control-center", "NE Grid Command Hub", "substation", {
    region: "Northeast US",
    telemetryProtocol: "Modbus TCP"
  }, "infrastructure");

  sm.addNode("substation-sub-42", "Substation 42 (NE-Feeder)", "substation", {
    maxLoadKva: 50000,
    activeTransformers: 3
  }, "infrastructure");

  // Monitoring systems & logs
  sm.addNode("tech-telemetry-modbus", "Modbus Legacy Telemetry", "technology", {
    pollingIntervalMs: 500,
    baudRate: 9600,
    port: 502
  }, "infrastructure");

  sm.addEdge("e-infra-1", "grid-control-center", "substation-sub-42", "monitors_grid", 1.0, true);
  sm.addEdge("e-infra-active-protocol", "grid-control-center", "tech-telemetry-modbus", "uses_telemetry", 1.0, true);

  console.log("✔ Power grid substation network topology mapped.");

  // Save base database state
  sm.autoSave = true;
  sm.save();

  console.log("\n--------------------------------------------------------------------------");
  console.log("🧬 STEP 3: TESTING TMS CONTRADICTION & CHROMATIC SELF-EDITING PRUNING");
  console.log("--------------------------------------------------------------------------");

  // 1. INFRASTRUCTURE CONTRADICTION & MIGRATION TEST
  console.log("\n[Ingest Event]: NE Command Hub modernizes telemetry, migrating from Modbus to MQTT IoT protocol.");
  const gridMigrationResult = await sm.addMemory(
    "Command Center migrated to MQTT IoT protocol on May 29 2026, deactivating Modbus Legacy Telemetry due to security patch restrictions.", 
    "infrastructure"
  );

  console.log("Conflict Log Resolution:", gridMigrationResult.conflict);

  // Let's check if the Modbus telemetry edge was successfully soft-decayed
  const modbusEdge = sm.edges.find(e => e.id === "e-infra-active-protocol");
  console.log(`Modbus Telemetry Edge Status: Active = ${modbusEdge.active}, Decayed Weight = ${modbusEdge.weight}`);

  // 2. MEDICAL CLINICAL REVISION (Belief Dissonance)
  console.log("\n[Ingest Event]: Dr. Adams switches Elizabeth Miller to Immunotherapy due to ER+ chemo resistance.");
  const medicalRevisionResult = await sm.addMemory(
    "Dr. Charles Adams prescribes Immunotherapy regimen for Elizabeth Miller, deactivating the chemotherapy AC regimen.",
    "medical"
  );
  
  console.log("Clinical TMS Audit Log:", medicalRevisionResult.conflict);

  // 3. EBBINGHAUS DECAY & CONTEXT PRUNING TEST
  console.log("\n--------------------------------------------------------------------------");
  console.log("📉 STEP 4: VERIFYING EBBINGHAUS FORGETTING CURVE & CONTEXT PRUNING");
  console.log("--------------------------------------------------------------------------");

  console.log("Recalculating forgetting decay...");
  // Simulate Ebbinghaus decay over 24 hours of inactivity (decayRate = 0.05 per hour)
  sm.applyEbbinghausDecay(0.05);

  // Print decayed strengths of documents
  const elizabethNode = sm.nodes.find(n => n.id === "patient-elizabeth");
  const labFileNode = sm.nodes.find(n => n.id === "file-lab-q1");

  console.log(`Elizabeth Miller Node Strength: ${elizabethNode.properties.cognitiveStrength}`);
  console.log(`Biopsy Report Q1 File Strength: ${labFileNode.properties.cognitiveStrength}`);

  // Simulate spaced repetition reinforcement (Elizabeth searched/accessed)
  console.log("\nRunning RAG Search query for 'Elizabeth Miller' (Simulates Spaced Repetition recall)...");
  const searchResult = await sm.search("Elizabeth Miller", "medical");
  
  // Re-verify strength has boosted
  console.log(`Reinforced Elizabeth Miller Node Strength: ${elizabethNode.properties.cognitiveStrength}`);

  // Perform Chroma-1 active context pruning
  console.log("\nRunning active context pruning skimmer...");
  const prunedCount = sm.pruneNodes(["file-lab-q1"]);
  console.log(`Successfully pruned ${prunedCount} redundant nodes from active memory footprint.`);

  // Save final state
  sm.save();

  console.log("\n==========================================================================");
  console.log("🎉 COMMERCIAL CASE STUDY SEEDING & SIMULATION COMPLETED SUCCESSFULLY");
  console.log("==========================================================================");
}

runCaseStudy();
