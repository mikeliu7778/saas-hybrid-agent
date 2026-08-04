import { describe, expect, it } from "vitest";
import {
  cosine,
  hashEmbed,
  InMemoryMemoryStore,
} from "../src/memory/InMemoryMemoryStore.js";
import { InMemorySyncBackend } from "../src/sync/InMemorySyncBackend.js";
import { LocalSyncEngine } from "../src/sync/LocalSyncEngine.js";
import { MockLlmTransport } from "../src/llm/MockLlmTransport.js";
import { DefaultClientAgentRuntime } from "../src/runtime/DefaultClientAgentRuntime.js";
import { ToolHost } from "../src/tools/ToolHost.js";

describe("CA-E5 Memory / US-M01 M02 M03", () => {
  it("stores semantic preference and retrieves by similarity", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    await mem.commitTurn({
      sessionId: "s",
      turnId: "t1",
      userMessage: "我喜欢简体中文",
      assistantText: "好的，记住了",
    });
    expect(mem.semantic.size).toBe(1);
    const bundle = await mem.retrieve("语言偏好 简体");
    expect(bundle.semantic.length).toBeGreaterThan(0);
    expect(bundle.semantic[0].text).toContain("简体中文");
  });

  it("writes episode summaries and applies time decay scoring", async () => {
    const mem = new InMemoryMemoryStore();
    const emb = hashEmbed("resume");
    mem.upsertEpisode({
      id: "old",
      summary: "Helped revise resume",
      embedding: emb,
      timeRangeStart: "2026-01-01T00:00:00.000Z",
      timeRangeEnd: "2026-01-01T01:00:00.000Z",
      messageRefs: [],
      updatedAt: "2026-01-01T01:00:00.000Z",
      deviceId: "d",
      version: 1,
    });
    mem.upsertEpisode({
      id: "new",
      summary: "Helped revise resume recently",
      embedding: emb,
      timeRangeStart: new Date().toISOString(),
      timeRangeEnd: new Date().toISOString(),
      messageRefs: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d",
      version: 1,
    });
    const bundle = await mem.retrieve("resume");
    expect(bundle.episode[0].id).toBe("new");
  });

  it("workspace path hints from query tokens", async () => {
    const mem = new InMemoryMemoryStore();
    mem.workspacePaths = ["/notes/resume.md", "/notes/todo.md"];
    const bundle = await mem.retrieve("open resume");
    expect(bundle.workspaceHints.some((h) => h.includes("resume"))).toBe(true);
  });

  it("cosine similarity is 1 for identical vectors", () => {
    const v = hashEmbed("abc");
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it("runtime injects memory into system prompt path", async () => {
    const mem = new InMemoryMemoryStore();
    mem.upsertSemantic({
      id: "s1",
      text: "User timezone is Asia/Shanghai",
      embedding: hashEmbed("timezone shanghai"),
      tags: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d",
      version: 1,
    });
    const llm = new MockLlmTransport([{ type: "text", content: "ok" }]);
    const runtime = new DefaultClientAgentRuntime({
      llm,
      tools: new ToolHost(),
      memory: mem,
    });
    const sid = await runtime.createSession();
    await runtime.runTurn(sid, "what is my timezone shanghai?");
    const system = llm.calls[0].messages[0];
    expect(system.role).toBe("system");
    expect(system.content).toContain("Asia/Shanghai");
  });
});

describe("CA-E6 SyncEngine / US-S01 S02", () => {
  it("device A push semantic → device B pull can retrieve", async () => {
    const backend = new InMemorySyncBackend();
    const memA = new InMemoryMemoryStore({ deviceId: "A" });
    const memB = new InMemoryMemoryStore({ deviceId: "B" });
    const syncA = new LocalSyncEngine(backend, memA, "A");
    const syncB = new LocalSyncEngine(backend, memB, "B");

    const text = "prefers dark mode";
    const emb = hashEmbed(text);
    syncA.enqueue({
      entityType: "semantic",
      entityId: "sem-shared",
      version: 1,
      updatedAt: "2026-07-27T04:00:00.000Z",
      deviceId: "A",
      payload: { text, tags: ["ui"] },
      embedding: emb,
      embeddingModelId: "hash-32",
    });
    await syncA.push();
    await syncB.pull();

    const bundle = await memB.retrieve("dark mode preference");
    expect(bundle.semantic.some((s) => s.id === "sem-shared")).toBe(true);
    expect(bundle.semantic[0].text).toContain("dark mode");
  });

  it("LWW keeps higher version", async () => {
    const backend = new InMemorySyncBackend();
    const mem = new InMemoryMemoryStore({ deviceId: "B" });
    const sync = new LocalSyncEngine(backend, mem, "B");
    mem.upsertSemantic({
      id: "sem-1",
      text: "old",
      embedding: hashEmbed("old"),
      tags: [],
      updatedAt: "2026-07-27T01:00:00.000Z",
      deviceId: "A",
      version: 1,
    });
    backend.push({
      deviceId: "A",
      mutations: [
        {
          entityType: "semantic",
          entityId: "sem-1",
          version: 2,
          updatedAt: "2026-07-27T02:00:00.000Z",
          deviceId: "A",
          payload: { text: "new" },
          embedding: hashEmbed("new"),
        },
      ],
    });
    await sync.pull();
    expect(mem.semantic.get("sem-1")?.text).toBe("new");
    expect(mem.semantic.get("sem-1")?.version).toBe(2);
  });

  it("tombstone hides semantic from retrieve", async () => {
    const backend = new InMemorySyncBackend();
    const mem = new InMemoryMemoryStore({ deviceId: "B" });
    const sync = new LocalSyncEngine(backend, mem, "B");
    mem.upsertSemantic({
      id: "sem-x",
      text: "gone",
      embedding: hashEmbed("gone"),
      tags: [],
      updatedAt: "2026-07-27T01:00:00.000Z",
      deviceId: "A",
      version: 1,
    });
    backend.push({
      deviceId: "A",
      mutations: [
        {
          entityType: "semantic",
          entityId: "sem-x",
          version: 2,
          updatedAt: "2026-07-27T03:00:00.000Z",
          deviceId: "A",
          tombstone: true,
          payload: {},
        },
      ],
    });
    await sync.pull();
    const bundle = await mem.retrieve("gone");
    expect(bundle.semantic.every((s) => s.id !== "sem-x")).toBe(true);
  });
});
