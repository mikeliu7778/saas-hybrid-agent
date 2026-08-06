import type {
  EpisodeRow,
  InMemoryMemoryStore,
  ProceduralRow,
  SemanticRow,
} from "./InMemoryMemoryStore.js";
import { rerankMemoryHits } from "./localSummarizer.js";

export interface MemoryPackV1 {
  schemaVersion: "1";
  semantic: SemanticRow[];
  episode: EpisodeRow[];
  procedural: ProceduralRow[];
  workspacePaths: string[];
}

export interface MemoryHit {
  id: string;
  kind: "semantic" | "episode" | "procedural" | "workspace";
  text: string;
  score: number;
  source?: string;
}

export interface MemoryRecord {
  id: string;
  kind: "semantic" | "episode" | "procedural";
  text: string;
  source?: string;
  trustScore?: number;
  deprecated?: boolean;
  steps?: string[];
  tags?: string[];
}

export function encodeMemoryPack(store: InMemoryMemoryStore): Uint8Array {
  const pack: MemoryPackV1 = {
    schemaVersion: "1",
    semantic: [...store.semantic.values()],
    episode: [...store.episode.values()],
    procedural: [...store.procedural.values()],
    workspacePaths: [...store.workspacePaths],
  };
  return new TextEncoder().encode(JSON.stringify(pack, null, 2));
}

export function decodeMemoryPack(
  store: InMemoryMemoryStore,
  data: Uint8Array,
): void {
  const raw = new TextDecoder().decode(data);
  const pack = JSON.parse(raw) as MemoryPackV1;
  if (pack.schemaVersion !== "1") {
    throw new Error(`Unsupported memory pack schemaVersion: ${pack.schemaVersion}`);
  }
  store.semantic.clear();
  store.episode.clear();
  store.procedural.clear();
  for (const row of pack.semantic ?? []) store.semantic.set(row.id, row);
  for (const row of pack.episode ?? []) store.episode.set(row.id, row);
  for (const row of pack.procedural ?? []) store.procedural.set(row.id, row);
  store.workspacePaths = [...(pack.workspacePaths ?? [])];
}

/** Read-only search over local Memory (MCP memory_search). */
export async function memorySearch(
  store: InMemoryMemoryStore,
  query: string,
  limit = 8,
): Promise<MemoryHit[]> {
  const bundle = await store.retrieve(query);
  const hits: MemoryHit[] = [
    ...bundle.semantic.map((s) => ({
      id: s.id,
      kind: "semantic" as const,
      text: s.text,
      score: s.score,
    })),
    ...bundle.episode.map((e) => ({
      id: e.id,
      kind: "episode" as const,
      text: e.summary,
      score: e.score,
      source: store.episode.get(e.id)?.source,
    })),
    ...bundle.procedural.map((p) => ({
      id: p.id,
      kind: "procedural" as const,
      text: p.text,
      score: p.score,
      source: store.procedural.get(p.id)?.source,
    })),
    ...bundle.workspaceHints.map((h, i) => ({
      id: `ws-${i}:${h}`,
      kind: "workspace" as const,
      text: h,
      score: 0.3,
    })),
  ];
  return rerankMemoryHits(hits, query).slice(0, limit);
}

/** Read-only get by id (MCP memory_get). */
export async function memoryGet(
  store: InMemoryMemoryStore,
  id: string,
): Promise<MemoryRecord | null> {
  const sem = store.semantic.get(id);
  if (sem && !sem.tombstone) {
    return {
      id: sem.id,
      kind: "semantic",
      text: sem.text,
      trustScore: sem.trustScore,
      deprecated: sem.deprecated,
      tags: sem.tags,
    };
  }
  const epi = store.episode.get(id);
  if (epi && !epi.tombstone) {
    return {
      id: epi.id,
      kind: "episode",
      text: epi.summary,
      source: epi.source,
      trustScore: epi.trustScore,
      deprecated: epi.deprecated,
    };
  }
  const proc = store.procedural.get(id);
  if (proc && !proc.tombstone) {
    return {
      id: proc.id,
      kind: "procedural",
      text: proc.text,
      source: proc.source,
      trustScore: proc.trustScore,
      deprecated: proc.deprecated,
      steps: proc.steps,
    };
  }
  return null;
}
