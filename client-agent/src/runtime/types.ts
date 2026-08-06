/** Public ClientAgentRuntime contract — design §5.1 / PRD US-P03 */

import type { TrustEvent, TrustSignal, TrustTarget } from "../trust/types.js";
import type { IngestEvent } from "../ingest/types.js";

export type TurnStatus = "completed" | "cancelled" | "failed" | "budget_exhausted";

export interface SessionConfig {
  maxIterations?: number;
  systemPrompt?: string;
  toolNames?: string[];
}

export interface TurnResult {
  sessionId: string;
  turnId: string;
  status: TurnStatus;
  assistantText: string;
  iterations: number;
  errorMessage?: string;
}

export interface StreamDelta {
  type: "text" | "tool_call" | "tool_result" | "status" | "error" | "done";
  text?: string;
  toolName?: string;
  toolCallId?: string;
  status?: TurnStatus;
  errorMessage?: string;
}

export type StreamHandler = (delta: StreamDelta) => void;

export interface MemoryListItem {
  id: string;
  text: string;
  trustScore?: number;
  deprecated?: boolean;
}

export interface EpisodeListItem {
  id: string;
  summary: string;
  source?: string;
  updatedAt?: string;
}

export interface ApplyIngestStoreResult {
  accepted: number;
  duplicates: number;
  workspacePathsAdded: number;
}

export interface SubmitFeedbackInput {
  sessionId: string;
  turnId?: string;
  target: TrustTarget;
  targetId: string;
  signal: TrustSignal;
}

/** Inline image payloads for runTurn (data:image/...;base64,...). */
export type RunTurnImages = { dataUrl: string }[];

export type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail?: "auto" | "low" | "high" };
    };

export interface ClientAgentRuntime {
  createSession(config?: SessionConfig): Promise<string>;
  runTurn(
    sessionId: string,
    userMessage: string,
    stream?: StreamHandler,
    images?: RunTurnImages,
  ): Promise<TurnResult>;
  interrupt(sessionId: string): Promise<void>;
  importMemoryPack(data: Uint8Array): Promise<void>;
  exportMemoryPack(): Promise<Uint8Array>;
  pushSync(): Promise<void>;
  pullSync(): Promise<void>;
  startBackgroundSync(): void;
  submitFeedback(input: SubmitFeedbackInput): Promise<void>;
  listMemory(): Promise<MemoryListItem[]>;
  deleteMemory(id: string): Promise<void>;
  setTrustReportingEnabled(enabled: boolean): void;
  applyIngest?(events: IngestEvent[]): Promise<ApplyIngestStoreResult>;
  listEpisodes?(): Promise<EpisodeListItem[]>;
  listWorkspacePaths?(): Promise<string[]>;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LlmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface LlmResult {
  content: string | null;
  tool_calls: LlmToolCall[];
  finish_reason?: string;
  /** Monotonic SSE/JSON event cursor from the control plane. */
  cursor?: string;
}

export interface LlmCallOptions {
  signal?: AbortSignal;
  /** Resume / Last-Event-ID style cursor from a prior SSE event. */
  cursor?: string;
}

export interface LlmTransport {
  complete(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    options?: LlmCallOptions,
  ): Promise<LlmResult>;
  stream(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    onDelta: (text: string) => void,
    options?: LlmCallOptions,
  ): Promise<LlmResult>;
}

export interface MemoryBundle {
  semantic: Array<{ id: string; text: string; score: number }>;
  episode: Array<{ id: string; summary: string; score: number }>;
  procedural: Array<{ id: string; text: string; score: number }>;
  workspaceHints: string[];
}

export interface MemoryOrchestrator {
  retrieve(query: string): Promise<MemoryBundle>;
  commitTurn(turnTrace: {
    sessionId: string;
    turnId: string;
    userMessage: string;
    assistantText: string;
    /** When set, episode summary appends ` [N images]`. */
    imageCount?: number;
  }): Promise<void>;
  applyTrust?(event: TrustEvent): Promise<void>;
  listSemantic?(): Promise<MemoryListItem[]>;
  deleteSemantic?(id: string): Promise<void>;
  applyIngest?(events: IngestEvent[]): Promise<ApplyIngestStoreResult>;
  listEpisode?(): Promise<EpisodeListItem[]>;
  listWorkspacePaths?(): Promise<string[]>;
}

export interface SyncMutation {
  entityType: "message" | "semantic" | "episode" | "procedural" | "session_meta";
  entityId: string;
  version: number;
  updatedAt: string;
  deviceId: string;
  tombstone?: boolean;
  payload: Record<string, unknown>;
  embedding?: number[];
  embeddingModelId?: string;
}

export interface SyncPushRequest {
  deviceId: string;
  mutations: SyncMutation[];
}

export interface SyncPullResponse {
  cursor: string;
  mutations: SyncMutation[];
}

export interface SyncEngine {
  push(): Promise<void>;
  pull(): Promise<void>;
  startBackgroundSync(): void;
}
