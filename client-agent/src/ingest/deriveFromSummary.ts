import type { IngestEvent } from "./types.js";

const DECISION_RE =
  /(?:we\s+decided\s+to|decided\s+to|we\s+will|we\s+should|prefer(?:s|red)?|决定(?:了)?|我们(?:将|要|决定))\s+(.+?)(?:[.。]|$)/gi;

const NUMBERED_STEP_RE = /^\s*\d+[.)、]\s+\S+/m;

function parseSteps(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)、]/.test(l))
    .map((l) => l.replace(/^\d+[.)、]\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Rule-based enrichment: expand session_summary into decision / procedure_draft events.
 * Runs synchronously; can later move to a background queue without changing applyIngest.
 */
export function deriveIngestEvents(events: IngestEvent[]): IngestEvent[] {
  const out: IngestEvent[] = [];
  for (const e of events) {
    if (e.kind !== "session_summary") continue;
    const summary = e.summary || "";
    let di = 0;
    for (const m of summary.matchAll(DECISION_RE)) {
      const clause = (m[1] || "").trim();
      if (clause.length < 3) continue;
      out.push({
        eventId: `${e.eventId}:decision:${di++}`,
        schemaVersion: e.schemaVersion,
        source: e.source,
        kind: "decision",
        summary: clause.slice(0, 2000),
        paths: [],
        scrubbed: e.scrubbed,
        nativeSessionId: e.nativeSessionId,
        deviceId: e.deviceId,
      });
    }

    const hint = e.skillHint?.trim() || "";
    const stepSource = NUMBERED_STEP_RE.test(hint)
      ? hint
      : NUMBERED_STEP_RE.test(summary)
        ? summary
        : "";
    if (stepSource) {
      const steps = parseSteps(stepSource);
      if (steps.length >= 2) {
        out.push({
          eventId: `${e.eventId}:procedure:0`,
          schemaVersion: e.schemaVersion,
          source: e.source,
          kind: "procedure_draft",
          summary: summary.slice(0, 200) || "procedure",
          paths: [],
          scrubbed: e.scrubbed,
          skillHint: steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
          nativeSessionId: e.nativeSessionId,
          deviceId: e.deviceId,
        });
      }
    }
  }
  return out;
}

/** Original events plus derived enrichments (dedupe by eventId). */
export function withDerivedIngestEvents(events: IngestEvent[]): IngestEvent[] {
  const derived = deriveIngestEvents(events);
  const seen = new Set(events.map((e) => e.eventId));
  const merged = [...events];
  for (const d of derived) {
    if (seen.has(d.eventId)) continue;
    seen.add(d.eventId);
    merged.push(d);
  }
  return merged;
}
