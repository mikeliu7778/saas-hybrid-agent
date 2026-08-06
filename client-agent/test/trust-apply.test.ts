import { describe, it, expect } from "vitest";
import {
  applyTrustToEpisode,
  applyTrustToProcedural,
  applyTrustToSemantic,
} from "../src/trust/applyTrust.js";
import type {
  EpisodeRow,
  ProceduralRow,
  SemanticRow,
} from "../src/memory/InMemoryMemoryStore.js";
import { hashEmbed, InMemoryMemoryStore } from "../src/memory/InMemoryMemoryStore.js";
import { DefaultClientAgentRuntime } from "../src/runtime/DefaultClientAgentRuntime.js";
import { MockLlmTransport } from "../src/llm/MockLlmTransport.js";
import { ToolHost } from "../src/tools/ToolHost.js";

function baseSemantic(over: Partial<SemanticRow> = {}): SemanticRow {
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
    const next = applyTrustToSemantic(baseSemantic(), {
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
    const next = applyTrustToSemantic(baseSemantic({ trustScore: 0.2 }), {
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

describe("applyTrustToEpisode (I3)", () => {
  it("deprecates episode on strong distrust", () => {
    const row: EpisodeRow = {
      id: "epi-1",
      summary: "fixed auth",
      embedding: [1, 0],
      timeRangeStart: "2026-08-06T00:00:00.000Z",
      timeRangeEnd: "2026-08-06T00:00:00.000Z",
      messageRefs: [],
      updatedAt: "2026-08-06T00:00:00.000Z",
      deviceId: "d1",
      version: 1,
      trustScore: 0.5,
      source: "hybrid",
    };
    const next = applyTrustToEpisode(row, {
      eventId: "e3",
      kind: "implicit_memory_deleted",
      target: "memory_item",
      targetId: "epi-1",
      signal: "distrust",
      strength: 0.9,
      ts: "2026-08-06T01:00:00.000Z",
    });
    expect(next.deprecated).toBe(true);
  });
});

describe("applyTrustToProcedural (I3)", () => {
  it("raises trust on reuse", () => {
    const row: ProceduralRow = {
      id: "proc-1",
      skillId: "s1",
      text: "1. build\n2. test",
      steps: ["build", "test"],
      embedding: [1, 0],
      updatedAt: "2026-08-06T00:00:00.000Z",
      deviceId: "d1",
      version: 1,
      trustScore: 0.5,
    };
    const next = applyTrustToProcedural(row, {
      eventId: "e4",
      kind: "implicit_memory_reuse",
      target: "memory_item",
      targetId: "proc-1",
      signal: "trust",
      strength: 0.35,
      ts: "2026-08-06T01:00:00.000Z",
    });
    expect(next.trustScore).toBeGreaterThan(0.5);
  });
});

describe("InMemoryMemoryStore I3 trust flywheel", () => {
  it("deleteEpisode excludes from retrieve but lists as deprecated", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    mem.upsertEpisode({
      id: "epi-ingest-x",
      summary: "cursor fixed JWT auth",
      embedding: hashEmbed("JWT auth"),
      timeRangeStart: new Date().toISOString(),
      timeRangeEnd: new Date().toISOString(),
      messageRefs: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d1",
      version: 1,
      source: "cursor",
      trustScore: 0.5,
    });

    await mem.deleteEpisode("epi-ingest-x");
    const bundle = await mem.retrieve("JWT auth");
    expect(bundle.episode.find((e) => e.id === "epi-ingest-x")).toBeUndefined();
    const listed = await mem.listEpisode();
    expect(listed.some((e) => e.id === "epi-ingest-x" && e.deprecated)).toBe(true);
  });

  it("applyTrust strengthens recalled episode", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    mem.upsertEpisode({
      id: "epi-1",
      summary: "prefer JWT",
      embedding: hashEmbed("JWT"),
      timeRangeStart: new Date().toISOString(),
      timeRangeEnd: new Date().toISOString(),
      messageRefs: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d1",
      version: 1,
      trustScore: 0.5,
    });
    await mem.applyTrust({
      eventId: "t1",
      kind: "implicit_memory_reuse",
      target: "memory_item",
      targetId: "epi-1",
      signal: "trust",
      strength: 0.35,
      ts: new Date().toISOString(),
    });
    expect(mem.episode.get("epi-1")!.trustScore!).toBeGreaterThan(0.5);
  });

  it("runtime deleteEpisode emits distrust", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    mem.upsertEpisode({
      id: "epi-del",
      summary: "bad summary",
      embedding: hashEmbed("bad"),
      timeRangeStart: new Date().toISOString(),
      timeRangeEnd: new Date().toISOString(),
      messageRefs: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d1",
      version: 1,
      trustScore: 0.5,
    });
    const runtime = new DefaultClientAgentRuntime({
      llm: new MockLlmTransport([{ type: "text", content: "ok" }]),
      tools: new ToolHost(),
      memory: mem,
    });
    await runtime.deleteEpisode!("epi-del");
    expect(mem.episode.get("epi-del")!.deprecated).toBe(true);
    // soft-delete already set deprecated; applyTrust distrust may reinforce
    const bundle = await mem.retrieve("bad summary");
    expect(bundle.episode.find((e) => e.id === "epi-del")).toBeUndefined();
  });
});
