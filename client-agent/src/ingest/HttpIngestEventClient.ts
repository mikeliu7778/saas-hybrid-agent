import type { IngestEvent } from "../ingest/types.js";

/** Analytics-only payload — never includes summary/body text. */
export interface IngestAnalyticsEvent {
  eventId: string;
  source: string;
  kind: string;
  ts: string;
  deviceId?: string;
  nativeSessionId?: string;
  pathCount?: number;
}

export interface HttpIngestEventClientOptions {
  baseUrl: string;
  token: string;
}

export class HttpIngestEventClient {
  constructor(private opts: HttpIngestEventClientOptions) {}

  async append(events: IngestAnalyticsEvent[]): Promise<{ accepted: number; duplicates: number }> {
    const res = await fetch(
      `${this.opts.baseUrl.replace(/\/$/, "")}/v1/ingest/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          events: events.map((e) => ({
            eventId: e.eventId,
            source: e.source,
            kind: e.kind,
            ts: e.ts,
            deviceId: e.deviceId,
            nativeSessionId: e.nativeSessionId,
            pathCount: e.pathCount,
          })),
        }),
      },
    );
    if (!res.ok) throw new Error(`ingest analytics append ${res.status}`);
    return (await res.json()) as { accepted: number; duplicates: number };
  }
}

/** Strip Memory body fields before optional control-plane upload (I3b). */
export function toIngestAnalyticsEvents(
  events: IngestEvent[],
  opts?: { deviceId?: string; ts?: string },
): IngestAnalyticsEvent[] {
  const ts = opts?.ts ?? new Date().toISOString();
  return events.map((e) => ({
    eventId: e.eventId,
    source: e.source,
    kind: e.kind,
    ts: e.tsEnd ?? e.tsStart ?? ts,
    deviceId: e.deviceId ?? opts?.deviceId,
    nativeSessionId: e.nativeSessionId,
    pathCount: e.paths?.length ?? 0,
  }));
}
