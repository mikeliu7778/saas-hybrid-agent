import type {
  LlmCallOptions,
  LlmMessage,
  LlmResult,
  LlmToolCall,
  LlmToolDefinition,
  LlmTransport,
} from "../runtime/types.js";

export interface HttpLlmTransportOptions {
  baseUrl: string;
  token: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export interface SseJsonEvent {
  id?: string;
  data: Record<string, unknown>;
}

/**
 * Talks to Cloud Control Plane POST /v1/llm/chat (JSON or SSE).
 * Supports event `cursor` / SSE `id` + request `cursor` / `Last-Event-ID`.
 */
export class HttpLlmTransport implements LlmTransport {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly model?: string;
  private readonly fetchImpl: typeof fetch;

  /** Last cursor observed from the most recent complete/stream call. */
  lastCursor?: string;

  constructor(opts: HttpLlmTransportOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  async complete(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    options?: LlmCallOptions,
  ): Promise<LlmResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/llm/chat`, {
      method: "POST",
      headers: this.headers("application/json", options?.cursor),
      body: JSON.stringify({
        model: this.model,
        messages: toWireMessages(messages),
        tools,
        stream: false,
        cursor: options?.cursor,
      }),
      signal: options?.signal,
    });
    if (!res.ok) {
      throw new Error(`LLM gateway HTTP ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      content?: string | null;
      tool_calls?: LlmToolCall[];
      finish_reason?: string;
      cursor?: string;
    };
    if (body.cursor) this.lastCursor = body.cursor;
    return {
      content: body.content ?? null,
      tool_calls: body.tool_calls ?? [],
      finish_reason: body.finish_reason,
      cursor: body.cursor,
    };
  }

  async stream(
    messages: LlmMessage[],
    tools: LlmToolDefinition[],
    onDelta: (text: string) => void,
    options?: LlmCallOptions,
  ): Promise<LlmResult> {
    const since = options?.cursor;
    const res = await this.fetchImpl(`${this.baseUrl}/v1/llm/chat`, {
      method: "POST",
      headers: this.headers("text/event-stream", since),
      body: JSON.stringify({
        model: this.model,
        messages: toWireMessages(messages),
        tools,
        stream: true,
        cursor: since,
      }),
      signal: options?.signal,
    });
    if (!res.ok) {
      throw new Error(`LLM gateway HTTP ${res.status}: ${await res.text()}`);
    }

    let content = "";
    const toolCalls: LlmToolCall[] = [];
    let finishReason: string | undefined;
    let lastCursor = since;

    for await (const event of iterateSseJsonEvents(res, options?.signal)) {
      ensureNotAborted(options?.signal);
      const cursor = eventCursor(event);
      if (cursor && since && compareCursor(cursor, since) <= 0) {
        // Dedup when reconnecting with Last-Event-ID / cursor
        continue;
      }
      if (cursor) {
        lastCursor = cursor;
        this.lastCursor = cursor;
      }

      const type = String(event.data.type ?? "");
      if (type === "delta" && typeof event.data.text === "string") {
        content += event.data.text;
        onDelta(event.data.text);
      } else if (type === "tool_call") {
        toolCalls.push({
          id: String(event.data.id ?? crypto.randomUUID()),
          type: "function",
          function: {
            name: String(event.data.name ?? ""),
            arguments: String(event.data.arguments ?? "{}"),
          },
        });
      } else if (type === "done") {
        finishReason =
          typeof event.data.finish_reason === "string" ? event.data.finish_reason : "stop";
      } else if (type === "error") {
        throw new Error(String(event.data.error ?? "LLM stream error"));
      }
    }

    return {
      content: content || null,
      tool_calls: toolCalls,
      finish_reason: finishReason ?? (toolCalls.length ? "tool_calls" : "stop"),
      cursor: lastCursor,
    };
  }

  private headers(accept: string, cursor?: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: accept,
    };
    if (cursor) {
      h["Last-Event-ID"] = cursor;
    }
    return h;
  }
}

function toWireMessages(messages: LlmMessage[]): unknown[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    tool_calls: m.tool_calls,
    tool_call_id: m.tool_call_id,
    name: m.name,
  }));
}

function eventCursor(event: SseJsonEvent): string | undefined {
  if (event.id) return event.id;
  const c = event.data.cursor;
  return typeof c === "string" || typeof c === "number" ? String(c) : undefined;
}

/** Numeric-aware cursor compare; falls back to string compare. */
export function compareCursor(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

/**
 * Incremental SSE reader. Falls back to buffering when body is unavailable.
 */
export async function* iterateSseJsonEvents(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<SseJsonEvent> {
  if (!res.body || typeof res.body.getReader !== "function") {
    for (const event of parseSseJsonEvents(await res.text())) {
      yield event;
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      ensureNotAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\n\n+/);
      buffer = parts.pop() ?? "";
      for (const block of parts) {
        const parsed = parseSseBlock(block);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

/** Minimal SSE parser for `id:` + `data:{json}` blocks from Spring SseEmitter. */
export function parseSseJsonEvents(raw: string): SseJsonEvent[] {
  return raw
    .split(/\n\n+/)
    .map(parseSseBlock)
    .filter((e): e is SseJsonEvent => e != null);
}

function parseSseBlock(block: string): SseJsonEvent | null {
  if (!block.trim()) return null;
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n");
  if (!payload || payload === "[DONE]") return null;
  try {
    const data = JSON.parse(payload) as Record<string, unknown>;
    return { id, data };
  } catch {
    return null;
  }
}
