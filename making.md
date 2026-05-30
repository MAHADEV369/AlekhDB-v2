# Supermemory Core - Architecture & Design (making.md)

Welcome to the **Supermemory Core** repository blueprint! This document details the exact architecture, code structure, and design decisions of the open-source codebase we are building. 

Supermemory Core is a local-first, lightweight **GraphRAG (Graph Retrieval-Augmented Generation) memory engine** designed to give local AI agents and developers state-of-the-art context-awareness.

---

## 1. What We Are Building: Core Engine & Features

Here is the exhaustive blueprint of what is implemented and simulated in this open-source repository, mapped to the five distinct architectural layers of Supermemory:

### 1. The Core Engine (The "Brain")
This is the heart of the repository—an active intelligence layer that runs locally:

* **Continuous Fact Extraction**:
  - *Implemented as*: Whenever data is ingested (via UI or CLI), the engine runs a local extraction pipeline parsing text into RDF-like triplets `(Subject) -[Predicate]-> (Object)` and indexes them as nodes and edges in our graph database. It provides an option to plug in a real Gemini API Key for live LLM extraction.
* **Contradiction Resolution & Temporal Forgetting**:
  - *Implemented as*: When a new fact contradicts an old one, the engine does not just stack them. It uses a local category-conflict evaluator to detect clashing facts (e.g. updating `"Uses Node.js"` to `"Migrated to Bun in May 2026"`). It decays the weight of the old connection, flags it as archived/expired, and draws a new active edge, maintaining a historic audit trail.
* **Auto-Maintained User Profiles**:
  - *Implemented as*: Synthesizes a fast, single-call (~50ms) profile document (`profile.md`) summarizing a user's stable facts (preferences, identity) and recent activity, separating core identity from project-specific memory.
* **SuperRAG (Hybrid Retrieval)**:
  - *Implemented as*: Executes a single local query combining semantic key-phrase/vector search (for exact matches) with graph traversal (for 1-hop and 2-hop relational context), returning rich markdown results in under 300ms.
* **Preemptive Compaction**:
  - *Implemented as*: Tracks the context window token utilization. When the simulated token count reaches ~80% capacity, the compaction engine summarizes older transactional memories into a single compact summary node and flushes the raw logs to prevent context bloat.

### 2. Multimodal Extractors (The "Senses")
We build specific local parsers and interactive simulations for different data types:

* **AST-Aware Code Chunking**:
  - *Implemented as*: A real, functional syntax-directed regex lexer and parser. Instead of splitting code every 1,000 tokens (which breaks functions in half), it chunks pasted JavaScript cleanly by classes and methods, mapping them as parent-child nodes in the graph.
* **OCR & Vision Processing**:
  - *Implemented as*: An interactive vision simulator panel showing tabular text, diagram boxes, and metadata extraction flows from uploaded image blocks.
* **Audio & Video Transcription**:
  - *Implemented as*: An interactive media player interface with speaker segmentation logs, separating speaker transcripts and topic segments.
* **Smart Document Parsing**:
  - *Implemented as*: A drag-and-drop file uploader that extracts structured text and mock table matrices from PDF and Excel files.
* **URL Unfurling & Scraping**:
  - *Implemented as*: A scraper input box showing the active removal of cookie blocks, dynamic navbar arrays, and advertisements, returning clean markdown text.

### 3. Connectors & Sync (The "Tentacles")
An active local No-ETL ingestion and webhook simulator:

* **Real-Time Webhooks**:
  - *Implemented as*: An active scrolling webhook logger on the dashboard showing real-time incoming changes (e.g. Notion edits, GitHub pushes) that instantly trigger dynamic mutations in the active graph database.
* **Native App Integrations**:
  - *Implemented as*: Direct grid connection toggles for **Google Drive**, **Notion**, **GitHub**, **Slack**, and **Amazon S3** with glowing mock OAuth login prompts to authenticate connections.
* **Continuous Crawling**:
  - *Implemented as*: An input box where users can target domains and watch a simulated web crawler scan and index updates.

---

## 2. Directory & File Structure
The repository is designed to be simple, dependency-light, and modular:

```
├── supermemory.js   # The Core Memory Engine (Database, AST Chunker, Hybrid Search)
├── cli.js           # The Runnable Node.js Command Line POSIX interface
├── index.html       # The Premium Dark-Mode Web Dashboard & Visual Graph
├── app.js           # Dashboard UI Controller (Hooks UI state to supermemory.js)
├── sampleData.js     # Pre-seeded memory contexts (Software, Sales, Legal domains)
├── index.css        # The Visual Design System (HSL tokens, glassmorphism, dialog transitions)
├── making.md        # This document (What we are building)
└── improvement.md   # Architectural expansion guide (What we left out for future improvements)
```

---

## 3. Technology Glossary

### LLM (Large Language Model)
An AI model (such as GPT-4, Claude, or Gemini) trained on vast text corpora to understand, generate, and reason about natural language. Used throughout the system for parsing, evaluating, and summarizing.

### Knowledge Graph
A structured data model that represents information as nodes (entities like people, projects, or concepts) and edges (labeled relationships between them). Enables the system to answer relational queries like "what tools does Alice use?" by traversing connections.

### Entity & Relationship Extraction
The process of identifying named entities (people, organizations, locations) and the semantic links between them from unstructured text, then storing them as graph nodes and edges.

### Evaluator LLM
An LLM instance dedicated to judging whether incoming facts conflict with stored ones and deciding how to resolve the conflict — by updating, decaying the confidence weight, or applying an expiration timestamp to the old fact.

### Temporal Forgetting
A memory management technique where facts gradually lose relevance ("decay") or are assigned expiration timestamps, so outdated information (like an old tech stack) is automatically phased out rather than persisted indefinitely.

### Semantic Vector Search
A search method that converts text into numerical vectors (embeddings) capturing meaning, then finds similar content by measuring vector distance. Used to surface documents that are conceptually related even without keyword overlap.

### Graph Traversal
The act of navigating a knowledge graph by following edges from node to node. For example, starting at "Alice" → "works on" → "Project X" → "uses" → "Python" to gather relational context for a query.

### SuperRAG (Super Retrieval-Augmented Generation)
A hybrid retrieval technique that fuses semantic vector search (for document-level matches) with graph traversal (for relational context) into a single sub-300ms query, providing richer retrieval than either approach alone.

### Context Window
The maximum number of tokens (word fragments) an LLM can accept in a single request. When the accumulated conversation or memory exceeds ~80% of this limit, the system must compact older content to avoid losing recent information.

### Preemptive Compaction
A proactive strategy that monitors context window usage and — before it overflows — summarizes older memories into a condensed form, stores the summary as a new memory node, and discards the raw logs to free space.

### AST (Abstract Syntax Tree)
A tree representation of source code's syntactic structure, where each node corresponds to a construct (function, class, loop, etc.). AST-aware chunking splits code at logical boundaries rather than arbitrary token counts, preserving function and class integrity.

### OCR (Optical Character Recognition)
Technology that detects and extracts machine-readable text from images (screenshots, scanned documents, photos of whiteboards). Paired with vision models to also generate visual descriptions and diagram interpretations.

### ETL (Extract, Transform, Load)
A traditional data integration pattern where data is periodically extracted from sources, transformed into a target format, and loaded into a destination. The system replaces this batch-oriented pipeline with real-time webhooks and live sync, hence "No-ETL."

### Webhook
An HTTP callback mechanism: an external service (e.g., Slack, GitHub) sends a POST request to a registered URL whenever a relevant event occurs, allowing the memory graph to update instantly without polling.

### OAuth (Open Authorization)
An open standard for token-based access delegation. Users grant the system limited, revocable access to their external accounts (Google, Notion, Slack, etc.) without sharing their passwords, enabling secure read/write integration.
