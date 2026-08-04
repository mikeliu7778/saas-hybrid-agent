import { describe, expect, it } from "vitest";
import { StubClientAgentRuntime } from "../src/index.js";
import type { ClientAgentRuntime } from "../src/runtime/types.js";

describe("CA-1.1 package scaffold", () => {
  it("exports a constructible ClientAgentRuntime stub", () => {
    const runtime: ClientAgentRuntime = new StubClientAgentRuntime();
    expect(runtime).toBeDefined();
    expect(typeof runtime.createSession).toBe("function");
    expect(typeof runtime.runTurn).toBe("function");
    expect(typeof runtime.interrupt).toBe("function");
    expect(typeof runtime.pushSync).toBe("function");
    expect(typeof runtime.pullSync).toBe("function");
    expect(typeof runtime.startBackgroundSync).toBe("function");
  });
});

describe("CA-1.2 ClientAgentRuntime public API", () => {
  it("createSession returns a session id", async () => {
    const runtime = new StubClientAgentRuntime();
    const id = await runtime.createSession({ maxIterations: 10 });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("runTurn returns a TurnResult shape (stub fails intentionally)", async () => {
    const runtime = new StubClientAgentRuntime();
    const sessionId = await runtime.createSession();
    const result = await runtime.runTurn(sessionId, "hello");
    expect(result.sessionId).toBe(sessionId);
    expect(result.turnId).toBeTruthy();
    expect(result.status).toBe("failed");
    expect(result).toHaveProperty("assistantText");
    expect(result).toHaveProperty("iterations");
  });

  it("interrupt resolves without throwing", async () => {
    const runtime = new StubClientAgentRuntime();
    const sessionId = await runtime.createSession();
    await expect(runtime.interrupt(sessionId)).resolves.toBeUndefined();
  });
});
