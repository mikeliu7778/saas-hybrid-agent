import { describe, it, expect } from "vitest";
import {
  formatMemoryBundle,
  recalledIdsFromBundle,
} from "../src/memory/formatMemoryBundle.js";
import {
  engineAllowsClientTools,
  isSidecarEngine,
} from "../src/llm/enginePolicy.js";

describe("formatMemoryBundle", () => {
  it("includes procedural skills", () => {
    const lines = formatMemoryBundle({
      semantic: [{ id: "s1", text: "prefer pnpm", score: 1 }],
      episode: [{ id: "e1", summary: "fixed auth", score: 0.9 }],
      procedural: [{ id: "p1", text: "1. test\n2. ship", score: 0.8 }],
      workspaceHints: ["src/a.ts"],
    });
    expect(lines.some((l) => l.includes("skill:"))).toBe(true);
    expect(lines.some((l) => l.includes("fact:"))).toBe(true);
    expect(lines.some((l) => l.includes("past:"))).toBe(true);
    expect(lines.some((l) => l.includes("workspace:"))).toBe(true);
  });

  it("collects recalled ids", () => {
    const ids = recalledIdsFromBundle({
      semantic: [{ id: "s1", text: "a", score: 1 }],
      episode: [{ id: "e1", summary: "b", score: 1 }],
      procedural: [{ id: "p1", text: "c", score: 1 }],
      workspaceHints: [],
    });
    expect(ids).toEqual(["s1", "e1", "p1"]);
  });
});

describe("enginePolicy", () => {
  it("marks cursor/claude_code/codex as sidecar", () => {
    expect(isSidecarEngine("cursor")).toBe(true);
    expect(isSidecarEngine("claude_code")).toBe(true);
    expect(isSidecarEngine("codex")).toBe(true);
    expect(isSidecarEngine("openai")).toBe(false);
    expect(engineAllowsClientTools("openai")).toBe(true);
    expect(engineAllowsClientTools("cursor")).toBe(false);
  });
});
