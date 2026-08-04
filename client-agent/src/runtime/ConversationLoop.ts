import type {
  LlmMessage,
  LlmTransport,
  StreamHandler,
  TurnResult,
  TurnStatus,
} from "../runtime/types.js";
import type { ToolHost } from "../tools/ToolHost.js";
import { truncateToolResult } from "../tools/ToolHost.js";

export interface SessionState {
  id: string;
  maxIterations: number;
  systemPrompt: string;
  messages: LlmMessage[];
  workdir: string;
  toolNames?: string[];
  interrupt: AbortController;
  busy: boolean;
}

export interface ConversationLoopDeps {
  llm: LlmTransport;
  tools: ToolHost;
}

/**
 * Client-side tool loop — mirrors Java ConversationLoop semantics:
 * budget resets per turn; tools execute locally; interrupt between steps.
 */
export class ConversationLoop {
  constructor(private readonly deps: ConversationLoopDeps) {}

  async runTurn(
    session: SessionState,
    userMessage: string,
    stream?: StreamHandler,
  ): Promise<TurnResult> {
    if (session.busy) {
      throw new Error(`SessionBusy: ${session.id}`);
    }
    session.busy = true;
    const turnId = crypto.randomUUID();
    let iterations = 0;
    let assistantText = "";
    let status: TurnStatus = "completed";

    try {
      // Align with Java: do not clear interrupt at turn start (pre-turn abort → cancelled).
      session.messages.push({ role: "user", content: userMessage });
      stream?.({ type: "status", status: "completed", text: "turn_started" });

      const toolDefs = this.deps.tools.listDefinitions(session.toolNames);
      const maxIter = session.maxIterations;

      while (iterations < maxIter) {
        if (session.interrupt.signal.aborted) {
          status = "cancelled";
          break;
        }

        iterations += 1;
        const messages: LlmMessage[] = [
          { role: "system", content: session.systemPrompt },
          ...session.messages,
        ];

        const result = stream
          ? await this.deps.llm.stream(
              messages,
              toolDefs,
              (t) => stream({ type: "text", text: t }),
              { signal: session.interrupt.signal },
            )
          : await this.deps.llm.complete(messages, toolDefs, {
              signal: session.interrupt.signal,
            });

        if (session.interrupt.signal.aborted) {
          status = "cancelled";
          break;
        }

        if (result.tool_calls.length > 0) {
          session.messages.push({
            role: "assistant",
            content: result.content,
            tool_calls: result.tool_calls,
          });

          for (const call of result.tool_calls) {
            if (session.interrupt.signal.aborted) {
              status = "cancelled";
              break;
            }
            stream?.({
              type: "tool_call",
              toolName: call.function.name,
              toolCallId: call.id,
            });

            let toolResult;
            try {
              // Validate JSON args — bad JSON still returns model-visible error
              JSON.parse(call.function.arguments || "{}");
              toolResult = await this.deps.tools.execute(
                call.function.name,
                call.function.arguments || "{}",
                { sessionId: session.id, workdir: session.workdir },
              );
            } catch (e) {
              toolResult = {
                ok: false,
                content: `Invalid tool arguments: ${e instanceof Error ? e.message : String(e)}`,
              };
            }

            const content = truncateToolResult(toolResult.content);
            stream?.({
              type: "tool_result",
              toolName: call.function.name,
              toolCallId: call.id,
              text: content,
            });
            session.messages.push({
              role: "tool",
              content,
              tool_call_id: call.id,
              name: call.function.name,
            });
          }
          if (status === "cancelled") break;
          continue;
        }

        assistantText = result.content ?? "";
        session.messages.push({ role: "assistant", content: assistantText });
        status = "completed";
        break;
      }

      if (status === "completed" && iterations >= maxIter && !assistantText) {
        // exhausted without final text
        const last = session.messages[session.messages.length - 1];
        if (last?.role === "tool" || (last?.role === "assistant" && last.tool_calls?.length)) {
          status = "budget_exhausted";
        }
      } else if (iterations >= maxIter && status === "completed" && !assistantText) {
        status = "budget_exhausted";
      }

      // Detect budget: loop ended because iterations hit max without final assistant text path
      if (iterations >= maxIter && status === "completed") {
        const last = session.messages[session.messages.length - 1];
        if (last?.role !== "assistant" || last.tool_calls?.length) {
          status = "budget_exhausted";
        }
      }

      stream?.({ type: "done", status });
      return {
        sessionId: session.id,
        turnId,
        status,
        assistantText,
        iterations,
      };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        status = "cancelled";
        stream?.({ type: "done", status });
        return {
          sessionId: session.id,
          turnId,
          status,
          assistantText,
          iterations,
        };
      }
      const errorMessage = e instanceof Error ? e.message : String(e);
      stream?.({ type: "error", errorMessage });
      stream?.({ type: "done", status: "failed" });
      return {
        sessionId: session.id,
        turnId,
        status: "failed",
        assistantText,
        iterations,
        errorMessage,
      };
    } finally {
      session.busy = false;
      // Clear interrupt after turn ends so next turn can proceed.
      if (session.interrupt.signal.aborted) {
        session.interrupt = new AbortController();
      }
    }
  }
}
