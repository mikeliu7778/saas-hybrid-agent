import type { MemoryHit } from "./memoryPack.js";

export interface SessionSummaryInput {
  userMessage: string;
  assistantText: string;
  maxChars?: number;
}

/**
 * On-device session summary without a cloud LLM (I5a).
 * Cheap extractive compression for hybrid ingest / offline paths.
 */
export function localSessionSummary(input: SessionSummaryInput): string {
  const maxChars = input.maxChars ?? 240;
  const user = collapseWs(input.userMessage).slice(0, 100);
  const assistant = collapseWs(input.assistantText).slice(0, 120);
  const joined = user
    ? `${user} → ${assistant || "(no reply)"}`
    : assistant || "(empty)";
  return joined.slice(0, maxChars);
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function tokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter((t) => t.length > 1);
}

/**
 * Re-rank retrieve hits with lightweight lexical overlap (no cloud model).
 * Preserves base semantic score as primary signal.
 */
export function rerankMemoryHits(
  hits: MemoryHit[],
  query: string,
): MemoryHit[] {
  const qTokens = tokens(query);
  if (qTokens.length === 0) return [...hits].sort((a, b) => b.score - a.score);

  return hits
    .map((h) => {
      const text = h.text.toLowerCase();
      let overlap = 0;
      for (const t of qTokens) {
        if (text.includes(t)) overlap += 1;
      }
      const lexical = overlap / qTokens.length;
      return {
        ...h,
        score: h.score * 0.7 + lexical * 0.3,
      };
    })
    .sort((a, b) => b.score - a.score);
}
