import type { SyncEngine, SyncMutation } from "../runtime/types.js";
import type { SyncBackend } from "./SyncBackend.js";
import type { InMemoryMemoryStore } from "../memory/InMemoryMemoryStore.js";
import type { WorkspaceChunkStore, ChunkedFileMeta } from "../workspace/chunks.js";
import type { ChunkBackend } from "./chunkBackend.js";
import { plaintextSyncCrypto, type SyncCrypto } from "./SyncCrypto.js";

export interface LocalSyncState {
  deviceId: string;
  pending: SyncMutation[];
  lastPullCursor: string;
}

export interface LocalSyncEngineOptions {
  /** Local chunk index; required for workspace_file Sync (I5b-A). */
  chunks?: WorkspaceChunkStore;
  /** Shared / remote blob store for chunk bodies (not Sync log). */
  chunkBackend?: ChunkBackend;
  /** I4b optional E2E envelope (default plaintext). */
  crypto?: SyncCrypto;
}

/**
 * CA-E6 — client SyncEngine over SyncBackend (in-memory or HTTP).
 * Conflict: LWW by updatedAt, then higher version.
 * I5b-A: workspace_file manifests sync via mutations; bodies via ChunkBackend.
 * I4b: optional E2E payload crypto; HttpSyncBackend for mobile/web.
 */
export class LocalSyncEngine implements SyncEngine {
  readonly state: LocalSyncState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly chunks?: WorkspaceChunkStore;
  private readonly chunkBackend?: ChunkBackend;
  private readonly crypto: SyncCrypto;

  constructor(
    private readonly backend: SyncBackend,
    private readonly memory: InMemoryMemoryStore,
    deviceId: string,
    opts?: LocalSyncEngineOptions,
  ) {
    this.state = { deviceId, pending: [], lastPullCursor: "0" };
    this.chunks = opts?.chunks;
    this.chunkBackend = opts?.chunkBackend;
    this.crypto = opts?.crypto ?? plaintextSyncCrypto;
  }

  enqueue(mutation: SyncMutation): void {
    this.state.pending.push(mutation);
  }

  async push(): Promise<void> {
    if (this.state.pending.length === 0) return;
    const batch = this.state.pending.splice(0, this.state.pending.length);
    const wrapped: SyncMutation[] = [];
    for (const m of batch) {
      wrapped.push({
        ...m,
        payload: await this.crypto.wrapPayload(m.payload),
      });
    }
    await this.backend.push({ deviceId: this.state.deviceId, mutations: wrapped });
  }

  async pull(): Promise<void> {
    const res = await this.backend.pull(this.state.lastPullCursor);
    for (const m of res.mutations) {
      const payload = await this.crypto.unwrapPayload(m.payload ?? {});
      await this.applyRemote({ ...m, payload });
    }
    this.state.lastPullCursor = res.cursor;
  }

  startBackgroundSync(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.push().then(() => this.pull());
    }, 1000);
  }

  stopBackgroundSync(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Publish a local chunked file: upload bodies to ChunkBackend, enqueue manifest-only mutation.
   */
  async publishWorkspaceFile(path: string, version = 1): Promise<void> {
    if (!this.chunks || !this.chunkBackend) {
      throw new Error("publishWorkspaceFile: chunks + chunkBackend required");
    }
    const meta = this.chunks.getMeta(path);
    if (!meta) throw new Error(`publishWorkspaceFile: unknown path ${path}`);
    for (const hash of meta.chunkHashes) {
      const part = this.chunks.getChunk(hash);
      if (!part) throw new Error(`publishWorkspaceFile: missing local chunk ${hash}`);
      this.chunkBackend.put(hash, part.content);
    }
    this.enqueue({
      entityType: "workspace_file",
      entityId: path,
      version,
      updatedAt: meta.updatedAt,
      deviceId: this.state.deviceId,
      payload: {
        path: meta.path,
        contentHash: meta.contentHash,
        chunkCount: meta.chunkCount,
        chunkHashes: meta.chunkHashes,
        byteLength: meta.byteLength,
        updatedAt: meta.updatedAt,
      },
    });
  }

  /**
   * After manifest pull: fetch missing chunk bodies from ChunkBackend into local store.
   * @returns true if file can be fully reconstructed.
   */
  async hydrateWorkspaceFile(path: string): Promise<boolean> {
    if (!this.chunks || !this.chunkBackend) {
      throw new Error("hydrateWorkspaceFile: chunks + chunkBackend required");
    }
    const meta = this.chunks.getMeta(path);
    if (!meta) return false;
    const missing = this.chunks.missingHashes(path);
    for (let i = 0; i < meta.chunkHashes.length; i++) {
      const hash = meta.chunkHashes[i]!;
      if (!missing.includes(hash) && this.chunks.getChunk(hash)) continue;
      const body = this.chunkBackend.get(hash);
      if (body === undefined) return false;
      this.chunks.putChunkBody(hash, body, i);
    }
    return this.chunks.missingHashes(path).length === 0;
  }

  private async applyRemote(m: SyncMutation): Promise<void> {
    if (m.entityType === "semantic") {
      const existing = this.memory.semantic.get(m.entityId);
      if (existing && !wins(m, existing.version, existing.updatedAt)) return;
      if (m.tombstone) {
        if (existing) existing.tombstone = true;
        return;
      }
      this.memory.upsertSemantic({
        id: m.entityId,
        text: String(m.payload.text ?? ""),
        embedding: m.embedding ?? [],
        tags: (m.payload.tags as string[]) ?? [],
        updatedAt: m.updatedAt,
        deviceId: m.deviceId,
        version: m.version,
      });
    }
    if (m.entityType === "episode") {
      const existing = this.memory.episode.get(m.entityId);
      if (existing && !wins(m, existing.version, existing.updatedAt)) return;
      if (m.tombstone) {
        if (existing) existing.tombstone = true;
        return;
      }
      this.memory.upsertEpisode({
        id: m.entityId,
        summary: String(m.payload.summary ?? ""),
        embedding: m.embedding ?? [],
        timeRangeStart: String(m.payload.timeRangeStart ?? m.updatedAt),
        timeRangeEnd: String(m.payload.timeRangeEnd ?? m.updatedAt),
        messageRefs: (m.payload.messageRefs as string[]) ?? [],
        updatedAt: m.updatedAt,
        deviceId: m.deviceId,
        version: m.version,
      });
    }
    if (m.entityType === "workspace_file") {
      if (!this.chunks) return;
      if (m.tombstone) {
        this.chunks.files.delete(m.entityId);
        return;
      }
      const meta = payloadToMeta(m.payload);
      if (!meta) return;
      this.chunks.applyManifest(meta);
      if (!this.memory.workspacePaths.includes(meta.path)) {
        this.memory.workspacePaths.push(meta.path);
      }
    }
  }
}

function payloadToMeta(payload: Record<string, unknown>): ChunkedFileMeta | null {
  const path = String(payload.path ?? "");
  if (!path) return null;
  const chunkHashes = Array.isArray(payload.chunkHashes)
    ? payload.chunkHashes.map(String)
    : [];
  return {
    path,
    contentHash: String(payload.contentHash ?? ""),
    chunkCount: Number(payload.chunkCount ?? chunkHashes.length),
    chunkHashes,
    updatedAt: String(payload.updatedAt ?? new Date().toISOString()),
    byteLength: Number(payload.byteLength ?? 0),
  };
}

function wins(remote: SyncMutation, localVersion: number, localUpdatedAt: string): boolean {
  if (remote.version !== localVersion) return remote.version > localVersion;
  return Date.parse(remote.updatedAt) >= Date.parse(localUpdatedAt);
}
