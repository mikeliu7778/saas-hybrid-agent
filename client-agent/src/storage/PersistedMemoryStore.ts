import {
  InMemoryMemoryStore,
  type EpisodeRow,
  type SemanticRow,
  type EmbedFn,
} from "../memory/InMemoryMemoryStore.js";
import type { TrustEvent } from "../trust/types.js";
import type { KvStore } from "./types.js";

/**
 * Memory store that snapshots semantic/episode rows to KvStore (OPFS or memory).
 */
export class PersistedMemoryStore extends InMemoryMemoryStore {
  constructor(
    private readonly kv: KvStore,
    opts?: {
      embed?: EmbedFn;
      deviceId?: string;
      retrieveBudgetMs?: number;
      maxRows?: number;
    },
  ) {
    super(opts);
  }

  async hydrate(): Promise<void> {
    const snap = await this.kv.getJson<{
      semantic: SemanticRow[];
      episode: EpisodeRow[];
      workspacePaths: string[];
    }>("memory/snapshot.json");
    if (!snap) return;
    this.semantic.clear();
    this.episode.clear();
    for (const row of snap.semantic ?? []) this.semantic.set(row.id, row);
    for (const row of snap.episode ?? []) this.episode.set(row.id, row);
    this.workspacePaths = snap.workspacePaths ?? [];
  }

  async flush(): Promise<void> {
    await this.kv.setJson("memory/snapshot.json", {
      semantic: [...this.semantic.values()],
      episode: [...this.episode.values()],
      workspacePaths: this.workspacePaths,
    });
  }

  override async commitTurn(turnTrace: {
    sessionId: string;
    turnId: string;
    userMessage: string;
    assistantText: string;
  }): Promise<void> {
    await super.commitTurn(turnTrace);
    await this.flush();
  }

  override upsertSemantic(row: SemanticRow): void {
    super.upsertSemantic(row);
    void this.flush();
  }

  override upsertEpisode(row: EpisodeRow): void {
    super.upsertEpisode(row);
    void this.flush();
  }

  override async applyTrust(event: TrustEvent): Promise<void> {
    await super.applyTrust(event);
    await this.flush();
  }

  override async deleteSemantic(id: string): Promise<void> {
    await super.deleteSemantic(id);
    await this.flush();
  }
}
