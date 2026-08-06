import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseTranscriptUpload,
  parseJsonlTranscript,
} from "../src/ingest/parseTranscript.js";
import { DefaultClientAgentRuntime } from "../src/runtime/DefaultClientAgentRuntime.js";
import { InMemoryMemoryStore, hashEmbed } from "../src/memory/InMemoryMemoryStore.js";
import { MockLlmTransport } from "../src/llm/MockLlmTransport.js";
import { ToolHost } from "../src/tools/ToolHost.js";

const fixtures = join(
  process.cwd(),
  "..",
  "python-sidecar",
  "fixtures",
);

describe("parseTranscriptUpload (demo)", () => {
  it("parses Cursor JSONL and scrubs secrets", () => {
    const text = readFileSync(join(fixtures, "cursor_transcript.jsonl"), "utf8");
    const events = parseJsonlTranscript(text, {
      source: "cursor",
      nativeSessionId: "sess",
    });
    expect(events[0]!.kind).toBe("session_summary");
    expect(events[0]!.summary).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(events.some((e) => e.kind === "file_touch")).toBe(true);
  });

  it("auto-detects continue JSON", () => {
    const text = readFileSync(join(fixtures, "continue_session.json"), "utf8");
    const events = parseTranscriptUpload(text, { fileName: "continue_session.json" });
    expect(events[0]!.source).toBe("continue");
  });

  it("auto-detects aider markdown", () => {
    const text = readFileSync(join(fixtures, "aider_chat_history.md"), "utf8");
    const events = parseTranscriptUpload(text, { fileName: "aider.md" });
    expect(events[0]!.source).toBe("aider");
  });
});

describe("runtime searchMemory + pack for demo", () => {
  it("searches and round-trips MemoryPack", async () => {
    const mem = new InMemoryMemoryStore({
      deviceId: "d",
      embed: async (t) => ({ embedding: hashEmbed(t), modelId: "hash" }),
    });
    const runtime = new DefaultClientAgentRuntime({
      llm: new MockLlmTransport([{ type: "text", content: "ok" }]),
      tools: new ToolHost(),
      memory: mem,
    });
    await mem.applyIngest!([
      {
        eventId: "demo-1",
        schemaVersion: "1",
        source: "cursor",
        kind: "session_summary",
        summary: "We decided to prefer JWT for AuthService",
        paths: ["src/auth/AuthService.ts"],
        scrubbed: true,
      },
    ]);
    const hits = await runtime.searchMemory("JWT AuthService");
    expect(hits.length).toBeGreaterThan(0);

    const pack = await runtime.exportMemoryPack();
    const mem2 = new InMemoryMemoryStore({ deviceId: "d2" });
    const runtime2 = new DefaultClientAgentRuntime({
      llm: new MockLlmTransport([{ type: "text", content: "ok" }]),
      tools: new ToolHost(),
      memory: mem2,
    });
    await runtime2.importMemoryPack(pack);
    const again = await runtime2.searchMemory("JWT");
    expect(again.some((h) => h.text.includes("JWT"))).toBe(true);
  });
});
