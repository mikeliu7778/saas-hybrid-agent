import type { TrustEvent } from "./types.js";

export interface TrustEventClient {
  append(events: TrustEvent[]): Promise<void>;
}

export class TrustEventQueue {
  private readonly buffer: TrustEvent[] = [];
  private reportingEnabled = true;

  enqueue(event: TrustEvent): void {
    this.buffer.push(event);
  }

  setReportingEnabled(enabled: boolean): void {
    this.reportingEnabled = enabled;
  }

  drain(): TrustEvent[] {
    return this.buffer.splice(0, this.buffer.length);
  }

  pendingCount(): number {
    return this.buffer.length;
  }

  async flush(client: TrustEventClient): Promise<void> {
    if (!this.reportingEnabled || this.buffer.length === 0) {
      return;
    }

    const batch = [...this.buffer];
    try {
      await client.append(batch);
      this.buffer.splice(0, batch.length);
    } catch (err) {
      console.error("[TrustEventQueue] flush failed", err);
    }
  }
}
