import { scrubEvent } from "./scrub.js";
import type { IngestEvent } from "./types.js";

export interface ApplyIngestEpisodeDraft {
  id: string;
  eventId: string;
  summary: string;
  source: IngestEvent["source"];
  nativeSessionId?: string;
  timeRangeStart: string;
  timeRangeEnd: string;
}

export interface ApplyIngestSemanticDraft {
  id: string;
  eventId: string;
  text: string;
  source: IngestEvent["source"];
  tags: string[];
}

export interface ApplyIngestProceduralDraft {
  id: string;
  eventId: string;
  text: string;
  steps: string[];
  source: IngestEvent["source"];
  skillId: string;
}

export interface ApplyIngestResult {
  episodes: ApplyIngestEpisodeDraft[];
  semantic: ApplyIngestSemanticDraft[];
  procedural: ApplyIngestProceduralDraft[];
  workspacePathsAdded: string[];
  skippedDuplicateIds: string[];
}

export interface ApplyIngestOptions {
  existingEpisodeIds: Set<string>;
  existingSemanticIds?: Set<string>;
  existingProceduralIds?: Set<string>;
  existingWorkspacePaths?: Iterable<string>;
  /** Max summary length after scrub (default 2000). */
  maxSummaryChars?: number;
}

function episodeIdFor(eventId: string): string {
  return `epi-ingest-${eventId}`;
}

function semanticIdFor(eventId: string): string {
  return `sem-ingest-${eventId}`;
}

function proceduralIdFor(eventId: string): string {
  return `proc-ingest-${eventId}`;
}

function parseSteps(skillHint?: string, summary?: string): string[] {
  const raw = skillHint || summary || "";
  return raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)、]/.test(l) || l.length > 0)
    .map((l) => l.replace(/^\d+[.)、]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Pure ingest → Memory drafts. Caller embeds + upserts.
 * I0: session_summary / file_touch; I1a: decision / procedure_draft.
 */
export function applyIngestEvents(
  events: IngestEvent[],
  opts: ApplyIngestOptions,
): ApplyIngestResult {
  const maxSummary = opts.maxSummaryChars ?? 2000;
  const knownPaths = new Set(opts.existingWorkspacePaths ?? []);
  const seenEpisodeIds = new Set(opts.existingEpisodeIds);
  const seenSemanticIds = new Set(opts.existingSemanticIds ?? []);
  const seenProceduralIds = new Set(opts.existingProceduralIds ?? []);
  const episodes: ApplyIngestEpisodeDraft[] = [];
  const semantic: ApplyIngestSemanticDraft[] = [];
  const procedural: ApplyIngestProceduralDraft[] = [];
  const workspacePathsAdded: string[] = [];
  const skippedDuplicateIds: string[] = [];

  for (const raw of events) {
    const event = raw.scrubbed ? raw : scrubEvent(raw);
    if (event.kind === "raw_marker") {
      continue;
    }

    if (event.kind === "session_summary") {
      const id = episodeIdFor(event.eventId);
      if (seenEpisodeIds.has(id)) {
        skippedDuplicateIds.push(event.eventId);
        continue;
      }
      seenEpisodeIds.add(id);
      const now = new Date().toISOString();
      episodes.push({
        id,
        eventId: event.eventId,
        summary: event.summary.slice(0, maxSummary),
        source: event.source,
        nativeSessionId: event.nativeSessionId,
        timeRangeStart: event.tsStart ?? now,
        timeRangeEnd: event.tsEnd ?? now,
      });
      for (const p of event.paths) {
        if (p && !knownPaths.has(p)) {
          knownPaths.add(p);
          workspacePathsAdded.push(p);
        }
      }
      continue;
    }

    if (event.kind === "file_touch") {
      for (const p of event.paths) {
        if (p && !knownPaths.has(p)) {
          knownPaths.add(p);
          workspacePathsAdded.push(p);
        }
      }
      continue;
    }

    if (event.kind === "decision") {
      const id = semanticIdFor(event.eventId);
      if (seenSemanticIds.has(id)) {
        skippedDuplicateIds.push(event.eventId);
        continue;
      }
      seenSemanticIds.add(id);
      semantic.push({
        id,
        eventId: event.eventId,
        text: event.summary.slice(0, maxSummary),
        source: event.source,
        tags: ["ingest", "decision", event.source],
      });
      continue;
    }

    if (event.kind === "procedure_draft") {
      const id = proceduralIdFor(event.eventId);
      if (seenProceduralIds.has(id)) {
        skippedDuplicateIds.push(event.eventId);
        continue;
      }
      seenProceduralIds.add(id);
      const steps = parseSteps(event.skillHint, event.summary);
      procedural.push({
        id,
        eventId: event.eventId,
        text: (event.skillHint || event.summary).slice(0, maxSummary),
        steps: steps.length ? steps : [event.summary.slice(0, maxSummary)],
        source: event.source,
        skillId: event.nativeSessionId
          ? `skill-${event.source}-${event.nativeSessionId}`
          : `skill-${event.eventId}`,
      });
    }
  }

  return {
    episodes,
    semantic,
    procedural,
    workspacePathsAdded,
    skippedDuplicateIds,
  };
}
