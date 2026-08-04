import { describe, expect, it, vi, afterEach } from "vitest";
import { HttpLlmTransport } from "../src/llm/HttpLlmTransport.js";

describe("HttpLlmTransport (real LLM gateway)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("complete posts to /v1/llm/chat with bearer and parses JSON tool_calls", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"/a"}' },
            },
          ],
          finish_reason: "tool_calls",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const llm = new HttpLlmTransport({
      baseUrl: "http://localhost:8080",
      token: "tok-1",
    });
    const result = await llm.complete(
      [{ role: "user", content: "read a" }],
      [
        {
          type: "function",
          function: { name: "read_file", parameters: { type: "object" } },
        },
      ],
    );

    expect(result.tool_calls[0].function.name).toBe("read_file");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8080/v1/llm/chat");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    const body = JSON.parse(String(init.body));
    expect(body.stream).toBe(false);
    expect(body.tools[0].function.name).toBe("read_file");
  });

  it("stream parses SSE delta and done events", async () => {
    const sse = [
      'data:{"type":"delta","text":"Hel"}',
      "",
      'data:{"type":"delta","text":"lo"}',
      "",
      'data:{"type":"done","finish_reason":"stop"}',
      "",
      "",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );

    const llm = new HttpLlmTransport({ baseUrl: "http://gw", token: "t" });
    const chunks: string[] = [];
    const result = await llm.stream([{ role: "user", content: "hi" }], [], (t) => chunks.push(t));
    expect(chunks.join("")).toBe("Hello");
    expect(result.content).toBe("Hello");
    expect(result.finish_reason).toBe("stop");
  });

  it("JSON complete returns and accepts cursor", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: "ok",
          tool_calls: [],
          finish_reason: "stop",
          cursor: "7",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const llm = new HttpLlmTransport({ baseUrl: "http://gw", token: "t" });
    const result = await llm.complete([{ role: "user", content: "hi" }], [], { cursor: "3" });
    expect(result.cursor).toBe("7");
    expect(llm.lastCursor).toBe("7");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Last-Event-ID"]).toBe("3");
    expect(JSON.parse(String(init.body)).cursor).toBe("3");
  });

  it("SSE stream tracks id/cursor and dedups when resuming", async () => {
    const sse = [
      'id: 1',
      'data:{"type":"delta","text":"A","cursor":"1"}',
      "",
      'id: 2',
      'data:{"type":"delta","text":"B","cursor":"2"}',
      "",
      'id: 3',
      'data:{"type":"done","finish_reason":"stop","cursor":"3"}',
      "",
      "",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );
    const llm = new HttpLlmTransport({ baseUrl: "http://gw", token: "t" });
    const chunks: string[] = [];
    // Resume from cursor 1 → skip event 1, keep 2+
    const result = await llm.stream([{ role: "user", content: "hi" }], [], (t) => chunks.push(t), {
      cursor: "1",
    });
    expect(chunks.join("")).toBe("B");
    expect(result.cursor).toBe("3");
    expect(llm.lastCursor).toBe("3");
  });

  it("stream aggregates tool_call SSE events", async () => {
    const sse = [
      'data:{"type":"tool_call","id":"c1","name":"http_request","arguments":"{\\"url\\":\\"https://example.com\\"}"}',
      "",
      'data:{"type":"done","finish_reason":"tool_calls"}',
      "",
      "",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );
    const llm = new HttpLlmTransport({ baseUrl: "http://gw", token: "t" });
    const result = await llm.stream([{ role: "user", content: "fetch" }], [], () => {});
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].function.name).toBe("http_request");
  });

  it("throws on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "unauthorized" }), { status: 401 })),
    );
    const llm = new HttpLlmTransport({ baseUrl: "http://gw", token: "bad" });
    await expect(llm.complete([{ role: "user", content: "x" }], [])).rejects.toThrow(/401/);
  });
});

describe("HttpEmbeddingClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to /v1/llm/embeddings and returns vector + modelId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            model: "text-embedding-3-small",
            data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const { HttpEmbeddingClient } = await import("../src/llm/HttpEmbeddingClient.js");
    const client = new HttpEmbeddingClient({ baseUrl: "http://gw", token: "t" });
    const out = await client.embed("hello");
    expect(out.modelId).toBe("text-embedding-3-small");
    expect(out.embedding).toEqual([0.1, 0.2, 0.3]);
  });
});
