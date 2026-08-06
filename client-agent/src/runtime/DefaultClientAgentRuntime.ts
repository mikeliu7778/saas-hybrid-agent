import type {
  ClientAgentRuntime,
  MemoryOrchestrator,
  SessionConfig,
  StreamHandler,
  SubmitFeedbackInput,
  SyncEngine,
  TurnResult,
  MemoryListItem,
  RunTurnImages,
  ApplyIngestStoreResult,
  EpisodeListItem,
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
import { extractText } from "./contentParts.js";
import type { IngestEvent } from "../ingest/types.js";
import {
  formatMemoryBundle,
  recalledIdsFromBundle,
} from "../memory/formatMemoryBundle.js";
import {
  decodeMemoryPack,
  encodeMemoryPack,
  memorySearch,
} from "../memory/memoryPack.js";
import type { MemoryHit } from "../memory/memoryPack.js";
import {
  getDefaultOnDeviceIntelligence,
  type OnDeviceIntelligence,
} from "../memory/onDeviceIntelligence.js";
import { InMemoryMemoryStore } from "../memory/InMemoryMemoryStore.js";

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
  /** I5b-D: on-device summary/rerank (default: rules). */
  onDevice?: OnDeviceIntelligence;
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
    images?: RunTurnImages,
  ): Promise<TurnResult> {
    const session = this.requireSession(sessionId);

    // Keep base system prompt separate from memory injection for persistence.
    const baseSystem = session.systemPrompt.split("\n\nRelevant memory:\n")[0];
    session.systemPrompt = baseSystem;

    const textOnly = extractText(userMessage);
    let recalledIds: string[] = [];
    if (this.opts.memory) {
      const bundle = await this.opts.memory.retrieve(textOnly);
      recalledIds = recalledIdsFromBundle(bundle);
      const memBits = formatMemoryBundle(bundle);
      if (memBits.length > 0) {
        session.systemPrompt = `${baseSystem}\n\nRelevant memory:\n${memBits.join("\n")}`;
      }
    }

    const result = await this.loop.runTurn(session, userMessage, stream, images);
    session.systemPrompt = baseSystem;
    await this.persist(session);

    if (this.opts.memory && result.status === "completed") {
      const imageCount = images?.length ?? 0;
      await this.opts.memory.commitTurn({
        sessionId,
        turnId: result.turnId,
        userMessage: textOnly,
        assistantText: result.assistantText,
        imageCount: imageCount > 0 ? imageCount : undefined,
      });

      // I2: feed Hybrid turns back into personal KB as ingest episodes.
      if (this.opts.memory.applyIngest) {
        const onDevice =
          this.opts.onDevice ?? getDefaultOnDeviceIntelligence();
        const summary = await onDevice.summarizeSession({
          userMessage: textOnly,
          assistantText: result.assistantText,
        });
        const hybridEvent: IngestEvent = {
          eventId: `hybrid-turn-${result.turnId}`,
          schemaVersion: "1",
          source: "hybrid",
          kind: "session_summary",
          summary,
          paths: [],
          scrubbed: true,
          nativeSessionId: sessionId,
          tsStart: new Date().toISOString(),
          tsEnd: new Date().toISOString(),
        };
        await this.opts.memory.applyIngest([hybridEvent]);
      }

      const events = this.trustCollector.onTurnCompleted({
        sessionId,
        turnId: result.turnId,
        userMessage: textOnly,
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

  async importMemoryPack(data: Uint8Array): Promise<void> {
    if (!(this.opts.memory instanceof InMemoryMemoryStore)) {
      throw new Error("importMemoryPack: memory store must be InMemoryMemoryStore");
    }
    decodeMemoryPack(this.opts.memory, data);
    const flush = (this.opts.memory as { flush?: () => Promise<void> }).flush;
    if (typeof flush === "function") await flush.call(this.opts.memory);
  }

  async exportMemoryPack(): Promise<Uint8Array> {
    if (!(this.opts.memory instanceof InMemoryMemoryStore)) {
      throw new Error("exportMemoryPack: memory store must be InMemoryMemoryStore");
    }
    return encodeMemoryPack(this.opts.memory);
  }

  async searchMemory(query: string, limit = 8): Promise<MemoryHit[]> {
    if (!(this.opts.memory instanceof InMemoryMemoryStore)) {
      throw new Error("searchMemory: memory store must be InMemoryMemoryStore");
    }
    return memorySearch(this.opts.memory, query, limit, {
      onDevice: this.opts.onDevice ?? getDefaultOnDeviceIntelligence(),
    });
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

  async deleteEpisode(id: string): Promise<void> {
    await this.opts.memory?.deleteEpisode?.(id);
    const event = this.trustCollector.onMemoryDeleted(id);
    await this.opts.memory?.applyTrust?.(event);
    this.trustQueue.enqueue(event);
    this.fireFlush();
  }

  setTrustReportingEnabled(enabled: boolean): void {
    this.trustQueue.setReportingEnabled(enabled);
  }

  async applyIngest(events: IngestEvent[]): Promise<ApplyIngestStoreResult> {
    if (!this.opts.memory?.applyIngest) {
      return { accepted: 0, duplicates: 0, workspacePathsAdded: 0 };
    }
    return this.opts.memory.applyIngest(events);
  }

  async listEpisodes(): Promise<EpisodeListItem[]> {
    if (!this.opts.memory?.listEpisode) return [];
    return this.opts.memory.listEpisode();
  }

  async listWorkspacePaths(): Promise<string[]> {
    if (!this.opts.memory?.listWorkspacePaths) return [];
    return this.opts.memory.listWorkspacePaths();
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
