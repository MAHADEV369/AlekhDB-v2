# Supermemory Core & Enterprise Upgrade Checklist [COMPLETED]

## Phase 1: Core Engine Upgrades
- [x] Upgrade the Core Engine (`supermemory.js`)
  - [x] Implement zero-dependency native-fetch `LlmClient` class (Gemini, OpenAI, Anthropic, Ollama, vLLM)
  - [x] Integrate Ebbinghaus Forgetting Curve decay and Spaced Repetition reinforcement
  - [x] Integrate Self-Editing Context (Active LLM-guided Node Pruning)
  - [x] Add support for Community Summaries and global GraphRAG search routing
  - [x] Audit-log upgrades for cognitive dissonance/TMS and self-editing

## Phase 2: Backend Services & Containers
- [x] Upgrade Project Dependencies (`package.json`)
  - [x] Add `express`, `cors`, and `multer` dependencies
- [x] Build Express API Gateway (`api.js`)
  - [x] Define endpoints: status, settings, graph, audit, ingest, search, upload, prune, and cluster-trigger
- [x] Build Python FastAPI Multimodal Service (`multimodal.py` & `requirements.txt`)
  - [x] Expose OCR (`/ocr`), Whisper transcription (`/transcribe`), and PDF parses (`/parse-pdf`)
  - [x] Expose Leiden hierarchical clustering module (`/cluster`) using NetworkX/cdlib
- [x] Create Docker Configurations (`Dockerfile`, `Dockerfile.multimodal`, `docker-compose.yml`)

## Phase 3: Visual UI Dashboard Integrations
- [x] Update Dashboard HTML Structure (`index.html`)
  - [x] Add glowing Gear settings button and native `<dialog id="settings-modal">`
  - [x] Add animated Multimodal Upload Drag-and-Drop Dropzone in Senses Tab
  - [x] Add Interactive "Self-Editing Pruning Hub" checkbox panel
- [x] Update Dashboard Stylesheet (`index.css`)
  - [x] Style gear buttons, settings layouts, upload dropzones, and pruning hub lists
- [x] Update UI Logic and Physics Canvas (`app.js`)
  - [x] Add server health probing and auto-switching from LocalStorage to REST API mode
  - [x] Implement dynamic canvas node opacity rendering based on Ebbinghaus decay
  - [x] Bind Settings gear, Dropzone uploads, Pruning skimmer, and Dissonance alerts to backend APIs

## Phase 4: Verification & Commercial Case Study
- [x] Run Integration Verification Tests
  - [x] Verify Local-fallback safety (boot UI with Docker shut down)
  - [x] Verify LLM-guided self-editing context and dynamic pruning
  - [x] Verify Ebbinghaus decay loop and Spaced Repetition reinforcement
- [x] Create Commercial Medical/Infrastructure Use-Case Simulation
- [x] Compile Option 1 & 2 Benefits/Losses Comparison Charts

## Phase 5: Codebase Hardening & Stress-Test Verification
- [x] Execute system-wide scalability stress-test (10,000 asynchronous keys, 1,000 ingestions)
- [x] Restore and audit missing Express and CORS npm modules (`npm install`)
- [x] Repair latent ReferenceError inside `/api/upload` local PDF parser by passing binary buffer
- [x] Upgrade `LlmClient` to retry transient 503/429 cloud errors automatically with backoff
- [x] Implement tokenized GraphRAG sweep keyword matching for natural-language questions
- [x] Verify POSIX virtual shell mounts, trace playbacks, and SRE failure ingests
