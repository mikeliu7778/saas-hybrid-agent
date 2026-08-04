import { describe, it, expect, vi } from "vitest";
import { TrustSignalCollector } from "../src/trust/TrustSignalCollector.js";
import { TrustEventQueue } from "../src/trust/TrustEventQueue.js";
import type { TrustEvent } from "../src/trust/types.js";

describe("TrustSignalCollector", () => {
  it("emits distrust when memory deleted", () => {
    const c = new TrustSignalCollector({ deviceId: "d1" });
    const ev = c.onMemoryDeleted("sem-1");
    expect(ev.signal).toBe("distrust");
    expect(ev.targetId).toBe("sem-1");
    expect(ev.strength).toBeGreaterThanOrEqual(0.8);
    expect(ev.kind).toBe("implicit_memory_deleted");
    expect(ev.target).toBe("memory_item");
    expect(ev.deviceId).toBe("d1");
    expect(ev.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("emits weak trust on memory reuse in follow-up", () => {
    const c = new TrustSignalCollector({ deviceId: "d1" });
    const evs = c.onTurnCompleted({
      sessionId: "s",
      turnId: "t2",
      userMessage: "继续用简体",
      recalledMemoryIds: ["sem-1"],
      assistantText: "好的",
    });
    expect(evs.some((e) => e.signal === "trust" && e.targetId === "sem-1")).toBe(
      true,
    );
    const reuse = evs.find((e) => e.targetId === "sem-1");
    expect(reuse?.strength).toBe(0.35);
    expect(reuse?.kind).toBe("implicit_memory_reuse");
  });

  it("emits explicit feedback with high strength", () => {
    const c = new TrustSignalCollector({ deviceId: "d1" });
    const ev = c.onExplicitFeedback({
      sessionId: "s",
      turnId: "t1",
      target: "assistant_message",
      targetId: "m1",
      signal: "trust",
    });
    expect(ev.strength).toBe(0.85);
    expect(ev.kind).toBe("explicit_message_feedback");
    expect(ev.signal).toBe("trust");
  });
});

describe("TrustEventQueue", () => {
  const sampleEvent = (): TrustEvent => ({
    eventId: "e1",
    kind: "explicit_message_feedback",
    target: "assistant_message",
    targetId: "m1",
    signal: "trust",
    strength: 1,
    ts: new Date().toISOString(),
  });

  it("keeps events when reporting disabled but still drains locally", async () => {
    const q = new TrustEventQueue();
    q.setReportingEnabled(false);
    q.enqueue(sampleEvent());
    const sent: unknown[] = [];
    await q.flush({
      append: async (events) => {
        sent.push(...events);
      },
    });
    expect(sent).toHaveLength(0);
    expect(q.pendingCount()).toBe(1);
  });

  it("drain removes pending events from the buffer", () => {
    const q = new TrustEventQueue();
    q.enqueue(sampleEvent());
    const drained = q.drain();
    expect(drained).toHaveLength(1);
    expect(q.pendingCount()).toBe(0);
  });

  it("flush clears queue on successful append", async () => {
    const q = new TrustEventQueue();
    q.enqueue(sampleEvent());
    await q.flush({
      append: async () => {},
    });
    expect(q.pendingCount()).toBe(0);
  });

  it("flush keeps queue on append failure and does not throw", async () => {
    const q = new TrustEventQueue();
    q.enqueue(sampleEvent());
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      q.flush({
        append: async () => {
          throw new Error("network down");
        },
      }),
    ).resolves.toBeUndefined();

    expect(q.pendingCount()).toBe(1);
    errSpy.mockRestore();
  });
});
