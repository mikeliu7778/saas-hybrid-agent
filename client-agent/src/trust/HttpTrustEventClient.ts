import type { TrustEvent } from "./types.js";

export interface HttpTrustEventClientOptions {
  baseUrl: string;
  token: string;
}

export class HttpTrustEventClient {
  constructor(private opts: HttpTrustEventClientOptions) {}

  async append(events: TrustEvent[]): Promise<void> {
    const res = await fetch(
      `${this.opts.baseUrl.replace(/\/$/, "")}/v1/trust/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          events: events.map((e) => ({
            eventId: e.eventId,
            kind: e.kind,
            target: e.target,
            targetId: e.targetId,
            signal: e.signal,
            strength: e.strength,
            ts: e.ts,
            sessionId: e.sessionId,
            turnId: e.turnId,
            payload: e.payload,
          })),
        }),
      },
    );
    if (!res.ok) throw new Error(`trust append ${res.status}`);
  }
}
