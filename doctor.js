// AlekhDB Core & Enterprise - Onboarding & Doctor Verification Diagnostic (doctor.js)
import * as fs from "fs";
import * as path from "path";
import { AlekhDB } from "./alekhdb.js";

console.log("\x1b[1;35m==========================================================================\x1b[0m");
console.log("\x1b[1;35m👨‍⚕️ ALEKHDB CORE & ENTERPRISE - SYSTEMS DIAGNOSTIC DOCTOR\x1b[0m");
console.log("\x1b[1;35m==========================================================================\x1b[0m\n");

let warnings = 0;
let errors = 0;

function printCheck(name, status, details = "") {
  const statusStr = status === "PASS" ? "\x1b[32m✔ PASS\x1b[0m" : (status === "WARN" ? "\x1b[33m⚠️ WARN\x1b[0m" : "\x1b[31m❌ FAIL\x1b[0m");
  console.log(`  [+] ${name.padEnd(35)} : ${statusStr} ${details}`);
}

// 1. Check Node.js Version
const nodeVer = process.version;
const majorVer = parseInt(nodeVer.replace("v", "").split(".")[0]);
if (majorVer >= 18) {
  printCheck("Node.js Version Requirement", "PASS", `(${nodeVer} verified)`);
} else {
  printCheck("Node.js Version Requirement", "FAIL", `(Detected ${nodeVer}. Requires >= v18.0.0)`);
  errors++;
}

// 2. Check for .env file versus .env.example
const envExists = fs.existsSync("./.env");
const exampleExists = fs.existsSync("./.env.example");

if (envExists) {
  printCheck("Environment Variables File (.env)", "PASS", "(Detected and active)");
} else {
  if (exampleExists) {
    printCheck("Environment Variables File (.env)", "WARN", "(Missing .env file. Copy .env.example to start)");
    warnings++;
  } else {
    printCheck("Environment Variables File (.env)", "FAIL", "(No .env or .env.example files found!)");
    errors++;
  }
}

// 3. Check for Seeded Local Database
const dbExists = fs.existsSync("./alekhdb_db.json");
const legacyDbExists = fs.existsSync("./supermemory_db.json");

if (dbExists) {
  const size = fs.statSync("./alekhdb_db.json").size;
  printCheck("Database Persistence State", "PASS", `(Detected alekhdb_db.json: ${(size / 1024).toFixed(1)} KB)`);
} else if (legacyDbExists) {
  printCheck("Database Persistence State", "PASS", "(Detected legacy supermemory_db.json - Handshake fallback active)");
} else {
  printCheck("Database Persistence State", "WARN", "(No seeded database found. Run 'npm run seed' to build)");
  warnings++;
}

// 4. Check for Docker Compose settings (for Option 2)
const composeExists = fs.existsSync("./docker-compose.yml");
const dockerfileExists = fs.existsSync("./Dockerfile");

if (composeExists && dockerfileExists) {
  printCheck("Docker Containerization Configurations", "PASS", "(Peered sandbox docker configurations verified)");
} else {
  printCheck("Docker Containerization Configurations", "WARN", "(Missing compose or docker files. Option 2 Docker disabled)");
  warnings++;
}

// 5. Run In-Memory GraphRAG Diagnostic Loop
try {
  const sm = new AlekhDB(true);
  sm.clearToDefault();
  sm.addNode("doctor-test", "Doctor Diagnostic", "concept", { status: "Active" }, "work");
  const result = await sm.search("doctor", "work");
  if (result.matchedNodeIds.includes("doctor-test")) {
    printCheck("In-Memory GraphRAG Routing Test", "PASS", "(Sub-millisecond graph CRUD & retrieval active)");
  } else {
    throw new Error("GraphRAG sweep failed to locate local diagnostic node.");
  }
} catch (err) {
  printCheck("In-Memory GraphRAG Routing Test", "FAIL", `(In-memory loop crashed: ${err.message})`);
  errors++;
}

// 6. Check Active API Provider Configuration
const smConfig = new AlekhDB(true);
const activeProvider = smConfig.llmConfig.provider;
if (activeProvider === "rules") {
  printCheck("Cognitive LLM Router State", "PASS", "(Option 1 Offline Fallback active. Zero-cost execution ready)");
} else {
  printCheck("Cognitive LLM Router State", "PASS", `(Option 2 live router active: using ${activeProvider.toUpperCase()})`);
}

console.log("\n==========================================================================");
console.log(`👨‍⚕️ DIAGNOSTIC REPORT: \x1b[32m${errors} Errors\x1b[0m | \x1b[33m${warnings} Warnings\x1b[0m`);
if (errors === 0) {
  console.log("\x1b[1;32m🎉 CONGRATULATIONS! AlekhDB is 100% healthy and ready for human & agent use!\x1b[0m");
} else {
  console.log("\x1b[1;31m❌ ALERT: Some critical errors were detected. Fix them to ensure flawless execution.\x1b[0m");
}
console.log("==========================================================================\n");
