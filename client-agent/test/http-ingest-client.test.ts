import { describe, it, expect, vi, afterEach } from "vitest";
import {
  HttpIngestEventClient,
  toIngestAnalyticsEvents,
} from "../src/ingest/HttpIngestEventClient.js";
import type { IngestEvent } from "../src/ingest/types.js";

describe("HttpIngestEventClient (I3b)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs analytics-only events without summary text", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ accepted: 1, duplicates: 0 }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpIngestEventClient({
      baseUrl: "https://api.example.com/",
      token: "tok",
    });
    await client.append([
      {
        eventId: "ing-1",
        source: "cursor",
        kind: "session_summary",
        ts: "2026-08-06T10:00:00.000Z",
        pathCount: 2,
      },
    ]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/ingest/events");
    const body = JSON.parse(String(init?.body));
    expect(body.events[0].summary).toBeUndefined();
    expect(body.events[0]).toMatchObject({
      eventId: "ing-1",
      source: "cursor",
      kind: "session_summary",
      pathCount: 2,
    });
  });

  it("toIngestAnalyticsEvents strips summary", () => {
    const events: IngestEvent[] = [
      {
        eventId: "e1",
        schemaVersion: "1",
        source: "hybrid",
        kind: "session_summary",
        summary: "secret sk-abcdefghijklmnopqrstuvwxyz012345",
        paths: ["a.ts"],
        scrubbed: true,
        tsEnd: "2026-08-06T12:00:00.000Z",
      },
    ];
    const analytics = toIngestAnalyticsEvents(events, { deviceId: "d1" });
    expect(JSON.stringify(analytics)).not.toContain("sk-");
    expect(JSON.stringify(analytics)).not.toContain("secret");
    expect(analytics[0]).toEqual({
      eventId: "e1",
      source: "hybrid",
      kind: "session_summary",
      ts: "2026-08-06T12:00:00.000Z",
      deviceId: "d1",
      nativeSessionId: undefined,
      pathCount: 1,
    });
  });
});
