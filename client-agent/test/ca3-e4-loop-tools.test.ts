import { describe, expect, it } from "vitest";
import { MockLlmTransport } from "../src/llm/MockLlmTransport.js";
import { DefaultClientAgentRuntime } from "../src/runtime/DefaultClientAgentRuntime.js";
import { ToolHost, unsupportedTool } from "../src/tools/ToolHost.js";
import { createFileTools, MemoryWorkspace } from "../src/tools/fileAndHttpTools.js";

function runtimeWith(llm: MockLlmTransport, tools?: ToolHost) {
  const host = tools ?? new ToolHost();
  return new DefaultClientAgentRuntime({ llm, tools: host, defaultMaxIterations: 5 });
}

describe("CA-E3 ConversationLoop / US-A01-A03", () => {
  it("streams a text-only turn to completion", async () => {
    const llm = new MockLlmTransport([{ type: "text", content: "你好" }]);
    const runtime = runtimeWith(llm);
    const sid = await runtime.createSession();
    const deltas: string[] = [];
    const result = await runtime.runTurn(sid, "hi", (d) => {
      if (d.type === "text" && d.text) deltas.push(d.text);
    });
    expect(result.status).toBe("completed");
    expect(result.assistantText).toBe("你好");
    expect(deltas.join("")).toBe("你好");
    expect(result.iterations).toBe(1);
  });

  it("runs local tool loop then final answer (US-A02)", async () => {
    const ws = new MemoryWorkspace();
    await ws.write("/readme.md", "hello world");
    const host = new ToolHost();
    for (const t of createFileTools(ws)) host.register(t);

    const llm = new MockLlmTransport([
      {
        type: "tool_calls",
        toolCalls: [
          {
            id: "c1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"/readme.md"}' },
          },
        ],
      },
      { type: "text", content: "file says hello world" },
    ]);
    const runtime = runtimeWith(llm, host);
    const sid = await runtime.createSession();
    const result = await runtime.runTurn(sid, "read readme");
    expect(result.status).toBe("completed");
    expect(result.assistantText).toContain("hello world");
    expect(result.iterations).toBe(2);
    expect(llm.calls[0].tools.some((t) => t.function.name === "read_file")).toBe(true);
  });

  it("resets iteration budget each turn", async () => {
    const llm = new MockLlmTransport([
      { type: "text", content: "one" },
      { type: "text", content: "two" },
    ]);
    const runtime = new DefaultClientAgentRuntime({
      llm,
      tools: new ToolHost(),
      defaultMaxIterations: 2,
    });
    const sid = await runtime.createSession({ maxIterations: 2 });
    const r1 = await runtime.runTurn(sid, "a");
    const r2 = await runtime.runTurn(sid, "b");
    expect(r1.iterations).toBe(1);
    expect(r2.iterations).toBe(1);
    expect(r1.status).toBe("completed");
    expect(r2.status).toBe("completed");
  });

  it("returns model-visible error for unknown tool without crashing", async () => {
    const llm = new MockLlmTransport([
      {
        type: "tool_calls",
        toolCalls: [
          {
            id: "c1",
            type: "function",
            function: { name: "nope", arguments: "{}" },
          },
        ],
      },
      { type: "text", content: "handled" },
    ]);
    const runtime = runtimeWith(llm);
    const sid = await runtime.createSession();
    const result = await runtime.runTurn(sid, "x");
    expect(result.status).toBe("completed");
    const msgs = runtime.getSessionMessages(sid);
    const toolMsg = msgs.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("Unknown tool");
  });

  it("cancels when interrupt is set before model call (US-A03)", async () => {
    const llm = new MockLlmTransport([{ type: "text", content: "should not run" }]);
    const runtime = runtimeWith(llm);
    const sid = await runtime.createSession();
    await runtime.interrupt(sid);
    const result = await runtime.runTurn(sid, "go");
    expect(result.status).toBe("cancelled");
    expect(result.iterations).toBe(0);
    expect(llm.calls).toHaveLength(0);
  });

  it("allows a new turn after a cancelled turn", async () => {
    const llm = new MockLlmTransport([{ type: "text", content: "after" }]);
    const runtime = runtimeWith(llm);
    const sid = await runtime.createSession();
    await runtime.interrupt(sid);
    await runtime.runTurn(sid, "cancelled");
    const result = await runtime.runTurn(sid, "continue");
    expect(result.status).toBe("completed");
    expect(result.assistantText).toBe("after");
  });
});

describe("CA-E4 ToolHost / US-A04", () => {
  it("rejects path escape", async () => {
    const ws = new MemoryWorkspace();
    const host = new ToolHost();
    for (const t of createFileTools(ws)) host.register(t);
    const r = await host.execute(
      "read_file",
      '{"path":"../../etc/passwd"}',
      { sessionId: "s", workdir: "/" },
    );
    expect(r.ok).toBe(false);
    expect(r.content).toContain("escapes");
  });

  it("sandbox file tools read/write/list", async () => {
    const ws = new MemoryWorkspace();
    const host = new ToolHost();
    for (const t of createFileTools(ws)) host.register(t);
    const ctx = { sessionId: "s", workdir: "/" };
    expect((await host.execute("write_file", '{"path":"/a.txt","content":"x"}', ctx)).ok).toBe(true);
    expect((await host.execute("read_file", '{"path":"/a.txt"}', ctx)).content).toBe("x");
    expect((await host.execute("list_dir", '{"path":"/"}', ctx)).content).toContain("a.txt");
  });

  it("http_request denies non-allowlisted host", async () => {
    const { createHttpTool } = await import("../src/tools/fileAndHttpTools.js");
    const host = new ToolHost();
    host.register(createHttpTool(["example.com"]));
    const r = await host.execute(
      "http_request",
      '{"url":"https://evil.test/x"}',
      { sessionId: "s", workdir: "/" },
    );
    expect(r.ok).toBe(false);
    expect(r.content).toContain("not allowlisted");
  });

  it("run_terminal is unsupported (US-A04)", async () => {
    const host = new ToolHost();
    host.register(unsupportedTool("run_terminal", "Shell is not available on Web"));
    const r = await host.execute("run_terminal", '{"cmd":"ls"}', {
      sessionId: "s",
      workdir: "/",
    });
    expect(r.unsupported).toBe(true);
    expect(r.content).toContain("unsupported");
  });
});
