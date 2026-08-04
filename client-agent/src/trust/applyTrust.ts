import type { SemanticRow } from "../memory/InMemoryMemoryStore.js";
import type { TrustEvent } from "./types.js";

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Pure update for a semantic memory row. Ignores events for other targets/ids. */
export function applyTrustToSemantic(
  row: SemanticRow,
  event: TrustEvent,
): SemanticRow {
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
