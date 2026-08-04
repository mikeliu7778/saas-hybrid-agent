export type TrustSignal = "trust" | "distrust" | "correct";
export type TrustTarget =
  | "assistant_message"
  | "memory_item"
  | "tool_result"
  | "citation";

export interface TrustEvent {
  eventId: string;
  deviceId?: string;
  accountId?: string;
  sessionId?: string;
  turnId?: string;
  kind: string;
  target: TrustTarget;
  targetId: string;
  signal: TrustSignal;
  strength: number; // 0..1
  payload?: Record<string, unknown>;
  ts: string;
}
