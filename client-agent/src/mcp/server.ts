/**
 * Minimal MCP stdio server (I4a) — read-only personal Memory tools.
 *
 * Env:
 *   HYBRID_MEMORY_PACK  path to MemoryPack JSON (from exportMemoryPack)
 *
 * Tools:
 *   memory_search { query, limit? }
 *   memory_get    { id }
 *
 * Speaks newline-delimited JSON-RPC on stdin/stdout (easy to test).
 * For IDE MCP hosts that require Content-Length framing, wrap or extend later.
 *
 * Run: npm run mcp  (from client-agent after build)
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { InMemoryMemoryStore } from "../memory/InMemoryMemoryStore.js";
import {
  decodeMemoryPack,
  memoryGet,
  memorySearch,
} from "../memory/memoryPack.js";

const PROTOCOL_VERSION = "2024-11-05";

function loadStore(): InMemoryMemoryStore {
  const path = process.env.HYBRID_MEMORY_PACK;
  const store = new InMemoryMemoryStore({ deviceId: "mcp" });
  if (!path) return store;
  decodeMemoryPack(store, new Uint8Array(readFileSync(path)));
  return store;
}

const store = loadStore();

const TOOLS = [
  {
    name: "memory_search",
    description:
      "Search the Hybrid personal knowledge base (semantic, episode, procedural, workspace). Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max hits (default 8)" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_get",
    description: "Fetch one Memory item by id. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory row id" },
      },
      required: ["id"],
    },
  },
];

type JsonRpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

function reply(msg: JsonRpc): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handleRequest(msg: JsonRpc): Promise<void> {
  const id = msg.id ?? null;
  const method = msg.method ?? "";

  try {
    if (method === "initialize") {
      reply({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "saas-hybrid-memory", version: "0.1.0" },
        },
      });
      return;
    }
    if (method === "notifications/initialized" || method === "initialized") {
      return;
    }
    if (method === "tools/list") {
      reply({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (method === "tools/call") {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (name === "memory_search") {
        const hits = await memorySearch(
          store,
          String(args.query ?? ""),
          typeof args.limit === "number" ? args.limit : 8,
        );
        reply({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(hits, null, 2) }],
            isError: false,
          },
        });
        return;
      }
      if (name === "memory_get") {
        const record = await memoryGet(store, String(args.id ?? ""));
        reply({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: record ? JSON.stringify(record, null, 2) : "null",
              },
            ],
            isError: false,
          },
        });
        return;
      }
      reply({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      });
      return;
    }
    if (method === "ping") {
      reply({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    reply({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    reply({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed) as JsonRpc;
      if (msg.method) await handleRequest(msg);
    } catch (err) {
      process.stderr.write(`MCP parse error: ${String(err)}\n`);
    }
  }
}

void main();
