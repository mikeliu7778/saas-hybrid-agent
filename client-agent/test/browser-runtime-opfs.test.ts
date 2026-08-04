import { describe, expect, it, vi, afterEach } from "vitest";
import { createBrowserRuntime } from "../src/runtime/createBrowserRuntime.js";
import { createMemoryOpfsRoot } from "../src/storage/memoryOpfsRoot.js";
import { DefaultClientAgentRuntime } from "../src/runtime/DefaultClientAgentRuntime.js";
import { MockLlmTransport } from "../src/llm/MockLlmTransport.js";
import { ToolHost } from "../src/tools/ToolHost.js";
import { MemoryKvStore } from "../src/storage/MemoryKvStore.js";
import { PersistedSessionStore } from "../src/storage/PersistedSessionStore.js";

describe("createBrowserRuntime + session persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("wires HttpLlmTransport and OPFS-backed stores", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/embeddings")) {
          return new Response(
            JSON.stringify({
              model: "text-embedding-3-small",
              data: [{ index: 0, embedding: [0.2, 0.1, 0.0, 0.3] }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ content: "from gateway", tool_calls: [], finish_reason: "stop" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const root = createMemoryOpfsRoot();
    const { runtime, workspace } = await createBrowserRuntime({
      baseUrl: "http://localhost:8080",
      token: "dev-token",
      opfsRoot: root,
      httpAllowlist: ["example.com"],
    });

    await workspace.write("/hello.txt", "opfs");
    const sid = await runtime.createSession();
    const result = await runtime.runTurn(sid, "say hi");
    expect(result.status).toBe("completed");
    expect(result.assistantText).toBe("from gateway");

    // New runtime instance hydrates session from OPFS
    const again = await createBrowserRuntime({
      baseUrl: "http://localhost:8080",
      token: "dev-token",
      opfsRoot: root,
    });
    const ids = await again.runtime.hydrateSessions();
    expect(ids).toContain(sid);
    expect(again.runtime.getSessionMessages(sid).some((m) => m.role === "user")).toBe(true);
    expect(await again.workspace.read("/hello.txt")).toBe("opfs");
  });

  it("DefaultClientAgentRuntime persists sessions via KvStore", async () => {
    const kv = new MemoryKvStore();
    const sessionStore = new PersistedSessionStore(kv);
    const llm = new MockLlmTransport([{ type: "text", content: "ok" }]);
    const runtime = new DefaultClientAgentRuntime({
      llm,
      tools: new ToolHost(),
      sessionStore,
    });
    const sid = await runtime.createSession();
    await runtime.runTurn(sid, "persist me");

    const runtime2 = new DefaultClientAgentRuntime({
      llm: new MockLlmTransport([{ type: "text", content: "next" }]),
      tools: new ToolHost(),
      sessionStore,
    });
    await runtime2.hydrateSessions();
    expect(runtime2.getSessionMessages(sid)[0].content).toBe("persist me");
  });
});
