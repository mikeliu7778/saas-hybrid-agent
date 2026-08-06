import { describe, expect, it } from "vitest";
import { DevCompanionSession } from "../src/companion/DevCompanionSession.js";
import { InMemoryMemoryStore } from "../src/memory/InMemoryMemoryStore.js";

describe("I5b-C DevCompanionSession", () => {
  it("records terminal turns into ingest events and applyIngest", async () => {
    const session = new DevCompanionSession("cmp-1");
    session.record({
      type: "user",
      text: "fix AuthService.ts flake on staging",
    });
    session.record({ type: "cmd", cmd: "git status", cwd: "/srv/app", exit: 0 });
    session.record({
      type: "stdout",
      text: "clean. secret sk-abcdefghijklmnopqrstuvwxyz012345",
    });
    session.record({ type: "cmd", cmd: "npm test", exit: 0 });
    session.record({ type: "file_touch", path: "src/auth/AuthService.ts" });

    const events = session.toIngestEvents();
    expect(events[0]!.source).toBe("dev_companion");
    expect(events[0]!.kind).toBe("session_summary");
    expect(events[0]!.summary).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(events.some((e) => e.kind === "procedure_draft")).toBe(true);
    expect(events.some((e) => e.paths.includes("src/auth/AuthService.ts"))).toBe(
      true,
    );

    const mem = new InMemoryMemoryStore({ deviceId: "d1" });
    const result = await mem.applyIngest!(events);
    expect(result.accepted + (result.proceduralAccepted ?? 0)).toBeGreaterThan(0);
    const episodes = await mem.listEpisode!();
    expect(episodes.length).toBeGreaterThan(0);
  });

  it("stays optional — empty session still yields a summary event", () => {
    const session = new DevCompanionSession("empty");
    const events = session.toIngestEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("session_summary");
  });
});
