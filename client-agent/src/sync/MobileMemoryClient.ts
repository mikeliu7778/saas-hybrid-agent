import type { InMemoryMemoryStore } from "../memory/InMemoryMemoryStore.js";
import { memorySearch, type MemoryHit } from "../memory/memoryPack.js";
import type { OnDeviceIntelligence } from "../memory/onDeviceIntelligence.js";
import type { LocalSyncEngine } from "./LocalSyncEngine.js";

export interface MobileMemoryClientOptions {
  memory: InMemoryMemoryStore;
  sync: LocalSyncEngine;
  onDevice?: OnDeviceIntelligence;
  /** Optional push after local writes (hosts may call explicitly). */
  autoPush?: boolean;
}

/**
 * I4b — thin facade for iOS/Android/Web hosts: Sync pull then same-protocol Memory recall.
 * Does not ship native UI; RN / Kotlin / Swift hosts wrap this TS (or call HTTP Sync + MemoryPack).
 */
export class MobileMemoryClient {
  constructor(private readonly opts: MobileMemoryClientOptions) {}

  /** Pull remote mutations into local Memory (multi-device continuity). */
  async refresh(): Promise<void> {
    await this.opts.sync.pull();
  }

  async push(): Promise<void> {
    await this.opts.sync.push();
  }

  /** Same recall path as Web / MCP (`memorySearch`). */
  async recall(query: string, limit = 8): Promise<MemoryHit[]> {
    return memorySearch(this.opts.memory, query, limit, {
      onDevice: this.opts.onDevice,
    });
  }

  get memory(): InMemoryMemoryStore {
    return this.opts.memory;
  }
}
