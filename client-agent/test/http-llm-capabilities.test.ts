import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchLlmCapabilities } from "../src/llm/HttpLlmCapabilities.js";

describe("HttpLlmCapabilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses vision flag", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ vision: true, model: "gpt-4o-mini" }), { status: 200 });
    const c = await fetchLlmCapabilities({
      baseUrl: "http://localhost:8080",
      token: "t",
      model: "gpt-4o-mini",
    });
    expect(c.vision).toBe(true);
  });

  it("GETs /v1/llm/capabilities with bearer and query params", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ vision: false, model: "gpt-3.5-turbo" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const c = await fetchLlmCapabilities({
      baseUrl: "http://localhost:8080/",
      token: "tok",
      model: "gpt-3.5-turbo",
      provider: "openai",
    });

    expect(c).toEqual({ vision: false, model: "gpt-3.5-turbo" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:8080/v1/llm/capabilities?model=gpt-3.5-turbo&provider=openai",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});
