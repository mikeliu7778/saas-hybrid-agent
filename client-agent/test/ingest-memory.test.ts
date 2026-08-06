import { describe, it, expect } from "vitest";
import { InMemoryMemoryStore } from "../src/memory/InMemoryMemoryStore.js";
import type { IngestEvent } from "../src/ingest/types.js";

describe("InMemoryMemoryStore.applyIngest", () => {
  it("upserts episode and workspace paths; second call is idempotent", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    const events: IngestEvent[] = [
      {
        eventId: "cursor-sess-1",
        schemaVersion: "1",
        source: "cursor",
        kind: "session_summary",
        summary: "Refactored sync engine",
        paths: ["src/sync/LocalSyncEngine.ts"],
        scrubbed: true,
        tsStart: "2026-08-06T02:00:00.000Z",
        tsEnd: "2026-08-06T02:30:00.000Z",
        nativeSessionId: "sess-1",
      },
      {
        eventId: "ft-1",
        schemaVersion: "1",
        source: "cursor",
        kind: "file_touch",
        summary: "touch",
        paths: ["README.md"],
        scrubbed: true,
      },
    ];

    const r1 = await mem.applyIngest(events);
    expect(r1.accepted).toBe(1);
    expect(r1.duplicates).toBe(0);
    expect(mem.episode.has("epi-ingest-cursor-sess-1")).toBe(true);
    expect(mem.workspacePaths).toEqual(
      expect.arrayContaining(["src/sync/LocalSyncEngine.ts", "README.md"]),
    );

    const r2 = await mem.applyIngest(events);
    expect(r2.accepted).toBe(0);
    expect(r2.duplicates).toBe(1);
    expect(mem.episode.size).toBe(1);

    const listed = await mem.listEpisode();
    expect(listed.some((e) => e.summary.includes("Refactored"))).toBe(true);
  });
});
