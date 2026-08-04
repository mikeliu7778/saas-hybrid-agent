import type {
  LlmCallOptions,
  LlmMessage,
  LlmResult,
  LlmToolCall,
  LlmToolDefinition,
  LlmTransport,
} from "../runtime/types.js";

export type MockLlmScriptStep =
  | { type: "text"; content: string }
  | { type: "tool_calls"; toolCalls: LlmToolCall[] }
  | { type: "error"; message: string };

/**
 * CA-3.1 — scriptable LLM transport for unit tests.
 * Each complete/stream call consumes the next script step.
 */
export class MockLlmTransport implements LlmTransport {
  private scriptIndex = 0;
  readonly calls: Array<{ messages: LlmMessage[]; tools: LlmToolDefinition[] }> = [];

  constructor(private readonly script: MockLlmScriptStep[]) {}

  reset(): void {
    this.scriptIndex = 0;
    this.calls.length = 0;
  }

  async complete(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    options?: LlmCallOptions,
  ): Promise<LlmResult> {
    this.ensureNotAborted(options?.signal);
    this.calls.push({ messages, tools });
    return this.nextResult();
  }

  async stream(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    onDelta: (text: string) => void,
    options?: LlmCallOptions,
  ): Promise<LlmResult> {
    this.ensureNotAborted(options?.signal);
    this.calls.push({ messages, tools });
    const result = this.nextResult();
    if (result.content) {
      for (const ch of result.content) {
        this.ensureNotAborted(options?.signal);
        onDelta(ch);
      }
    }
    return result;
  }

  private nextResult(): LlmResult {
    if (this.scriptIndex >= this.script.length) {
      throw new Error("MockLlmTransport: script exhausted");
    }
    const step = this.script[this.scriptIndex++];
    if (step.type === "error") {
      throw new Error(step.message);
    }
    if (step.type === "text") {
      return { content: step.content, tool_calls: [], finish_reason: "stop" };
    }
    return { content: null, tool_calls: step.toolCalls, finish_reason: "tool_calls" };
  }

  private ensureNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
  }
}
