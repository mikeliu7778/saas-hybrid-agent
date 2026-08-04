/**
 * CA-E7 offline demo — exercises Runtime + Memory + Tools + Sync without a live LLM.
 * Run: npm run build && npm run demo
 */
import {
  DefaultClientAgentRuntime,
  MockLlmTransport,
  ToolHost,
  createFileTools,
  MemoryWorkspace,
  unsupportedTool,
  InMemoryMemoryStore,
  InMemorySyncBackend,
  LocalSyncEngine,
  hashEmbed,
} from "./index.js";

async function main(): Promise<void> {
  const ws = new MemoryWorkspace();
  await ws.write("/notes/hello.md", "phase-a demo");
  const tools = new ToolHost();
  for (const t of createFileTools(ws)) tools.register(t);
  tools.register(unsupportedTool("run_terminal", "Not on Web"));

  const backend = new InMemorySyncBackend();
  const memA = new InMemoryMemoryStore({ deviceId: "demo-A" });
  memA.workspacePaths = ["/notes/hello.md"];
  const syncA = new LocalSyncEngine(backend, memA, "demo-A");

  const llm = new MockLlmTransport([
    {
      type: "tool_calls",
      toolCalls: [
        {
          id: "c1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"/notes/hello.md"}' },
        },
      ],
    },
    { type: "text", content: "I read hello.md: phase-a demo" },
    { type: "text", content: "记住了，你喜欢简体中文。" },
  ]);

  const runtime = new DefaultClientAgentRuntime({
    llm,
    tools,
    memory: memA,
    sync: syncA,
  });

  const sid = await runtime.createSession();
  const turn1 = await runtime.runTurn(sid, "read hello notes", (d) => {
    if (d.type === "text") process.stdout.write(d.text ?? "");
  });
  console.log("\n[turn1]", turn1.status, turn1.iterations);

  const turn2 = await runtime.runTurn(sid, "我喜欢简体中文");
  console.log("[turn2]", turn2.status, turn2.assistantText);

  // enqueue semantic for cross-device sync
  const row = [...memA.semantic.values()][0];
  if (row) {
    syncA.enqueue({
      entityType: "semantic",
      entityId: row.id,
      version: row.version,
      updatedAt: row.updatedAt,
      deviceId: "demo-A",
      payload: { text: row.text, tags: row.tags },
      embedding: row.embedding,
      embeddingModelId: "hash-32",
    });
  } else {
    syncA.enqueue({
      entityType: "semantic",
      entityId: "sem-demo",
      version: 1,
      updatedAt: new Date().toISOString(),
      deviceId: "demo-A",
      payload: { text: "简体中文" },
      embedding: hashEmbed("简体中文"),
      embeddingModelId: "hash-32",
    });
  }
  await syncA.push();

  const memB = new InMemoryMemoryStore({ deviceId: "demo-B" });
  const syncB = new LocalSyncEngine(backend, memB, "demo-B");
  await syncB.pull();
  const recalled = await memB.retrieve("简体 语言");
  console.log("[sync B recall]", recalled.semantic.map((s) => s.text));

  const unsupported = await tools.execute("run_terminal", "{}", {
    sessionId: sid,
    workdir: "/",
  });
  console.log("[unsupported]", unsupported.content);

  console.log("\nPhase A offline demo OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
