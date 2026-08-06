import { describe, expect, it } from "vitest";
import { InMemoryMemoryStore } from "../src/memory/InMemoryMemoryStore.js";
import { InMemorySyncBackend } from "../src/sync/InMemorySyncBackend.js";
import { InMemoryChunkBackend } from "../src/sync/chunkBackend.js";
import { LocalSyncEngine } from "../src/sync/LocalSyncEngine.js";
import { WorkspaceChunkStore } from "../src/workspace/chunks.js";

describe("I5b-A chunk Sync (manifest + on-demand bodies)", () => {
  it("device A publishes manifest; B pulls meta without bodies then hydrates", async () => {
    const syncBackend = new InMemorySyncBackend();
    const chunkBackend = new InMemoryChunkBackend();
    const chunksA = new WorkspaceChunkStore({ maxChars: 12 });
    const chunksB = new WorkspaceChunkStore({ maxChars: 12 });
    const memA = new InMemoryMemoryStore({ deviceId: "A" });
    const memB = new InMemoryMemoryStore({ deviceId: "B" });
    const syncA = new LocalSyncEngine(syncBackend, memA, "A", {
      chunks: chunksA,
      chunkBackend,
    });
    const syncB = new LocalSyncEngine(syncBackend, memB, "B", {
      chunks: chunksB,
      chunkBackend,
    });

    const body = "hello workspace chunk sync path";
    await chunksA.putFile("/notes/big.txt", body);
    await syncA.publishWorkspaceFile("/notes/big.txt");
    await syncA.push();

    // Sync log must not carry chunk bodies
    const pulled = syncBackend.pull("0");
    expect(pulled.mutations).toHaveLength(1);
    expect(pulled.mutations[0]!.entityType).toBe("workspace_file");
    const payload = JSON.stringify(pulled.mutations[0]!.payload);
    expect(payload).not.toContain(body);
    expect(payload).not.toContain("hello workspace");

    await syncB.pull();
    const meta = chunksB.getMeta("/notes/big.txt");
    expect(meta?.chunkCount).toBeGreaterThan(1);
    expect(await chunksB.readFile("/notes/big.txt")).toBeUndefined();
    expect(chunksB.missingHashes("/notes/big.txt").length).toBeGreaterThan(0);

    const ok = await syncB.hydrateWorkspaceFile("/notes/big.txt");
    expect(ok).toBe(true);
    expect(await chunksB.readFile("/notes/big.txt")).toBe(body);
    expect(memB.workspacePaths).toContain("/notes/big.txt");
  });

  it("hydrate fails when chunk backend is missing a hash", async () => {
    const syncBackend = new InMemorySyncBackend();
    const chunkBackend = new InMemoryChunkBackend();
    const chunksA = new WorkspaceChunkStore({ maxChars: 8 });
    const chunksB = new WorkspaceChunkStore({ maxChars: 8 });
    const syncA = new LocalSyncEngine(
      syncBackend,
      new InMemoryMemoryStore({ deviceId: "A" }),
      "A",
      { chunks: chunksA, chunkBackend },
    );
    const syncB = new LocalSyncEngine(
      syncBackend,
      new InMemoryMemoryStore({ deviceId: "B" }),
      "B",
      { chunks: chunksB, chunkBackend },
    );

    await chunksA.putFile("/x.txt", "0123456789abcdef");
    await syncA.publishWorkspaceFile("/x.txt");
    await syncA.push();
    await syncB.pull();

    // Simulate incomplete blob store
    const hashes = chunksB.getMeta("/x.txt")!.chunkHashes;
    chunkBackend.bodies.delete(hashes[0]!);

    expect(await syncB.hydrateWorkspaceFile("/x.txt")).toBe(false);
    expect(await chunksB.readFile("/x.txt")).toBeUndefined();
  });
});
