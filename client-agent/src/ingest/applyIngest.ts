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

export interface ApplyIngestResult {
  episodes: ApplyIngestEpisodeDraft[];
  workspacePathsAdded: string[];
  skippedDuplicateIds: string[];
}

export interface ApplyIngestOptions {
  existingEpisodeIds: Set<string>;
  existingWorkspacePaths?: Iterable<string>;
  /** Max summary length after scrub (default 2000). */
  maxSummaryChars?: number;
}

function episodeIdFor(eventId: string): string {
  return `epi-ingest-${eventId}`;
}

/**
 * Pure ingest → Memory drafts. Caller embeds + upserts.
 * Only session_summary and file_touch are applied in I0.
 */
export function applyIngestEvents(
  events: IngestEvent[],
  opts: ApplyIngestOptions,
): ApplyIngestResult {
  const maxSummary = opts.maxSummaryChars ?? 2000;
  const knownPaths = new Set(opts.existingWorkspacePaths ?? []);
  const seenEpisodeIds = new Set(opts.existingEpisodeIds);
  const episodes: ApplyIngestEpisodeDraft[] = [];
  const workspacePathsAdded: string[] = [];
  const skippedDuplicateIds: string[] = [];

  for (const raw of events) {
    const event = raw.scrubbed ? raw : scrubEvent(raw);
    if (event.kind === "raw_marker" || event.kind === "decision" || event.kind === "procedure_draft") {
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
    }
  }

  return { episodes, workspacePathsAdded, skippedDuplicateIds };
}
