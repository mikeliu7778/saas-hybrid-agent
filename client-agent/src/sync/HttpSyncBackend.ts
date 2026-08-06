import type { SyncPullResponse, SyncPushRequest } from "../runtime/types.js";
import type { SyncBackend } from "./SyncBackend.js";

export interface HttpSyncBackendOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

/**
 * I4b — HTTP Sync client for Web / iOS / Android hosts (same /v1/sync protocol).
 */
export class HttpSyncBackend implements SyncBackend {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HttpSyncBackendOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  async push(request: SyncPushRequest): Promise<{ accepted: number }> {
    const res = await this.fetchImpl(
      `${this.opts.baseUrl.replace(/\/$/, "")}/v1/sync/push`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
    );
    if (!res.ok) throw new Error(`sync push ${res.status}`);
    return (await res.json()) as { accepted: number };
  }

  async pull(since = "0"): Promise<SyncPullResponse> {
    const q = new URLSearchParams({ since });
    const res = await this.fetchImpl(
      `${this.opts.baseUrl.replace(/\/$/, "")}/v1/sync/pull?${q}`,
      {
        headers: { Authorization: `Bearer ${this.opts.token}` },
      },
    );
    if (!res.ok) throw new Error(`sync pull ${res.status}`);
    return (await res.json()) as SyncPullResponse;
  }
}
