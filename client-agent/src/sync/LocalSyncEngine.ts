import type { SyncEngine, SyncMutation } from "../runtime/types.js";
import type { InMemorySyncBackend } from "./InMemorySyncBackend.js";
import type { InMemoryMemoryStore } from "../memory/InMemoryMemoryStore.js";

export interface LocalSyncState {
  deviceId: string;
  pending: SyncMutation[];
  lastPullCursor: string;
}

/**
 * CA-E6 — client SyncEngine over InMemorySyncBackend (or HTTP later).
 * Conflict: LWW by updatedAt, then higher version.
 */
export class LocalSyncEngine implements SyncEngine {
  readonly state: LocalSyncState;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly backend: InMemorySyncBackend,
    private readonly memory: InMemoryMemoryStore,
    deviceId: string,
  ) {
    this.state = { deviceId, pending: [], lastPullCursor: "0" };
  }

  enqueue(mutation: SyncMutation): void {
    this.state.pending.push(mutation);
  }

  async push(): Promise<void> {
    if (this.state.pending.length === 0) return;
    const batch = this.state.pending.splice(0, this.state.pending.length);
    this.backend.push({ deviceId: this.state.deviceId, mutations: batch });
  }

  async pull(): Promise<void> {
    const res = this.backend.pull(this.state.lastPullCursor);
    for (const m of res.mutations) {
      this.applyRemote(m);
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

  private applyRemote(m: SyncMutation): void {
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
  }
}

function wins(remote: SyncMutation, localVersion: number, localUpdatedAt: string): boolean {
  if (remote.version !== localVersion) return remote.version > localVersion;
  return Date.parse(remote.updatedAt) >= Date.parse(localUpdatedAt);
}
