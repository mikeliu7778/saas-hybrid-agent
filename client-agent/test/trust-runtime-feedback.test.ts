import { describe, it, expect, vi } from "vitest";
import { hashEmbed, InMemoryMemoryStore } from "../src/memory/InMemoryMemoryStore.js";
import { MockLlmTransport } from "../src/llm/MockLlmTransport.js";
import { DefaultClientAgentRuntime } from "../src/runtime/DefaultClientAgentRuntime.js";
import type { MemoryOrchestrator } from "../src/runtime/types.js";
import { ToolHost } from "../src/tools/ToolHost.js";
import { TrustEventQueue } from "../src/trust/TrustEventQueue.js";
import type { TrustEvent } from "../src/trust/types.js";

function makeRuntime(
  mem: MemoryOrchestrator,
  extras?: {
    trustQueue?: TrustEventQueue;
    trustClient?: { append: (events: TrustEvent[]) => Promise<void> };
  },
) {
  return new DefaultClientAgentRuntime({
    llm: new MockLlmTransport([{ type: "text", content: "ok" }]),
    tools: new ToolHost(),
    memory: mem,
    trustQueue: extras?.trustQueue,
    trustClient: extras?.trustClient,
  });
}

describe("Runtime trust feedback APIs", () => {
  it("commitTurn preference then deleteMemory excludes from retrieve but lists as deprecated", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    await mem.commitTurn({
      sessionId: "s",
      turnId: "t1",
      userMessage: "我喜欢简体中文",
      assistantText: "好的，记住了",
    });
    expect(mem.semantic.size).toBe(1);
    const id = [...mem.semantic.keys()][0]!;

    const runtime = makeRuntime(mem);
    await runtime.deleteMemory(id);

    const bundle = await mem.retrieve("简体中文");
    expect(bundle.semantic.find((s) => s.id === id)).toBeUndefined();

    const listed = await runtime.listMemory();
    expect(listed.some((m) => m.id === id && m.deprecated === true)).toBe(true);
  });

  it("submitFeedback trust raises memory trustScore", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    mem.upsertSemantic({
      id: "sem-1",
      text: "prefers dark mode",
      embedding: hashEmbed("dark mode"),
      tags: ["preference"],
      updatedAt: new Date().toISOString(),
      deviceId: "d1",
      version: 1,
      trustScore: 0.5,
    });

    const runtime = makeRuntime(mem);
    const sessionId = await runtime.createSession();
    await runtime.submitFeedback({
      sessionId,
      turnId: "t1",
      target: "memory_item",
      targetId: "sem-1",
      signal: "trust",
    });

    expect(mem.semantic.get("sem-1")!.trustScore).toBeGreaterThan(0.5);
  });

  it("runTurn awaits commitTurn before returning TurnResult", async () => {
    const baseMem = new InMemoryMemoryStore({ deviceId: "d1" });
    let commitFinished = false;
    const mem: MemoryOrchestrator = {
      retrieve: (query) => baseMem.retrieve(query),
      commitTurn: async (trace) => {
        await new Promise((r) => setTimeout(r, 50));
        await baseMem.commitTurn(trace);
        commitFinished = true;
      },
      applyTrust: (event) => baseMem.applyTrust!(event),
      listSemantic: () => baseMem.listSemantic!(),
      deleteSemantic: (id) => baseMem.deleteSemantic!(id),
    };

    const runtime = makeRuntime(mem);
    const sessionId = await runtime.createSession();
    const started = Date.now();
    const result = await runtime.runTurn(sessionId, "我喜欢简体中文");
    const elapsed = Date.now() - started;

    expect(result.status).toBe("completed");
    expect(commitFinished).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(45);
    const listed = await runtime.listMemory();
    expect(listed.some((m) => m.text.includes("简体中文"))).toBe(true);
  });

  it("runTurn applies implicit reuse and fire-and-forget flush", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    mem.upsertSemantic({
      id: "sem-reuse",
      text: "User timezone is Asia/Shanghai",
      embedding: hashEmbed("timezone shanghai"),
      tags: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d1",
      version: 1,
      trustScore: 0.5,
    });

    const append = vi.fn(async (_events: TrustEvent[]) => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const queue = new TrustEventQueue();
    const runtime = makeRuntime(mem, { trustQueue: queue, trustClient: { append } });

    const sessionId = await runtime.createSession();
    const started = Date.now();
    const result = await runtime.runTurn(sessionId, "what is my timezone shanghai?");
    const elapsed = Date.now() - started;

    expect(result.status).toBe("completed");
    // Must not await the slow flush before returning
    expect(elapsed).toBeLessThan(30);
    expect(mem.semantic.get("sem-reuse")!.trustScore).toBeGreaterThan(0.5);

    await vi.waitFor(() => expect(append).toHaveBeenCalled());
    const sent = append.mock.calls[0]![0] as TrustEvent[];
    expect(sent.some((e) => e.targetId === "sem-reuse" && e.signal === "trust")).toBe(
      true,
    );
  });

  it("setTrustReportingEnabled(false) keeps events local on flush", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    mem.upsertSemantic({
      id: "sem-1",
      text: "fact",
      embedding: hashEmbed("fact"),
      tags: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d1",
      version: 1,
    });
    const append = vi.fn(async () => {});
    const queue = new TrustEventQueue();
    const runtime = makeRuntime(mem, { trustQueue: queue, trustClient: { append } });
    runtime.setTrustReportingEnabled(false);

    const sessionId = await runtime.createSession();
    await runtime.submitFeedback({
      sessionId,
      target: "memory_item",
      targetId: "sem-1",
      signal: "trust",
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(append).not.toHaveBeenCalled();
    expect(queue.pendingCount()).toBe(1);
  });
});
