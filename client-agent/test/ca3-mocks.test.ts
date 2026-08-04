import { describe, expect, it } from "vitest";
import { MockLlmTransport } from "../src/llm/MockLlmTransport.js";
import { InMemorySyncBackend } from "../src/sync/InMemorySyncBackend.js";

describe("CA-3.1 MockLlmTransport", () => {
  it("scripts text then tool_calls", async () => {
    const llm = new MockLlmTransport([
      {
        type: "tool_calls",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"a.txt"}' },
          },
        ],
      },
      { type: "text", content: "done" },
    ]);

    const first = await llm.complete([{ role: "user", content: "hi" }], []);
    expect(first.tool_calls).toHaveLength(1);
    expect(first.tool_calls[0].function.name).toBe("read_file");

    const chunks: string[] = [];
    const second = await llm.stream([{ role: "user", content: "hi" }], [], (t) => chunks.push(t));
    expect(second.content).toBe("done");
    expect(chunks.join("")).toBe("done");
    expect(llm.calls).toHaveLength(2);
  });

  it("honors abort signal", async () => {
    const llm = new MockLlmTransport([{ type: "text", content: "x" }]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      llm.complete([{ role: "user", content: "hi" }], [], { signal: ac.signal }),
    ).rejects.toThrow();
  });
});

describe("CA-3.2 InMemorySyncBackend", () => {
  it("push then pull returns mutations with monotonic cursor", () => {
    const backend = new InMemorySyncBackend();
    const mutation = {
      entityType: "semantic" as const,
      entityId: "sem-1",
      version: 1,
      updatedAt: "2026-07-27T02:00:00.000Z",
      deviceId: "dev-1",
      payload: { text: "prefers zh-CN" },
      embedding: [0.1, 0.2],
      embeddingModelId: "text-embedding-3-small",
    };
    expect(backend.push({ deviceId: "dev-1", mutations: [mutation] }).accepted).toBe(1);

    const first = backend.pull("0");
    expect(first.mutations).toHaveLength(1);
    expect(first.mutations[0].entityId).toBe("sem-1");
    expect(Number(first.cursor)).toBeGreaterThan(0);

    const second = backend.pull(first.cursor);
    expect(second.mutations).toHaveLength(0);
    expect(second.cursor).toBe(first.cursor);
  });
});
