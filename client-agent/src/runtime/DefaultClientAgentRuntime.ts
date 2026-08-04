import type {
  ClientAgentRuntime,
  MemoryOrchestrator,
  SessionConfig,
  StreamHandler,
  SyncEngine,
  TurnResult,
} from "./types.js";
import { ConversationLoop, type SessionState } from "./ConversationLoop.js";
import type { LlmTransport } from "./types.js";
import type { ToolHost } from "../tools/ToolHost.js";
import type { PersistedSessionStore } from "../storage/PersistedSessionStore.js";

export interface DefaultRuntimeOptions {
  llm: LlmTransport;
  tools: ToolHost;
  memory?: MemoryOrchestrator;
  sync?: SyncEngine;
  sessionStore?: PersistedSessionStore;
  defaultMaxIterations?: number;
  defaultSystemPrompt?: string;
}

export class DefaultClientAgentRuntime implements ClientAgentRuntime {
  private readonly sessions = new Map<string, SessionState>();
  private readonly loop: ConversationLoop;
  private readonly opts: DefaultRuntimeOptions;

  constructor(opts: DefaultRuntimeOptions) {
    this.opts = opts;
    this.loop = new ConversationLoop({ llm: opts.llm, tools: opts.tools });
  }

  async createSession(config?: SessionConfig): Promise<string> {
    const id = crypto.randomUUID();
    const session: SessionState = {
      id,
      maxIterations: config?.maxIterations ?? this.opts.defaultMaxIterations ?? 90,
      systemPrompt:
        config?.systemPrompt ??
        this.opts.defaultSystemPrompt ??
        "You are a helpful personal agent. Use tools when needed.",
      messages: [],
      workdir: "/",
      toolNames: config?.toolNames,
      interrupt: new AbortController(),
      busy: false,
    };
    this.sessions.set(id, session);
    await this.persist(session);
    return id;
  }

  /** Reload sessions previously saved to KvStore/OPFS. */
  async hydrateSessions(): Promise<string[]> {
    if (!this.opts.sessionStore) return [];
    const ids = await this.opts.sessionStore.listIds();
    for (const id of ids) {
      const rec = await this.opts.sessionStore.load(id);
      if (!rec) continue;
      this.sessions.set(id, {
        ...rec,
        interrupt: new AbortController(),
        busy: false,
      });
    }
    return ids;
  }

  async runTurn(
    sessionId: string,
    userMessage: string,
    stream?: StreamHandler,
  ): Promise<TurnResult> {
    const session = this.requireSession(sessionId);

    // Keep base system prompt separate from memory injection for persistence.
    const baseSystem = session.systemPrompt.split("\n\nRelevant memory:\n")[0];
    session.systemPrompt = baseSystem;

    if (this.opts.memory) {
      const bundle = await this.opts.memory.retrieve(userMessage);
      const memBits = [
        ...bundle.semantic.map((s) => `- fact: ${s.text}`),
        ...bundle.episode.map((e) => `- past: ${e.summary}`),
        ...bundle.workspaceHints.map((h) => `- workspace: ${h}`),
      ];
      if (memBits.length > 0) {
        session.systemPrompt = `${baseSystem}\n\nRelevant memory:\n${memBits.join("\n")}`;
      }
    }

    const result = await this.loop.runTurn(session, userMessage, stream);
    session.systemPrompt = baseSystem;
    await this.persist(session);

    if (this.opts.memory && result.status === "completed") {
      void this.opts.memory.commitTurn({
        sessionId,
        turnId: result.turnId,
        userMessage,
        assistantText: result.assistantText,
      });
    }

    return result;
  }
  async interrupt(sessionId: string): Promise<void> {
    this.requireSession(sessionId).interrupt.abort();
  }

  async importMemoryPack(_data: Uint8Array): Promise<void> {
    throw new Error("importMemoryPack: Phase B");
  }

  async exportMemoryPack(): Promise<Uint8Array> {
    throw new Error("exportMemoryPack: Phase B");
  }

  async pushSync(): Promise<void> {
    await this.opts.sync?.push();
  }

  async pullSync(): Promise<void> {
    await this.opts.sync?.pull();
  }

  startBackgroundSync(): void {
    this.opts.sync?.startBackgroundSync();
  }

  getSessionMessages(sessionId: string) {
    return [...this.requireSession(sessionId).messages];
  }

  private async persist(session: SessionState): Promise<void> {
    if (!this.opts.sessionStore) return;
    await this.opts.sessionStore.save({
      id: session.id,
      maxIterations: session.maxIterations,
      systemPrompt: session.systemPrompt.split("\n\nRelevant memory:\n")[0],
      messages: session.messages,
      workdir: session.workdir,
      toolNames: session.toolNames,
      busy: false,
    });
  }

  private requireSession(sessionId: string): SessionState {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Unknown session: ${sessionId}`);
    return s;
  }
}
