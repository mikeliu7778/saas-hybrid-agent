import { describe, it, expect } from "vitest";
import { scrubText, scrubEvent } from "../src/ingest/scrub.js";
import { applyIngestEvents } from "../src/ingest/applyIngest.js";
import type { IngestEvent } from "../src/ingest/types.js";

function baseEvent(over: Partial<IngestEvent> = {}): IngestEvent {
  return {
    eventId: "evt-1",
    schemaVersion: "1",
    source: "cursor",
    kind: "session_summary",
    summary: "Fixed auth flake",
    paths: [],
    scrubbed: true,
    tsStart: "2026-08-06T01:00:00.000Z",
    tsEnd: "2026-08-06T01:10:00.000Z",
    ...over,
  };
}

describe("scrubText", () => {
  it("redacts OpenAI-style and Cursor API keys", () => {
    const raw =
      "use sk-abcdefghijklmnopqrstuvwxyz012345 and crsr_abcdefghijklmnopqrstuvwxyz";
    const out = scrubText(raw);
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(out).not.toContain("crsr_abcdefghijklmnopqrstuvwxyz");
    expect(out).toContain("[REDACTED]");
  });
});

describe("applyIngestEvents", () => {
  it("maps session_summary to episode with stable id", () => {
    const result = applyIngestEvents([baseEvent()], { existingEpisodeIds: new Set() });
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0].id).toBe("epi-ingest-evt-1");
    expect(result.episodes[0].summary).toBe("Fixed auth flake");
    expect(result.episodes[0].source).toBe("cursor");
  });

  it("is idempotent on eventId when episode already exists", () => {
    const result = applyIngestEvents([baseEvent()], {
      existingEpisodeIds: new Set(["epi-ingest-evt-1"]),
    });
    expect(result.episodes).toHaveLength(0);
    expect(result.skippedDuplicateIds).toEqual(["evt-1"]);
  });

  it("collects file_touch paths into workspacePaths", () => {
    const result = applyIngestEvents(
      [
        baseEvent({
          eventId: "ft-1",
          kind: "file_touch",
          summary: "touched",
          paths: ["src/auth.ts", "src/auth.ts", "README.md"],
        }),
      ],
      { existingEpisodeIds: new Set(), existingWorkspacePaths: ["README.md"] },
    );
    expect(result.episodes).toHaveLength(0);
    expect(result.workspacePathsAdded.sort()).toEqual(["src/auth.ts"]);
  });

  it("ignores raw_marker", () => {
    const result = applyIngestEvents(
      [baseEvent({ eventId: "r1", kind: "raw_marker", summary: "noise" })],
      { existingEpisodeIds: new Set() },
    );
    expect(result.episodes).toHaveLength(0);
    expect(result.workspacePathsAdded).toHaveLength(0);
  });

  it("scrubs summary before applying when not marked scrubbed", () => {
    const result = applyIngestEvents(
      [
        baseEvent({
          eventId: "s1",
          scrubbed: false,
          summary: "key sk-abcdefghijklmnopqrstuvwxyz012345 leaked",
        }),
      ],
      { existingEpisodeIds: new Set() },
    );
    expect(result.episodes[0].summary).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
  });
});

describe("scrubEvent", () => {
  it("marks scrubbed true", () => {
    const e = scrubEvent(baseEvent({ scrubbed: false, summary: "ok" }));
    expect(e.scrubbed).toBe(true);
  });
});
