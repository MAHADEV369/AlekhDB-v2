// AlekhDB - Model Context Protocol (MCP) JSON-RPC Standard Server (mcp_server.js)
import { AlekhDB } from "./alekhdb.js";
import { exec } from "child_process";
import * as path from "path";

const sm = new AlekhDB(true); // Node.js mode
sm.autoSave = true;

// Configure default Gemini key for Option 2 if present in environment
if (process.env.GEMINI_API_KEY) {
  sm.llmConfig = {
    provider: "gemini",
    apiKey: process.env.GEMINI_API_KEY,
    endpoint: "",
    model: "gemini-2.5-flash"
  };
}

let buffer = "";

// Listen to stdin for incoming JSON-RPC agent queries
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  
  let boundary = buffer.indexOf("\n");
  while (boundary !== -1) {
    const line = buffer.slice(0, boundary).trim();
    buffer = buffer.slice(boundary + 1);
    
    if (line) {
      handleRequest(line);
    }
    boundary = buffer.indexOf("\n");
  }
});

async function handleRequest(line) {
  try {
    const req = JSON.parse(line);
    const { method, id, params } = req;
    
    if (method === "initialize") {
      sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "alekhdb-mcp-server",
          version: "1.0.0"
        }
      });
      return;
    }
    
    if (method === "tools/list") {
      sendResponse(id, {
        tools: [
          {
            name: "alekhdb_add",
            description: "Ingest a new text statement or website URL scraper memory into the AlekhDB GraphRAG database.",
            inputSchema: {
              type: "object",
              properties: {
                text: { "type": "string", "description": "The raw fact or website URL to ingest" },
                scope: { "type": "string", "description": "The target scope (default: work)" }
              },
              required: ["text"]
            }
          },
          {
            name: "alekhdb_search",
            description: "Search the AlekhDB database using GraphRAG hybrid retrieval (keyword sweeps + 2-degree neighborhood traversals) and synthesize a cohesive Markdown answer.",
            inputSchema: {
              type: "object",
              properties: {
                query: { "type": "string", "description": "The search question or concept query" },
                scope: { "type": "string", "description": "The scope boundaries to search (default: all)" }
              },
              required: ["query"]
            }
          },
          {
            name: "alekhdb_profile",
            description: "Retrieve the live-synthesized Markdown developer profile outlining stable preferences and active contexts.",
            inputSchema: {
              type: "object",
              properties: {}
            }
          }
        ]
      });
      return;
    }
    
    if (method === "tools/call") {
      const { name, arguments: args } = params;
      let resultText = "";
      
      if (name === "alekhdb_add") {
        const scope = args.scope || "work";
        const result = await sm.addMemory(args.text, scope);
        resultText = `Successfully ingested memory into scope '#${scope}'. Nodes created: ${result.nodes?.length || 0}. Conflict Alert: ${result.conflict || "None"}`;
      } else if (name === "alekhdb_search") {
        const scope = args.scope || "all";
        const result = await sm.search(args.query, scope);
        resultText = result.synthesis;
      } else if (name === "alekhdb_profile") {
        resultText = sm.profile();
      } else {
        throw new Error(`Tool not found: ${name}`);
      }
      
      sendResponse(id, {
        content: [
          {
            type: "text",
            text: resultText
          }
        ]
      });
      return;
    }
    
    // Ignore other notifications or methods silently
  } catch (err) {
    // Return error frame
    try {
      const req = JSON.parse(line);
      sendError(req.id, -32603, err.message);
    } catch (e) {
      sendError(null, -32700, "Parse error");
    }
  }
}

function sendResponse(id, result) {
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id,
    result
  }) + "\n");
}

function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message }
  }) + "\n");
}
