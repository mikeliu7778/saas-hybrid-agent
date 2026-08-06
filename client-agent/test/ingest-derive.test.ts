import { describe, it, expect } from "vitest";
import { applyIngestEvents } from "../src/ingest/applyIngest.js";
import { deriveIngestEvents } from "../src/ingest/deriveFromSummary.js";
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
    ...over,
  };
}

describe("applyIngestEvents I1a kinds", () => {
  it("maps decision to semantic draft", () => {
    const result = applyIngestEvents(
      [
        baseEvent({
          eventId: "d1",
          kind: "decision",
          summary: "We decided to use JWT for auth",
        }),
      ],
      {
        existingEpisodeIds: new Set(),
        existingSemanticIds: new Set(),
        existingProceduralIds: new Set(),
      },
    );
    expect(result.semantic).toHaveLength(1);
    expect(result.semantic[0].id).toBe("sem-ingest-d1");
    expect(result.semantic[0].text).toContain("JWT");
    expect(result.episodes).toHaveLength(0);
  });

  it("maps procedure_draft to procedural draft", () => {
    const result = applyIngestEvents(
      [
        baseEvent({
          eventId: "p1",
          kind: "procedure_draft",
          summary: "How to run e2e",
          skillHint: "1. npm test\n2. npm run e2e",
        }),
      ],
      {
        existingEpisodeIds: new Set(),
        existingSemanticIds: new Set(),
        existingProceduralIds: new Set(),
      },
    );
    expect(result.procedural).toHaveLength(1);
    expect(result.procedural[0].id).toBe("proc-ingest-p1");
    expect(result.procedural[0].text).toContain("e2e");
    expect(result.procedural[0].steps?.length).toBeGreaterThan(0);
  });

  it("is idempotent for semantic and procedural", () => {
    const events = [
      baseEvent({ eventId: "d1", kind: "decision", summary: "Prefer pnpm" }),
      baseEvent({
        eventId: "p1",
        kind: "procedure_draft",
        summary: "Release checklist",
        skillHint: "1. bump\n2. tag",
      }),
    ];
    const result = applyIngestEvents(events, {
      existingEpisodeIds: new Set(),
      existingSemanticIds: new Set(["sem-ingest-d1"]),
      existingProceduralIds: new Set(["proc-ingest-p1"]),
    });
    expect(result.semantic).toHaveLength(0);
    expect(result.procedural).toHaveLength(0);
    expect(result.skippedDuplicateIds).toEqual(["d1", "p1"]);
  });
});

describe("deriveIngestEvents", () => {
  it("derives decision from session summary text", () => {
    const derived = deriveIngestEvents([
      baseEvent({
        eventId: "s1",
        summary: "User said we decided to prefer Simplified Chinese for UI copy.",
      }),
    ]);
    expect(derived.some((e) => e.kind === "decision")).toBe(true);
    const d = derived.find((e) => e.kind === "decision")!;
    expect(d.eventId).toContain("s1:decision");
    expect(d.summary.toLowerCase()).toMatch(/chinese|简体/);
  });

  it("derives procedure_draft from numbered steps in skillHint or summary", () => {
    const derived = deriveIngestEvents([
      baseEvent({
        eventId: "s2",
        summary: "Documented how to deploy",
        skillHint: "1. build\n2. push\n3. smoke",
      }),
    ]);
    const p = derived.find((e) => e.kind === "procedure_draft");
    expect(p).toBeTruthy();
    expect(p!.skillHint).toContain("build");
  });
});
