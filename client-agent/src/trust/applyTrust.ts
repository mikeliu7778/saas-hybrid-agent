import type {
  EpisodeRow,
  ProceduralRow,
  SemanticRow,
} from "../memory/InMemoryMemoryStore.js";
import type { TrustEvent } from "./types.js";

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export interface TrustableMemoryFields {
  id: string;
  trustScore?: number;
  confidence?: number;
  deprecated?: boolean;
  lastTrustedAt?: string;
  supersededBy?: string;
  version: number;
  updatedAt: string;
}

/** Shared trust/distrust/correct update for any memory row shape. */
export function applyTrustFields<T extends TrustableMemoryFields>(
  row: T,
  event: TrustEvent,
): T {
  if (event.target !== "memory_item" || event.targetId !== row.id) return row;
  const delta = event.strength * 0.25;
  let trustScore = row.trustScore ?? 0.5;
  let confidence = row.confidence ?? 0.5;
  let deprecated = row.deprecated ?? false;
  let lastTrustedAt = row.lastTrustedAt;
  let supersededBy = row.supersededBy;

  if (event.signal === "trust") {
    trustScore = clamp(trustScore + delta);
    confidence = clamp(confidence + delta * 0.5);
    lastTrustedAt = event.ts;
  } else if (event.signal === "distrust") {
    trustScore = clamp(trustScore - delta);
    confidence = clamp(confidence - delta * 0.5);
    if (event.strength >= 0.8 || trustScore < 0.15) deprecated = true;
  } else if (event.signal === "correct") {
    trustScore = clamp(trustScore - delta);
    deprecated = true;
    const sid = event.payload?.supersededBy;
    if (typeof sid === "string") supersededBy = sid;
  }

  return {
    ...row,
    trustScore,
    confidence,
    deprecated,
    lastTrustedAt,
    supersededBy,
    version: row.version + 1,
    updatedAt: event.ts,
  };
}

/** Pure update for a semantic memory row. */
export function applyTrustToSemantic(
  row: SemanticRow,
  event: TrustEvent,
): SemanticRow {
  return applyTrustFields(row, event);
}

/** Pure update for an episode memory row (I3). */
export function applyTrustToEpisode(
  row: EpisodeRow,
  event: TrustEvent,
): EpisodeRow {
  return applyTrustFields(row, event);
}

/** Pure update for a procedural memory row (I3). */
export function applyTrustToProcedural(
  row: ProceduralRow,
  event: TrustEvent,
): ProceduralRow {
  return applyTrustFields(row, event);
}
