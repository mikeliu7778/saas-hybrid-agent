/** I0 ingest_event — aligns with multi-tool ingest design §4. */

export type IngestSource =
  | "cursor"
  | "claude_code"
  | "codex"
  | "hybrid"
  | "other";

export type IngestKind =
  | "session_summary"
  | "file_touch"
  | "decision"
  | "procedure_draft"
  | "raw_marker";

export interface IngestEvent {
  eventId: string;
  schemaVersion: string;
  source: IngestSource;
  kind: IngestKind;
  summary: string;
  paths: string[];
  scrubbed: boolean;
  accountHint?: string;
  deviceId?: string;
  nativeSessionId?: string;
  tsStart?: string;
  tsEnd?: string;
  cwd?: string;
  workspaceRoot?: string;
  skillHint?: string;
  payload?: Record<string, unknown>;
}
