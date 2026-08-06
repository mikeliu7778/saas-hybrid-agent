import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  hashEmbed,
  InMemoryMemoryStore,
} from "../src/memory/InMemoryMemoryStore.js";
import { encodeMemoryPack } from "../src/memory/memoryPack.js";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("MCP stdio server smoke", () => {
  it("lists tools and searches memory from pack", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    mem.upsertSemantic({
      id: "sem-mcp",
      text: "prefer Simplified Chinese",
      embedding: hashEmbed("Simplified Chinese"),
      tags: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d1",
      version: 1,
    });
    const dir = mkdtempSync(join(tmpdir(), "hybrid-mcp-"));
    const packPath = join(dir, "pack.json");
    writeFileSync(packPath, Buffer.from(encodeMemoryPack(mem)));

    const serverJs = join(root, "dist/mcp/server.js");
    const child = spawn(process.execPath, [serverJs], {
      env: { ...process.env, HYBRID_MEMORY_PACK: packPath },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: string[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d.toString("utf8")));

    const send = (obj: unknown) => {
      child.stdin.write(`${JSON.stringify(obj)}\n`);
    };

    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await new Promise((r) => setTimeout(r, 200));
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await new Promise((r) => setTimeout(r, 200));
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "memory_search",
        arguments: { query: "Chinese" },
      },
    });
    await new Promise((r) => setTimeout(r, 400));
    child.stdin.end();
    await new Promise((r) => child.on("close", r));

    const out = chunks.join("");
    expect(out).toContain("memory_search");
    expect(out).toContain("memory_get");
    expect(out).toContain("sem-mcp");
  }, 15_000);
});
