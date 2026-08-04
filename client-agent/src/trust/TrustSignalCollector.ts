import type { TrustEvent, TrustSignal, TrustTarget } from "./types.js";

export interface TrustSignalCollectorOptions {
  deviceId: string;
  accountId?: string;
}

export interface TurnCompletedInput {
  sessionId: string;
  turnId: string;
  userMessage: string;
  recalledMemoryIds: string[];
  assistantText: string;
}

export interface ExplicitFeedbackInput {
  sessionId?: string;
  turnId?: string;
  target: TrustTarget;
  targetId: string;
  signal: TrustSignal;
}

const IMPLICIT_MEMORY_REUSE_STRENGTH = 0.35;
const IMPLICIT_MEMORY_DELETED_STRENGTH = 0.9;
const EXPLICIT_FEEDBACK_STRENGTH = 0.85;

function explicitKindForTarget(target: TrustTarget): string {
  switch (target) {
    case "assistant_message":
      return "explicit_message_feedback";
    case "memory_item":
      return "explicit_memory_feedback";
    case "tool_result":
      return "explicit_tool_feedback";
    case "citation":
      return "explicit_citation_feedback";
  }
}

export class TrustSignalCollector {
  constructor(private readonly opts: TrustSignalCollectorOptions) {}

  onMemoryDeleted(memoryId: string): TrustEvent {
    return this.buildEvent({
      kind: "implicit_memory_deleted",
      target: "memory_item",
      targetId: memoryId,
      signal: "distrust",
      strength: IMPLICIT_MEMORY_DELETED_STRENGTH,
    });
  }

  onTurnCompleted(input: TurnCompletedInput): TrustEvent[] {
    return input.recalledMemoryIds.map((memoryId) =>
      this.buildEvent({
        kind: "implicit_memory_reuse",
        target: "memory_item",
        targetId: memoryId,
        signal: "trust",
        strength: IMPLICIT_MEMORY_REUSE_STRENGTH,
        sessionId: input.sessionId,
        turnId: input.turnId,
      }),
    );
  }

  onExplicitFeedback(input: ExplicitFeedbackInput): TrustEvent {
    return this.buildEvent({
      kind: explicitKindForTarget(input.target),
      target: input.target,
      targetId: input.targetId,
      signal: input.signal,
      strength: EXPLICIT_FEEDBACK_STRENGTH,
      sessionId: input.sessionId,
      turnId: input.turnId,
    });
  }

  private buildEvent(
    fields: Omit<TrustEvent, "eventId" | "deviceId" | "accountId" | "ts"> &
      Partial<Pick<TrustEvent, "sessionId" | "turnId">>,
  ): TrustEvent {
    return {
      eventId: crypto.randomUUID(),
      deviceId: this.opts.deviceId,
      accountId: this.opts.accountId,
      ts: new Date().toISOString(),
      ...fields,
    };
  }
}
