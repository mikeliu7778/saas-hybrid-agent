/**
 * Factory helpers for wiring real LLM gateway + OPFS persistence in the browser.
 */
import { HttpLlmTransport } from "../llm/HttpLlmTransport.js";
import { HttpEmbeddingClient } from "../llm/HttpEmbeddingClient.js";
import { DefaultClientAgentRuntime } from "../runtime/DefaultClientAgentRuntime.js";
import { ToolHost, unsupportedTool } from "../tools/ToolHost.js";
import { createFileTools, createHttpTool } from "../tools/fileAndHttpTools.js";
import { OpfsWorkspace } from "../tools/workspace.js";
import { OpfsKvStore } from "../storage/OpfsKvStore.js";
import { PersistedSessionStore } from "../storage/PersistedSessionStore.js";
import { PersistedMemoryStore } from "../storage/PersistedMemoryStore.js";
import { getBrowserOpfsRoot, type OpfsDirectoryHandle } from "../storage/memoryOpfsRoot.js";
import { HttpTrustEventClient } from "../trust/HttpTrustEventClient.js";
import { TrustEventQueue } from "../trust/TrustEventQueue.js";
import { TrustSignalCollector } from "../trust/TrustSignalCollector.js";

export interface CreateBrowserRuntimeOptions {
  baseUrl: string;
  token: string;
  model?: string;
  embeddingModel?: string;
  httpAllowlist?: string[];
  /** Inject for tests; defaults to navigator.storage.getDirectory() */
  opfsRoot?: OpfsDirectoryHandle;
  deviceId?: string;
}

export async function createBrowserRuntime(opts: CreateBrowserRuntimeOptions) {
  const root = opts.opfsRoot ?? (await getBrowserOpfsRoot());
  const kv = new OpfsKvStore(root);
  const workspace = new OpfsWorkspace(root);
  const tools = new ToolHost();
  for (const t of createFileTools(workspace)) tools.register(t);
  tools.register(createHttpTool(opts.httpAllowlist ?? ["example.com"]));
  tools.register(unsupportedTool("run_terminal", "Shell is not available on Web"));

  const embedClient = new HttpEmbeddingClient({
    baseUrl: opts.baseUrl,
    token: opts.token,
    model: opts.embeddingModel,
  });
  const memory = new PersistedMemoryStore(kv, {
    deviceId: opts.deviceId ?? "web",
    embed: (text) => embedClient.embed(text),
  });
  await memory.hydrate();

  // Refresh workspace hints from OPFS listing
  try {
    memory.workspacePaths = (await workspace.list("/")).map((n) => `/${n}`);
    await memory.flush();
  } catch {
    /* empty workspace */
  }

  const llm = new HttpLlmTransport({
    baseUrl: opts.baseUrl,
    token: opts.token,
    model: opts.model,
  });
  const sessionStore = new PersistedSessionStore(kv);
  const deviceId = opts.deviceId ?? "web";
  const trustCollector = new TrustSignalCollector({ deviceId });
  const trustQueue = new TrustEventQueue();
  const trustClient = new HttpTrustEventClient({
    baseUrl: opts.baseUrl,
    token: opts.token,
  });
  const runtime = new DefaultClientAgentRuntime({
    llm,
    tools,
    memory,
    sessionStore,
    deviceId,
    trustCollector,
    trustQueue,
    trustClient,
  });
  await runtime.hydrateSessions();
  return { runtime, memory, workspace, kv };
}
