import type {
  ClientAgentRuntime,
  MemoryOrchestrator,
  SessionConfig,
  StreamHandler,
  SubmitFeedbackInput,
  SyncEngine,
  TurnResult,
  MemoryListItem,
} from "./types.js";
import { ConversationLoop, type SessionState } from "./ConversationLoop.js";
import type { LlmTransport } from "./types.js";
import type { ToolHost } from "../tools/ToolHost.js";
import type { PersistedSessionStore } from "../storage/PersistedSessionStore.js";
import { TrustSignalCollector } from "../trust/TrustSignalCollector.js";
import {
  TrustEventQueue,
  type TrustEventClient,
} from "../trust/TrustEventQueue.js";

export interface DefaultRuntimeOptions {
  llm: LlmTransport;
  tools: ToolHost;
  memory?: MemoryOrchestrator;
  sync?: SyncEngine;
  sessionStore?: PersistedSessionStore;
  defaultMaxIterations?: number;
  defaultSystemPrompt?: string;
  deviceId?: string;
  trustCollector?: TrustSignalCollector;
  trustQueue?: TrustEventQueue;
  trustClient?: TrustEventClient;
}

export class DefaultClientAgentRuntime implements ClientAgentRuntime {
  private readonly sessions = new Map<string, SessionState>();
  private readonly loop: ConversationLoop;
  private readonly opts: DefaultRuntimeOptions;
  private readonly trustCollector: TrustSignalCollector;
  private readonly trustQueue: TrustEventQueue;
  private readonly trustClient?: TrustEventClient;

  constructor(opts: DefaultRuntimeOptions) {
    this.opts = opts;
    this.loop = new ConversationLoop({ llm: opts.llm, tools: opts.tools });
    const deviceId = opts.deviceId ?? "local";
    this.trustCollector =
      opts.trustCollector ?? new TrustSignalCollector({ deviceId });
    this.trustQueue = opts.trustQueue ?? new TrustEventQueue();
    this.trustClient = opts.trustClient;
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

    let recalledIds: string[] = [];
    if (this.opts.memory) {
      const bundle = await this.opts.memory.retrieve(userMessage);
      recalledIds = bundle.semantic.map((s) => s.id);
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
      await this.opts.memory.commitTurn({
        sessionId,
        turnId: result.turnId,
        userMessage,
        assistantText: result.assistantText,
      });

      const events = this.trustCollector.onTurnCompleted({
        sessionId,
        turnId: result.turnId,
        userMessage,
        recalledMemoryIds: recalledIds,
        assistantText: result.assistantText,
      });
      for (const event of events) {
        await this.opts.memory.applyTrust?.(event);
        this.trustQueue.enqueue(event);
      }
      this.fireFlush();
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

  async submitFeedback(input: SubmitFeedbackInput): Promise<void> {
    const event = this.trustCollector.onExplicitFeedback({
      sessionId: input.sessionId,
      turnId: input.turnId,
      target: input.target,
      targetId: input.targetId,
      signal: input.signal,
    });
    if (input.target === "memory_item") {
      await this.opts.memory?.applyTrust?.(event);
    }
    this.trustQueue.enqueue(event);
    this.fireFlush();
  }

  async listMemory(): Promise<MemoryListItem[]> {
    if (!this.opts.memory?.listSemantic) return [];
    return this.opts.memory.listSemantic();
  }

  async deleteMemory(id: string): Promise<void> {
    await this.opts.memory?.deleteSemantic?.(id);
    const event = this.trustCollector.onMemoryDeleted(id);
    await this.opts.memory?.applyTrust?.(event);
    this.trustQueue.enqueue(event);
    this.fireFlush();
  }

  setTrustReportingEnabled(enabled: boolean): void {
    this.trustQueue.setReportingEnabled(enabled);
  }

  getSessionMessages(sessionId: string) {
    return [...this.requireSession(sessionId).messages];
  }

  private fireFlush(): void {
    if (!this.trustClient) return;
    void this.trustQueue.flush(this.trustClient);
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
