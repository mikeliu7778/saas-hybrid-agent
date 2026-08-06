import type {
  ApplyIngestStoreResult,
  EpisodeListItem,
  MemoryBundle,
  MemoryListItem,
  MemoryOrchestrator,
} from "../runtime/types.js";
import { applyIngestEvents } from "../ingest/applyIngest.js";
import { withDerivedIngestEvents } from "../ingest/deriveFromSummary.js";
import type { IngestEvent } from "../ingest/types.js";
import { applyTrustToSemantic } from "../trust/applyTrust.js";
import type { TrustEvent } from "../trust/types.js";

export interface SemanticRow {
  id: string;
  text: string;
  embedding: number[];
  tags: string[];
  updatedAt: string;
  deviceId: string;
  version: number;
  tombstone?: boolean;
  trustScore?: number;
  confidence?: number;
  lastTrustedAt?: string;
  sourceTurnId?: string;
  deprecated?: boolean;
  supersededBy?: string;
}

export interface EpisodeRow {
  id: string;
  summary: string;
  embedding: number[];
  timeRangeStart: string;
  timeRangeEnd: string;
  messageRefs: string[];
  updatedAt: string;
  deviceId: string;
  version: number;
  tombstone?: boolean;
  /** Ingest source tool, e.g. cursor */
  source?: string;
  nativeSessionId?: string;
}

export interface ProceduralRow {
  id: string;
  skillId: string;
  text: string;
  steps: string[];
  embedding: number[];
  updatedAt: string;
  deviceId: string;
  version: number;
  tombstone?: boolean;
  source?: string;
}

export type EmbedFn = (text: string) => Promise<{ embedding: number[]; modelId: string }>;

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Deterministic bag-of-char embedding for tests / offline fallback. */
export function hashEmbed(text: string, dims = 32): number[] {
  const v = new Array(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    v[i % dims] += text.charCodeAt(i) / 255;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export class InMemoryMemoryStore implements MemoryOrchestrator {
  readonly semantic = new Map<string, SemanticRow>();
  readonly episode = new Map<string, EpisodeRow>();
  readonly procedural = new Map<string, ProceduralRow>();
  workspacePaths: string[] = [];
  private readonly embed: EmbedFn;
  private readonly deviceId: string;
  private readonly retrieveBudgetMs: number;
  private readonly maxRows: number;

  constructor(opts?: {
    embed?: EmbedFn;
    deviceId?: string;
    retrieveBudgetMs?: number;
    maxRows?: number;
  }) {
    this.embed = opts?.embed ?? (async (t) => ({ embedding: hashEmbed(t), modelId: "hash-32" }));
    this.deviceId = opts?.deviceId ?? "local";
    this.retrieveBudgetMs = opts?.retrieveBudgetMs ?? 200;
    this.maxRows = opts?.maxRows ?? 100_000;
  }

  async retrieve(query: string): Promise<MemoryBundle> {
    const started = Date.now();
    const { embedding } = await this.embed(query);

    const sem = [...this.semantic.values()]
      .filter((r) => !r.tombstone && !r.deprecated)
      .map((r) => ({
        id: r.id,
        text: r.text,
        score: cosine(embedding, r.embedding) * (0.5 + 0.5 * (r.trustScore ?? 0.5)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Date.now() - started > this.retrieveBudgetMs ? 2 : 8);

    const now = Date.now();
    const epi = [...this.episode.values()]
      .filter((r) => !r.tombstone)
      .map((r) => {
        const ageDays = Math.max(0, (now - Date.parse(r.updatedAt)) / 86_400_000);
        const decay = Math.exp(-ageDays / 30);
        return {
          id: r.id,
          summary: r.summary,
          score: cosine(embedding, r.embedding) * decay,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    const proc = [...this.procedural.values()]
      .filter((r) => !r.tombstone)
      .map((r) => ({
        id: r.id,
        text: r.text,
        score: cosine(embedding, r.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Date.now() - started > this.retrieveBudgetMs ? 1 : 4);

    const q = query.toLowerCase();
    const workspaceHints = this.workspacePaths
      .filter((p) => p.toLowerCase().includes(q) || q.split(/\s+/).some((w) => w.length > 2 && p.toLowerCase().includes(w)))
      .slice(0, 5);

    return { semantic: sem, episode: epi, procedural: proc, workspaceHints };
  }

  async commitTurn(turnTrace: {
    sessionId: string;
    turnId: string;
    userMessage: string;
    assistantText: string;
    imageCount?: number;
  }): Promise<void> {
    // Simple rule extract: "我喜欢/我偏好/I prefer" → semantic
    const pref = turnTrace.userMessage.match(/(?:我喜欢|我偏好|I prefer)\s*(.+)/i);
    if (pref && this.semantic.size < this.maxRows) {
      const text = pref[1].trim();
      const { embedding, modelId } = await this.embed(text);
      const id = `sem-${crypto.randomUUID()}`;
      this.semantic.set(id, {
        id,
        text,
        embedding,
        tags: ["preference"],
        updatedAt: new Date().toISOString(),
        deviceId: this.deviceId,
        version: 1,
      });
      void modelId;
    }

    if (this.episode.size < this.maxRows && turnTrace.assistantText) {
      const imageNote =
        turnTrace.imageCount && turnTrace.imageCount > 0
          ? ` [${turnTrace.imageCount} images]`
          : "";
      const summary = `${turnTrace.userMessage.slice(0, 80)}${imageNote} → ${turnTrace.assistantText.slice(0, 80)}`;
      const { embedding } = await this.embed(summary);
      const id = `epi-${turnTrace.turnId}`;
      const now = new Date().toISOString();
      this.episode.set(id, {
        id,
        summary,
        embedding,
        timeRangeStart: now,
        timeRangeEnd: now,
        messageRefs: [],
        updatedAt: now,
        deviceId: this.deviceId,
        version: 1,
      });
    }
  }

  upsertSemantic(row: SemanticRow): void {
    this.semantic.set(row.id, row);
  }

  upsertEpisode(row: EpisodeRow): void {
    this.episode.set(row.id, row);
  }

  upsertProcedural(row: ProceduralRow): void {
    this.procedural.set(row.id, row);
  }

  /** List non-tombstone semantic rows (includes deprecated for UI). */
  async listSemantic(): Promise<MemoryListItem[]> {
    return [...this.semantic.values()]
      .filter((r) => !r.tombstone)
      .map((r) => ({
        id: r.id,
        text: r.text,
        trustScore: r.trustScore,
        deprecated: r.deprecated,
      }));
  }

  /** Mark a semantic row deprecated (soft-delete / tombstone path). */
  async deleteSemantic(id: string): Promise<void> {
    const row = this.semantic.get(id);
    if (!row || row.tombstone) return;
    this.semantic.set(id, {
      ...row,
      deprecated: true,
      version: row.version + 1,
      updatedAt: new Date().toISOString(),
    });
  }

  async applyTrust(event: TrustEvent): Promise<void> {
    if (event.target !== "memory_item") return;
    const row = this.semantic.get(event.targetId);
    if (!row) return;
    this.semantic.set(event.targetId, applyTrustToSemantic(row, event));
  }

  async applyIngest(events: IngestEvent[]): Promise<ApplyIngestStoreResult> {
    const expanded = withDerivedIngestEvents(events);
    const draft = applyIngestEvents(expanded, {
      existingEpisodeIds: new Set(this.episode.keys()),
      existingSemanticIds: new Set(this.semantic.keys()),
      existingProceduralIds: new Set(this.procedural.keys()),
      existingWorkspacePaths: this.workspacePaths,
    });

    for (const epi of draft.episodes) {
      if (this.episode.size >= this.maxRows) break;
      const { embedding } = await this.embed(epi.summary);
      const now = new Date().toISOString();
      this.episode.set(epi.id, {
        id: epi.id,
        summary: epi.summary,
        embedding,
        timeRangeStart: epi.timeRangeStart,
        timeRangeEnd: epi.timeRangeEnd,
        messageRefs: [],
        updatedAt: now,
        deviceId: this.deviceId,
        version: 1,
        source: epi.source,
        nativeSessionId: epi.nativeSessionId,
      });
    }

    for (const sem of draft.semantic) {
      if (this.semantic.size >= this.maxRows) break;
      const { embedding } = await this.embed(sem.text);
      const now = new Date().toISOString();
      this.semantic.set(sem.id, {
        id: sem.id,
        text: sem.text,
        embedding,
        tags: sem.tags,
        updatedAt: now,
        deviceId: this.deviceId,
        version: 1,
        trustScore: 0.55,
        confidence: 0.55,
      });
    }

    for (const proc of draft.procedural) {
      if (this.procedural.size >= this.maxRows) break;
      const { embedding } = await this.embed(proc.text);
      const now = new Date().toISOString();
      this.procedural.set(proc.id, {
        id: proc.id,
        skillId: proc.skillId,
        text: proc.text,
        steps: proc.steps,
        embedding,
        updatedAt: now,
        deviceId: this.deviceId,
        version: 1,
        source: proc.source,
      });
    }

    for (const p of draft.workspacePathsAdded) {
      if (!this.workspacePaths.includes(p)) this.workspacePaths.push(p);
    }

    return {
      accepted: draft.episodes.length,
      duplicates: draft.skippedDuplicateIds.length,
      workspacePathsAdded: draft.workspacePathsAdded.length,
      semanticAccepted: draft.semantic.length,
      proceduralAccepted: draft.procedural.length,
    };
  }

  async listEpisode(): Promise<EpisodeListItem[]> {
    return [...this.episode.values()]
      .filter((r) => !r.tombstone)
      .map((r) => ({
        id: r.id,
        summary: r.summary,
        source: r.source,
        updatedAt: r.updatedAt,
      }));
  }

  async listWorkspacePaths(): Promise<string[]> {
    return [...this.workspacePaths];
  }
}
