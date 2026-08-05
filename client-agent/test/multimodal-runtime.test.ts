import { describe, expect, it } from "vitest";
import { MockLlmTransport } from "../src/llm/MockLlmTransport.js";
import { InMemoryMemoryStore } from "../src/memory/InMemoryMemoryStore.js";
import { DefaultClientAgentRuntime } from "../src/runtime/DefaultClientAgentRuntime.js";
import { MemoryKvStore } from "../src/storage/MemoryKvStore.js";
import { PersistedSessionStore } from "../src/storage/PersistedSessionStore.js";
import { ToolHost } from "../src/tools/ToolHost.js";

describe("multimodal runTurn", () => {
  it("stores user message as content parts when images are provided", async () => {
    const llm = new MockLlmTransport([{ type: "text", content: "ok" }]);
    const runtime = new DefaultClientAgentRuntime({
      llm,
      tools: new ToolHost(),
      defaultMaxIterations: 5,
    });
    const sid = await runtime.createSession();
    await runtime.runTurn(sid, "look", undefined, [
      { dataUrl: "data:image/png;base64,aa" },
    ]);
    const msgs = runtime.getSessionMessages(sid);
    expect(Array.isArray(msgs[0].content)).toBe(true);
    expect(msgs[0].content).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aa" } },
    ]);
    expect(llm.calls[0].messages.some((m) => Array.isArray(m.content))).toBe(true);
  });

  it("keeps string content when no images", async () => {
    const llm = new MockLlmTransport([{ type: "text", content: "ok" }]);
    const runtime = new DefaultClientAgentRuntime({
      llm,
      tools: new ToolHost(),
      defaultMaxIterations: 5,
    });
    const sid = await runtime.createSession();
    await runtime.runTurn(sid, "hi");
    const msgs = runtime.getSessionMessages(sid);
    expect(msgs[0].content).toBe("hi");
  });

  it("persists image content parts through PersistedSessionStore save/load", async () => {
    const kv = new MemoryKvStore();
    const sessionStore = new PersistedSessionStore(kv);
    const llm = new MockLlmTransport([{ type: "text", content: "ok" }]);
    const runtime = new DefaultClientAgentRuntime({
      llm,
      tools: new ToolHost(),
      sessionStore,
      defaultMaxIterations: 5,
    });
    const sid = await runtime.createSession();
    await runtime.runTurn(sid, "look", undefined, [
      { dataUrl: "data:image/png;base64,aa" },
    ]);

    const loaded = await sessionStore.load(sid);
    expect(Array.isArray(loaded?.messages[0].content)).toBe(true);
    expect(loaded?.messages[0].content).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aa" } },
    ]);

    const runtime2 = new DefaultClientAgentRuntime({
      llm: new MockLlmTransport([{ type: "text", content: "next" }]),
      tools: new ToolHost(),
      sessionStore,
      defaultMaxIterations: 5,
    });
    const ids = await runtime2.hydrateSessions();
    expect(ids).toContain(sid);
    expect(runtime2.getSessionMessages(sid)[0].content).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aa" } },
    ]);
  });

  it("commits text-only userMessage and annotates episode with image count", async () => {
    const llm = new MockLlmTransport([{ type: "text", content: "noted" }]);
    const memory = new InMemoryMemoryStore();
    const committed: Array<{ userMessage: string }> = [];
    const orig = memory.commitTurn.bind(memory);
    memory.commitTurn = async (trace) => {
      committed.push({ userMessage: trace.userMessage });
      return orig(trace);
    };

    const runtime = new DefaultClientAgentRuntime({
      llm,
      tools: new ToolHost(),
      memory,
      defaultMaxIterations: 5,
    });
    const sid = await runtime.createSession();
    await runtime.runTurn(sid, "我喜欢蓝色", undefined, [
      { dataUrl: "data:image/png;base64,aa" },
    ]);

    expect(committed[0].userMessage).toBe("我喜欢蓝色");
    expect([...memory.semantic.values()].some((r) => r.text.includes("蓝色"))).toBe(true);
    const epi = [...memory.episode.values()][0];
    expect(epi.summary).toContain("[1 images]");
    expect(epi.summary).toContain("我喜欢蓝色");
  });
});
