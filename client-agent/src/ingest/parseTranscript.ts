/**
 * Browser-friendly transcript → ingest_event (Demo / Web hosts).
 * Mirrors python-sidecar adapters without Node deps.
 */

import type { IngestEvent, IngestSource } from "./types.js";
import { scrubEvent } from "./scrub.js";

const PATH_RE =
  /(?:^|[\s`"'(])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+|[\w.-]+\.(?:ts|tsx|js|jsx|py|md|json|yaml|yml|java|go|rs))/g;

const MAX_SUMMARY = 2000;
const MAX_PATHS = 50;

function extractPaths(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(text)) !== null) {
    const p = m[1]!;
    if (!seen.has(p)) {
      seen.add(p);
      found.push(p);
    }
  }
  return found;
}

function accumulatePaths(text: string, paths: string[], seen: Set<string>): void {
  for (const p of extractPaths(text)) {
    if (!seen.has(p)) {
      seen.add(p);
      paths.push(p);
    }
  }
}

function ruleSummary(userBits: string[], assistantBits: string[]): string {
  const u = userBits.join(" ").trim();
  const a = assistantBits.join(" ").trim();
  if (!u && !a) return "(empty session)";
  const head = u ? u.slice(0, 120) : "(no user text)";
  const tail = a ? a.slice(0, 120) : "(no assistant text)";
  return `${head} → ${tail}`.slice(0, MAX_SUMMARY);
}

function fnvDigest(material: string): string {
  let h = 2166136261;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function buildEvents(opts: {
  source: IngestSource;
  nativeSessionId: string;
  digestMaterial: string;
  userBits: string[];
  assistantBits: string[];
  paths: string[];
}): IngestEvent[] {
  const paths = opts.paths.slice(0, MAX_PATHS);
  const digest = fnvDigest(`${opts.nativeSessionId}\n${opts.digestMaterial}`);
  const eventId = `${opts.source}:${opts.nativeSessionId}:${digest}`;
  const events: IngestEvent[] = [
    scrubEvent({
      eventId,
      schemaVersion: "1",
      source: opts.source,
      kind: "session_summary",
      summary: ruleSummary(opts.userBits, opts.assistantBits),
      paths: [...paths],
      scrubbed: false,
      nativeSessionId: opts.nativeSessionId,
    }),
  ];
  paths.forEach((p, i) => {
    events.push(
      scrubEvent({
        eventId: `${eventId}:path:${i}`,
        schemaVersion: "1",
        source: opts.source,
        kind: "file_touch",
        summary: `touched ${p}`,
        paths: [p],
        scrubbed: false,
        nativeSessionId: opts.nativeSessionId,
      }),
    );
  });
  return events;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: string }).text ?? "");
        }
        return "";
      })
      .join(" ");
  }
  return "";
}

function roleAndText(row: Record<string, unknown>): { role: string; text: string } {
  if (row.message && typeof row.message === "object") {
    const msg = row.message as Record<string, unknown>;
    return {
      role: String(msg.role ?? row.role ?? ""),
      text: textFromContent(msg.content),
    };
  }
  return {
    role: String(row.role ?? row.type ?? ""),
    text: textFromContent(row.content),
  };
}

/** Cursor / OpenCode-style JSONL transcript. */
export function parseJsonlTranscript(
  text: string,
  opts: { source?: IngestSource; nativeSessionId?: string } = {},
): IngestEvent[] {
  const source = opts.source ?? "cursor";
  const nativeSessionId = opts.nativeSessionId ?? "upload";
  const userBits: string[] = [];
  const assistantBits: string[] = [];
  const paths: string[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: unknown;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const { role, text: body } = roleAndText(row as Record<string, unknown>);
    if (!body) continue;
    const roleL = role.toLowerCase();
    if (roleL === "user" || roleL === "human") userBits.push(body);
    else if (roleL === "assistant" || roleL === "model" || roleL === "ai") {
      assistantBits.push(body);
    }
    accumulatePaths(body, paths, seen);
  }

  return buildEvents({
    source,
    nativeSessionId,
    digestMaterial: text,
    userBits,
    assistantBits,
    paths,
  });
}

/** Continue.dev session JSON. */
export function parseContinueSessionJson(
  text: string,
  opts: { nativeSessionId?: string } = {},
): IngestEvent[] {
  const data = JSON.parse(text) as Record<string, unknown>;
  if (!data || typeof data !== "object") {
    throw new Error("continue session must be a JSON object");
  }
  const nativeSessionId = String(
    opts.nativeSessionId ?? data.sessionId ?? data.session_id ?? "continue",
  );
  const history = (data.history ?? data.messages ?? []) as unknown[];
  const userBits: string[] = [];
  const assistantBits: string[] = [];
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const row of history) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const msg =
      rec.message && typeof rec.message === "object"
        ? (rec.message as Record<string, unknown>)
        : rec;
    const role = String(msg.role ?? "").toLowerCase();
    const body = textFromContent(msg.content);
    if (!body) continue;
    if (role === "user" || role === "human") userBits.push(body);
    else if (role === "assistant" || role === "ai" || role === "model") {
      assistantBits.push(body);
    }
    accumulatePaths(body, paths, seen);
  }

  return buildEvents({
    source: "continue",
    nativeSessionId,
    digestMaterial: text,
    userBits,
    assistantBits,
    paths,
  });
}

/** Aider-style #### User / #### Assistant markdown. */
export function parseAiderHistoryMd(
  text: string,
  opts: { nativeSessionId?: string } = {},
): IngestEvent[] {
  const nativeSessionId = opts.nativeSessionId ?? "aider";
  const userBits: string[] = [];
  const assistantBits: string[] = [];
  const paths: string[] = [];
  const seen = new Set<string>();
  const header = /^####\s+(User|Assistant)\s*:?\s*$/i;

  let role: "user" | "assistant" | null = null;
  let buf: string[] = [];

  const flush = () => {
    const body = buf.join("\n").trim();
    buf = [];
    if (!body || !role) {
      role = null;
      return;
    }
    if (role === "user") userBits.push(body);
    else assistantBits.push(body);
    accumulatePaths(body, paths, seen);
    role = null;
  };

  for (const line of text.split(/\r?\n/)) {
    const m = header.exec(line.trim());
    if (m) {
      flush();
      role = m[1]!.toLowerCase() === "user" ? "user" : "assistant";
      continue;
    }
    if (role) buf.push(line);
  }
  flush();

  return buildEvents({
    source: "aider",
    nativeSessionId,
    digestMaterial: text,
    userBits,
    assistantBits,
    paths,
  });
}

export type TranscriptFormat = "auto" | "jsonl" | "continue" | "aider";

/** Detect format and parse upload into ingest events. */
export function parseTranscriptUpload(
  text: string,
  opts: {
    format?: TranscriptFormat;
    fileName?: string;
    source?: IngestSource;
  } = {},
): IngestEvent[] {
  const format = opts.format ?? "auto";
  const stem = (opts.fileName ?? "upload").replace(/\.[^.]+$/, "") || "upload";
  const trimmed = text.trim();

  if (format === "continue" || (format === "auto" && trimmed.startsWith("{"))) {
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;
      if (data && typeof data === "object" && (data.history || data.messages)) {
        return parseContinueSessionJson(trimmed, { nativeSessionId: stem });
      }
    } catch {
      /* fall through */
    }
  }

  if (
    format === "aider" ||
    (format === "auto" && /^####\s+(User|Assistant)/im.test(trimmed))
  ) {
    return parseAiderHistoryMd(trimmed, { nativeSessionId: stem });
  }

  const source =
    opts.source ??
    (opts.fileName?.toLowerCase().includes("opencode") ? "opencode" : "cursor");
  return parseJsonlTranscript(trimmed, {
    source,
    nativeSessionId: stem,
  });
}
