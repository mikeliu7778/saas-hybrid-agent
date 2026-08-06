import { describe, expect, it, afterEach } from "vitest";
import type { MemoryHit } from "../src/memory/memoryPack.js";
import { memorySearch } from "../src/memory/memoryPack.js";
import {
  HashTinyModelBackend,
  createOnDeviceIntelligence,
  createTinyOnDeviceIntelligence,
  getDefaultOnDeviceIntelligence,
  loadWasmTinyModelBackend,
  setDefaultOnDeviceIntelligence,
  createRulesOnDeviceIntelligence,
  type TinyModelBackend,
} from "../src/memory/onDeviceIntelligence.js";
import { hashEmbed, InMemoryMemoryStore } from "../src/memory/InMemoryMemoryStore.js";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

afterEach(() => {
  setDefaultOnDeviceIntelligence(createRulesOnDeviceIntelligence());
});

describe("I5b-D on-device intelligence", () => {
  it("rules mode matches extractive summary helpers", async () => {
    const intel = createOnDeviceIntelligence({ mode: "rules" });
    expect(intel.kind).toBe("rules");
    const summary = await intel.summarizeSession({
      userMessage: "Please fix the auth flake in AuthService",
      assistantText: "I patched the race and prefer JWT.",
    });
    expect(summary).toContain("auth");
    expect(summary.length).toBeLessThanOrEqual(240);
  });

  it("tiny mode uses backend embeddings for rerank", async () => {
    const backend: TinyModelBackend = {
      id: "test-lex",
      async embed(text: string) {
        // One-hot-ish axes: JWT / pnpm
        const t = text.toLowerCase();
        return [t.includes("jwt") || t.includes("auth") ? 1 : 0, t.includes("pnpm") ? 1 : 0];
      },
    };
    const intel = createTinyOnDeviceIntelligence(backend);
    expect(intel.kind).toBe("tiny");
    expect(intel.modelId).toBe("test-lex");

    const hits: MemoryHit[] = [
      { id: "a", kind: "semantic", text: "prefer pnpm over npm", score: 0.5 },
      {
        id: "b",
        kind: "episode",
        text: "JWT auth flake fixed in AuthService last week",
        score: 0.5,
      },
    ];
    const ranked = await intel.rerankHits(hits, "JWT auth AuthService");
    expect(ranked[0]!.id).toBe("b");
  });

  it("tiny summarize picks high-centroid sentences", async () => {
    const intel = createOnDeviceIntelligence({
      mode: "tiny",
      backend: new HashTinyModelBackend(),
    });
    const summary = await intel.summarizeSession({
      userMessage: "We decided to prefer JWT for AuthService. Ignore noise.",
      assistantText:
        "Implemented JWT. Also the weather is nice today for no reason.",
      maxChars: 200,
    });
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.length).toBeLessThanOrEqual(200);
  });

  it("memorySearch respects default on-device reranker", async () => {
    const mem = new InMemoryMemoryStore({ deviceId: "d" });
    mem.upsertSemantic({
      id: "s1",
      text: "prefer JWT auth",
      embedding: hashEmbed("prefer JWT auth"),
      tags: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d",
      version: 1,
    });
    mem.upsertSemantic({
      id: "s2",
      text: "prefer pnpm",
      embedding: hashEmbed("prefer pnpm"),
      tags: [],
      updatedAt: new Date().toISOString(),
      deviceId: "d",
      version: 1,
    });

    setDefaultOnDeviceIntelligence(
      createOnDeviceIntelligence({
        mode: "tiny",
        backend: new HashTinyModelBackend(),
      }),
    );
    expect(getDefaultOnDeviceIntelligence().kind).toBe("tiny");
    const hits = await memorySearch(mem, "JWT auth", 4);
    expect(hits.some((h) => h.id === "s1")).toBe(true);
  });

  it("loadWasmTinyModelBackend imports host-provided factory", async () => {
    const modPath = join(
      process.cwd(),
      "test/fixtures/fake-tiny-model.mjs",
    );
    const backend = await loadWasmTinyModelBackend({
      moduleUrl: pathToFileURL(modPath).href,
    });
    expect(backend.id).toBe("wasm:fake");
    const emb = await backend.embed("hello");
    expect(emb).toHaveLength(8);
  });
});
