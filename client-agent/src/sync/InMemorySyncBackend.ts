import type { SyncMutation, SyncPullResponse, SyncPushRequest } from "../runtime/types.js";
import type { SyncBackend } from "./SyncBackend.js";

/**
 * CA-3.2 — in-memory sync backend for unit tests (server stand-in).
 */
export class InMemorySyncBackend implements SyncBackend {
  private seq = 0;
  private readonly log: Array<SyncMutation & { cursor: string }> = [];

  push(request: SyncPushRequest): { accepted: number } {
    for (const m of request.mutations) {
      this.seq += 1;
      this.log.push({ ...structuredClone(m), cursor: String(this.seq) });
    }
    return { accepted: request.mutations.length };
  }

  pull(since = "0"): SyncPullResponse {
    const sinceNum = Number(since) || 0;
    const mutations = this.log
      .filter((m) => Number(m.cursor) > sinceNum)
      .map(({ cursor: _c, ...rest }) => rest);
    const cursor = this.log.length === 0 ? since : this.log[this.log.length - 1].cursor;
    return { cursor, mutations };
  }

  clear(): void {
    this.seq = 0;
    this.log.length = 0;
  }
}
