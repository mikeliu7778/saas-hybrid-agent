import type { LlmMessage } from "../runtime/types.js";
import type { KvStore } from "./types.js";

export interface PersistedSessionRecord {
  id: string;
  maxIterations: number;
  systemPrompt: string;
  messages: LlmMessage[];
  workdir: string;
  toolNames?: string[];
  busy: boolean;
}

export class PersistedSessionStore {
  constructor(
    private readonly kv: KvStore,
    private readonly prefix = "sessions",
  ) {}

  private key(id: string): string {
    return `${this.prefix}/${id}.json`;
  }

  async save(session: PersistedSessionRecord): Promise<void> {
    await this.kv.setJson(this.key(session.id), session);
  }

  async load(id: string): Promise<PersistedSessionRecord | undefined> {
    return this.kv.getJson<PersistedSessionRecord>(this.key(id));
  }

  async listIds(): Promise<string[]> {
    const keys = await this.kv.list(this.prefix);
    return keys
      .map((k) => k.replace(/^sessions\//, "").replace(/\.json$/, ""))
      .filter(Boolean);
  }

  async delete(id: string): Promise<void> {
    await this.kv.delete(this.key(id));
  }
}
