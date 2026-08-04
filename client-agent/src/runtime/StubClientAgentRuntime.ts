import type {
  ClientAgentRuntime,
  MemoryListItem,
  SessionConfig,
  StreamHandler,
  SubmitFeedbackInput,
  TurnResult,
} from "./types.js";

/**
 * Stub runtime for CA-1 — real loop lands in CA-E3.
 * Ensures public API surface is exportable and type-checkable.
 */
export class StubClientAgentRuntime implements ClientAgentRuntime {
  async createSession(_config?: SessionConfig): Promise<string> {
    return crypto.randomUUID();
  }

  async runTurn(
    sessionId: string,
    _userMessage: string,
    _stream?: StreamHandler,
  ): Promise<TurnResult> {
    return {
      sessionId,
      turnId: crypto.randomUUID(),
      status: "failed",
      assistantText: "",
      iterations: 0,
      errorMessage: "StubClientAgentRuntime: not implemented",
    };
  }

  async interrupt(_sessionId: string): Promise<void> {
    /* no-op */
  }

  async importMemoryPack(_data: Uint8Array): Promise<void> {
    throw new Error("importMemoryPack: Phase B");
  }

  async exportMemoryPack(): Promise<Uint8Array> {
    throw new Error("exportMemoryPack: Phase B");
  }

  async pushSync(): Promise<void> {
    /* no-op */
  }

  async pullSync(): Promise<void> {
    /* no-op */
  }

  startBackgroundSync(): void {
    /* no-op */
  }

  async submitFeedback(_input: SubmitFeedbackInput): Promise<void> {
    /* no-op */
  }

  async listMemory(): Promise<MemoryListItem[]> {
    return [];
  }

  async deleteMemory(_id: string): Promise<void> {
    /* no-op */
  }

  setTrustReportingEnabled(_enabled: boolean): void {
    /* no-op */
  }
}
