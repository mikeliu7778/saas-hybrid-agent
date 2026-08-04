import type { MemoryBundle, MemoryOrchestrator } from "../runtime/types.js";

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
      .filter((r) => !r.tombstone)
      .map((r) => ({ id: r.id, text: r.text, score: cosine(embedding, r.embedding) }))
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

    const q = query.toLowerCase();
    const workspaceHints = this.workspacePaths
      .filter((p) => p.toLowerCase().includes(q) || q.split(/\s+/).some((w) => w.length > 2 && p.toLowerCase().includes(w)))
      .slice(0, 5);

    return { semantic: sem, episode: epi, procedural: [], workspaceHints };
  }

  async commitTurn(turnTrace: {
    sessionId: string;
    turnId: string;
    userMessage: string;
    assistantText: string;
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
      const summary = `${turnTrace.userMessage.slice(0, 80)} → ${turnTrace.assistantText.slice(0, 80)}`;
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
}
