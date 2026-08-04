import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpTrustEventClient } from "../src/trust/HttpTrustEventClient.js";
import type { TrustEvent } from "../src/trust/types.js";

const sampleEvent = (): TrustEvent => ({
  eventId: "e1",
  deviceId: "d1",
  kind: "explicit_message_feedback",
  target: "assistant_message",
  targetId: "m1",
  signal: "trust",
  strength: 0.85,
  ts: "2026-08-04T10:00:00.000Z",
  sessionId: "s1",
  turnId: "t1",
});

describe("HttpTrustEventClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs camelCase events to /v1/trust/events with Authorization", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpTrustEventClient({
      baseUrl: "https://api.example.com/",
      token: "tok-abc",
    });
    const event = sampleEvent();
    await client.append([event]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/trust/events");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer tok-abc",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(init?.body));
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toEqual({
      eventId: event.eventId,
      kind: event.kind,
      target: event.target,
      targetId: event.targetId,
      signal: event.signal,
      strength: event.strength,
      ts: event.ts,
      sessionId: event.sessionId,
      turnId: event.turnId,
      payload: undefined,
    });
  });

  it("throws when response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 502 })),
    );

    const client = new HttpTrustEventClient({
      baseUrl: "http://localhost:8080",
      token: "t",
    });
    await expect(client.append([sampleEvent()])).rejects.toThrow(
      "trust append 502",
    );
  });
});
