import type { SyncMutation, SyncPullResponse, SyncPushRequest } from "../runtime/types.js";

/** Shared Sync transport for in-memory tests and HTTP (I4b mobile/web). */
export interface SyncBackend {
  push(request: SyncPushRequest): { accepted: number } | Promise<{ accepted: number }>;
  pull(since?: string): SyncPullResponse | Promise<SyncPullResponse>;
}
