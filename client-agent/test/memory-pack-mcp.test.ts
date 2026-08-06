import { describe, it, expect } from "vitest";
import {
  hashEmbed,
  InMemoryMemoryStore,
} from "../src/memory/InMemoryMemoryStore.js";
import {
  decodeMemoryPack,
  encodeMemoryPack,
  memoryGet,
  memorySearch,
} from "../src/memory/memoryPack.js";
import { DefaultClientAgentRuntime } from "../src/runtime/DefaultClientAgentRuntime.js";
import { MockLlmTransport } from "../src/llm/MockLlmTransport.js";
import { ToolHost } from "../src/tools/ToolHost.js";

describe("MemoryPack I4a", () => {
  it("round-trips semantic, episode, procedural, workspace", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    mem.upsertSemantic({
      id: "sem-1",
      text: "prefer pnpm",
      embedding: hashEmbed("prefer pnpm"),
      tags: ["preference"],
      updatedAt: "2026-08-06T00:00:00.000Z",
      deviceId: "d1",
      version: 1,
      trustScore: 0.7,
    });
    mem.upsertEpisode({
      id: "epi-1",
      summary: "fixed auth",
      embedding: hashEmbed("fixed auth"),
      timeRangeStart: "2026-08-06T00:00:00.000Z",
      timeRangeEnd: "2026-08-06T00:00:00.000Z",
      messageRefs: [],
      updatedAt: "2026-08-06T00:00:00.000Z",
      deviceId: "d1",
      version: 1,
      source: "hybrid",
    });
    mem.upsertProcedural({
      id: "proc-1",
      skillId: "s1",
      text: "1. build\n2. test",
      steps: ["build", "test"],
      embedding: hashEmbed("build test"),
      updatedAt: "2026-08-06T00:00:00.000Z",
      deviceId: "d1",
      version: 1,
    });
    mem.workspacePaths = ["src/a.ts"];

    const bytes = encodeMemoryPack(mem);
    const mem2 = new InMemoryMemoryStore({ deviceId: "d2" });
    decodeMemoryPack(mem2, bytes);

    expect(mem2.semantic.get("sem-1")?.text).toBe("prefer pnpm");
    expect(mem2.episode.get("epi-1")?.summary).toBe("fixed auth");
    expect(mem2.procedural.get("proc-1")?.skillId).toBe("s1");
    expect(mem2.workspacePaths).toEqual(["src/a.ts"]);
  });

  it("runtime export/import MemoryPack", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    mem.upsertSemantic({
      id: "sem-x",
      text: "timezone Asia/Shanghai",
      embedding: hashEmbed("timezone"),
      tags: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d1",
      version: 1,
    });
    const runtime = new DefaultClientAgentRuntime({
      llm: new MockLlmTransport([{ type: "text", content: "ok" }]),
      tools: new ToolHost(),
      memory: mem,
    });
    const pack = await runtime.exportMemoryPack();
    const memB = new InMemoryMemoryStore({ deviceId: "d2" });
    const runtimeB = new DefaultClientAgentRuntime({
      llm: new MockLlmTransport([{ type: "text", content: "ok" }]),
      tools: new ToolHost(),
      memory: memB,
    });
    await runtimeB.importMemoryPack(pack);
    expect(memB.semantic.get("sem-x")?.text).toContain("Shanghai");
  });
});

describe("memorySearch / memoryGet", () => {
  it("searches across types and gets by id", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    mem.upsertSemantic({
      id: "sem-1",
      text: "prefer JWT cookies",
      embedding: hashEmbed("JWT cookies"),
      tags: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d1",
      version: 1,
    });
    mem.upsertEpisode({
      id: "epi-1",
      summary: "JWT auth flake fixed",
      embedding: hashEmbed("JWT auth flake"),
      timeRangeStart: new Date().toISOString(),
      timeRangeEnd: new Date().toISOString(),
      messageRefs: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d1",
      version: 1,
    });

    const hits = await memorySearch(mem, "JWT");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.id === "sem-1" || h.id === "epi-1")).toBe(true);

    const one = await memoryGet(mem, "sem-1");
    expect(one?.kind).toBe("semantic");
    expect(one?.text).toContain("JWT");
    expect(await memoryGet(mem, "missing")).toBeNull();
  });

  it("excludes deprecated from search", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    mem.upsertEpisode({
      id: "epi-bad",
      summary: "wrong JWT advice",
      embedding: hashEmbed("wrong JWT"),
      timeRangeStart: new Date().toISOString(),
      timeRangeEnd: new Date().toISOString(),
      messageRefs: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d1",
      version: 1,
      deprecated: true,
    });
    const hits = await memorySearch(mem, "JWT");
    expect(hits.find((h) => h.id === "epi-bad")).toBeUndefined();
  });
});
