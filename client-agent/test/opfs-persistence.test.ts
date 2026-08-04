import { describe, expect, it } from "vitest";
import { MemoryKvStore } from "../src/storage/MemoryKvStore.js";
import { OpfsKvStore } from "../src/storage/OpfsKvStore.js";
import { createMemoryOpfsRoot } from "../src/storage/memoryOpfsRoot.js";
import { MemoryWorkspace, OpfsWorkspace, normalizeWorkspacePath } from "../src/tools/workspace.js";
import { createFileTools } from "../src/tools/fileAndHttpTools.js";
import { ToolHost } from "../src/tools/ToolHost.js";
import { PersistedSessionStore } from "../src/storage/PersistedSessionStore.js";
import { PersistedMemoryStore } from "../src/storage/PersistedMemoryStore.js";

describe("OPFS / KvStore persistence", () => {
  it("MemoryKvStore roundtrips JSON", async () => {
    const kv = new MemoryKvStore();
    await kv.setJson("sess/1", { id: "1", title: "t" });
    expect(await kv.getJson<{ id: string }>("sess/1")).toEqual({ id: "1", title: "t" });
    await kv.delete("sess/1");
    expect(await kv.getJson("sess/1")).toBeUndefined();
  });

  it("OpfsKvStore works over memory OPFS shim", async () => {
    const root = createMemoryOpfsRoot();
    const kv = new OpfsKvStore(root);
    await kv.setText("notes/a.txt", "hello");
    expect(await kv.getText("notes/a.txt")).toBe("hello");
    expect(await kv.list("notes")).toContain("notes/a.txt");
  });

  it("OpfsWorkspace persists files via OPFS shim", async () => {
    const root = createMemoryOpfsRoot();
    const ws = new OpfsWorkspace(root);
    await ws.write("/docs/readme.md", "phase-a");
    expect(await ws.read("/docs/readme.md")).toBe("phase-a");
    expect(await ws.list("/docs")).toContain("readme.md");
    await expect(ws.read("/../../etc/passwd")).rejects.toThrow(/escapes/);
  });

  it("file tools work with async WorkspaceFs (OPFS)", async () => {
    const root = createMemoryOpfsRoot();
    const ws = new OpfsWorkspace(root);
    const host = new ToolHost();
    for (const t of createFileTools(ws)) host.register(t);
    const ctx = { sessionId: "s", workdir: "/" };
    expect(
      (await host.execute("write_file", '{"path":"/x.txt","content":"z"}', ctx)).ok,
    ).toBe(true);
    expect((await host.execute("read_file", '{"path":"/x.txt"}', ctx)).content).toBe("z");
  });

  it("PersistedSessionStore survives reload", async () => {
    const kv = new MemoryKvStore();
    const store = new PersistedSessionStore(kv);
    await store.save({
      id: "s1",
      maxIterations: 10,
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      workdir: "/",
      busy: false,
    });
    const loaded = await store.load("s1");
    expect(loaded?.messages[0].content).toBe("hi");
    expect(await store.listIds()).toContain("s1");
  });

  it("PersistedMemoryStore reloads semantic rows", async () => {
    const kv = new MemoryKvStore();
    const mem = new PersistedMemoryStore(kv, { deviceId: "d1" });
    await mem.commitTurn({
      sessionId: "s",
      turnId: "t1",
      userMessage: "我喜欢暗色模式",
      assistantText: "ok",
    });
    const mem2 = new PersistedMemoryStore(kv, { deviceId: "d1" });
    await mem2.hydrate();
    expect(mem2.semantic.size).toBe(1);
    const bundle = await mem2.retrieve("暗色");
    expect(bundle.semantic[0].text).toContain("暗色模式");
  });

  it("normalizeWorkspacePath rejects escape", () => {
    expect(() => normalizeWorkspacePath("../x")).toThrow(/escapes/);
    expect(normalizeWorkspacePath("a/b")).toBe("/a/b");
  });

  it("MemoryWorkspace remains usable for unit tests", async () => {
    const ws = new MemoryWorkspace();
    await ws.write("/a", "1");
    expect(await ws.read("/a")).toBe("1");
  });
});
