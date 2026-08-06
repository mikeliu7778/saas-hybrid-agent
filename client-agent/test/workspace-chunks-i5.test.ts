import { describe, it, expect } from "vitest";
import {
  chunkText,
  contentHash,
  WorkspaceChunkStore,
} from "../src/workspace/chunks.js";
import {
  localSessionSummary,
  rerankMemoryHits,
} from "../src/memory/localSummarizer.js";
import type { MemoryHit } from "../src/memory/memoryPack.js";

describe("workspace chunks (I5a)", () => {
  it("splits large text into sized chunks with stable hashes", async () => {
    const text = "abcdefghij".repeat(50); // 500 chars
    const chunks = await chunkText(text, { maxChars: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 100)).toBe(true);
    expect(chunks.map((c) => c.index)).toEqual(
      chunks.map((_, i) => i),
    );
    const again = await chunkText(text, { maxChars: 100 });
    expect(again.map((c) => c.hash)).toEqual(chunks.map((c) => c.hash));
  });

  it("contentHash is deterministic", async () => {
    const a = await contentHash("hello");
    const b = await contentHash("hello");
    const c = await contentHash("world");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("WorkspaceChunkStore put/get reconstructs file and supports by-hash pull", async () => {
    const store = new WorkspaceChunkStore({ maxChars: 20 });
    const body = "line1\nline2\nline3\nline4\nline5\n";
    const meta = await store.putFile("/notes/big.txt", body);
    expect(meta.path).toBe("/notes/big.txt");
    expect(meta.chunkCount).toBeGreaterThan(1);
    expect(await store.readFile("/notes/big.txt")).toBe(body);

    const first = store.getChunk(meta.chunkHashes[0]!);
    expect(first?.content.length).toBeGreaterThan(0);

    const missing = store.getChunk("nope");
    expect(missing).toBeUndefined();
  });

  it("gcUnreferenced drops orphan chunk bodies", async () => {
    const store = new WorkspaceChunkStore({ maxChars: 10 });
    await store.putFile("/a.txt", "0123456789ABCDEF");
    const orphanHash = await contentHash("orphan-body");
    store.chunks.set(orphanHash, {
      index: 99,
      hash: orphanHash,
      content: "orphan-body",
    });
    expect(store.gcUnreferenced()).toBe(1);
    expect(store.getChunk(orphanHash)).toBeUndefined();
  });
});

describe("localSummarizer (I5a)", () => {
  it("builds a short local session summary without cloud LLM", () => {
    const summary = localSessionSummary({
      userMessage: "Please fix the auth flake in AuthService",
      assistantText:
        "I patched the race and added a regression test. We decided to prefer JWT.",
    });
    expect(summary.length).toBeLessThanOrEqual(240);
    expect(summary).toContain("auth");
  });

  it("reranks hits by query token overlap on top of base score", () => {
    const hits: MemoryHit[] = [
      { id: "a", kind: "semantic", text: "prefer pnpm", score: 0.9 },
      { id: "b", kind: "episode", text: "JWT auth flake fixed last week", score: 0.5 },
    ];
    const ranked = rerankMemoryHits(hits, "JWT auth");
    expect(ranked[0]!.id).toBe("b");
  });
});
