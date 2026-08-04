import { describe, it, expect } from "vitest";
import { hashEmbed, InMemoryMemoryStore } from "../src/memory/InMemoryMemoryStore.js";

describe("Memory applyTrust retrieve", () => {
  it("excludes deprecated semantic from retrieve", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "t" });
    mem.upsertSemantic({
      id: "sem-bad",
      text: "喜欢繁体",
      embedding: [1, 0, 0, 0],
      tags: [],
      updatedAt: "2026-08-04T00:00:00.000Z",
      deviceId: "t",
      version: 1,
      trustScore: 0.5,
    });
    await mem.applyTrust({
      eventId: "e1",
      kind: "explicit_memory_feedback",
      target: "memory_item",
      targetId: "sem-bad",
      signal: "distrust",
      strength: 0.95,
      ts: "2026-08-04T01:00:00.000Z",
    });
    const bundle = await mem.retrieve("喜欢");
    expect(bundle.semantic.find((s) => s.id === "sem-bad")).toBeUndefined();
  });

  it("boosts high trustScore in ranking", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "t" });
    // Same embedding so cosine ties; trustScore tips order
    const emb = hashEmbed("语言偏好");
    mem.upsertSemantic({
      id: "low",
      text: "语言偏好 A",
      embedding: emb,
      tags: [],
      updatedAt: "2026-08-04T00:00:00.000Z",
      deviceId: "t",
      version: 1,
      trustScore: 0.1,
    });
    mem.upsertSemantic({
      id: "high",
      text: "语言偏好 B",
      embedding: emb,
      tags: [],
      updatedAt: "2026-08-04T00:00:00.000Z",
      deviceId: "t",
      version: 1,
      trustScore: 0.95,
    });
    await mem.applyTrust({
      eventId: "e2",
      kind: "implicit_memory_reuse",
      target: "memory_item",
      targetId: "high",
      signal: "trust",
      strength: 0.5,
      ts: "2026-08-04T02:00:00.000Z",
    });
    const bundle = await mem.retrieve("语言偏好");
    expect(bundle.semantic[0]?.id).toBe("high");
  });
});
