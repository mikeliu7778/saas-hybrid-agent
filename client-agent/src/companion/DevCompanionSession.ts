/**
 * I5b-C — optional Dev Companion session recorder → ingest_event.
 * Records remote/on-machine terminal turns; does not execute shell itself.
 */

import type { IngestEvent } from "../ingest/types.js";
import { scrubEvent } from "../ingest/scrub.js";

export type CompanionRecord =
  | { type: "user"; text: string }
  | { type: "cmd"; cmd: string; cwd?: string; exit?: number }
  | { type: "stdout" | "stderr"; text: string }
  | { type: "file_touch"; path: string }
  | { type: "assistant"; text: string };

const PATH_RE =
  /(?:^|[\s`"'(])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+|[\w.-]+\.(?:ts|tsx|js|jsx|py|md|json|yaml|yml|java|go|rs))/g;

function extractPaths(text: string, paths: string[], seen: Set<string>): void {
  PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(text)) !== null) {
    const p = m[1]!;
    if (!seen.has(p)) {
      seen.add(p);
      paths.push(p);
    }
  }
}

function stableId(sessionId: string, material: string): string {
  let h = 2166136261;
  const s = `${sessionId}\n${material}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export class DevCompanionSession {
  readonly sessionId: string;
  private readonly records: CompanionRecord[] = [];
  private cwd?: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  record(rec: CompanionRecord): void {
    if (rec.type === "cmd" && rec.cwd) this.cwd = rec.cwd;
    this.records.push(rec);
  }

  /** Build scrubbed ingest events (session_summary + file_touch + optional procedure_draft). */
  toIngestEvents(): IngestEvent[] {
    const userBits: string[] = [];
    const assistantBits: string[] = [];
    const paths: string[] = [];
    const seen = new Set<string>();
    const cmdSteps: string[] = [];
    const material = this.records.map((r) => JSON.stringify(r)).join("\n");

    for (const r of this.records) {
      if (r.type === "user") {
        userBits.push(r.text);
        extractPaths(r.text, paths, seen);
      } else if (r.type === "assistant") {
        assistantBits.push(r.text);
        extractPaths(r.text, paths, seen);
      } else if (r.type === "cmd") {
        const step =
          r.exit === undefined ? r.cmd : `${r.cmd} (exit=${r.exit})`;
        cmdSteps.push(step);
        assistantBits.push(`$ ${step}`);
        extractPaths(r.cmd, paths, seen);
      } else if (r.type === "stdout" || r.type === "stderr") {
        assistantBits.push(r.text.slice(0, 200));
        extractPaths(r.text, paths, seen);
      } else if (r.type === "file_touch") {
        if (!seen.has(r.path)) {
          seen.add(r.path);
          paths.push(r.path);
        }
      }
    }

    const digest = stableId(this.sessionId, material);
    const eventId = `dev_companion:${this.sessionId}:${digest}`;
    const userHead = userBits.join(" ").slice(0, 120) || "(companion terminal)";
    const asstHead = assistantBits.join(" ").slice(0, 120) || "(no output)";
    const summary = `${userHead} → ${asstHead}`.slice(0, 2000);

    const base = {
      schemaVersion: "1" as const,
      source: "dev_companion" as const,
      scrubbed: false as const,
      nativeSessionId: this.sessionId,
      ...(this.cwd ? { cwd: this.cwd, workspaceRoot: this.cwd } : {}),
    };

    const events: IngestEvent[] = [
      scrubEvent({
        ...base,
        eventId,
        kind: "session_summary",
        summary,
        paths: [...paths].slice(0, 50),
      }),
    ];

    paths.slice(0, 50).forEach((p, i) => {
      events.push(
        scrubEvent({
          ...base,
          eventId: `${eventId}:path:${i}`,
          kind: "file_touch",
          summary: `touched ${p}`,
          paths: [p],
        }),
      );
    });

    if (cmdSteps.length >= 2) {
      const body = cmdSteps
        .slice(0, 40)
        .map((s, i) => `${i + 1}. ${s}`)
        .join("\n");
      events.push(
        scrubEvent({
          ...base,
          eventId: `${eventId}:procedure`,
          kind: "procedure_draft",
          summary: `Companion terminal procedure:\n${body}`.slice(0, 2000),
          paths: [...paths].slice(0, 50),
        }),
      );
    }

    return events;
  }
}
