// client-agent/test/trust-apply.test.ts
import { describe, it, expect } from "vitest";
import { applyTrustToSemantic } from "../src/trust/applyTrust.js";
import type { SemanticRow } from "../src/memory/InMemoryMemoryStore.js";

function baseRow(over: Partial<SemanticRow> = {}): SemanticRow {
  return {
    id: "sem-1",
    text: "喜欢简体中文",
    embedding: [1, 0],
    tags: [],
    updatedAt: "2026-08-04T00:00:00.000Z",
    deviceId: "d1",
    version: 1,
    trustScore: 0.5,
    confidence: 0.5,
    ...over,
  };
}

describe("applyTrustToSemantic", () => {
  it("raises trustScore on trust", () => {
    const next = applyTrustToSemantic(baseRow(), {
      eventId: "e1",
      kind: "explicit_message_feedback",
      target: "memory_item",
      targetId: "sem-1",
      signal: "trust",
      strength: 0.8,
      ts: "2026-08-04T01:00:00.000Z",
    });
    expect(next.trustScore).toBeGreaterThan(0.5);
    expect(next.lastTrustedAt).toBe("2026-08-04T01:00:00.000Z");
  });

  it("deprecates after strong distrust", () => {
    const next = applyTrustToSemantic(baseRow({ trustScore: 0.2 }), {
      eventId: "e2",
      kind: "explicit_message_feedback",
      target: "memory_item",
      targetId: "sem-1",
      signal: "distrust",
      strength: 0.9,
      ts: "2026-08-04T01:00:00.000Z",
    });
    expect(next.deprecated).toBe(true);
    expect(next.trustScore).toBeLessThan(0.2);
  });
});
