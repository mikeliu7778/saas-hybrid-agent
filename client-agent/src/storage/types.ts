export interface KvStore {
  getText(key: string): Promise<string | undefined>;
  setText(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  getJson<T>(key: string): Promise<T | undefined>;
  setJson(key: string, value: unknown): Promise<void>;
}

export abstract class BaseKvStore implements KvStore {
  abstract getText(key: string): Promise<string | undefined>;
  abstract setText(key: string, value: string): Promise<void>;
  abstract delete(key: string): Promise<void>;
  abstract list(prefix?: string): Promise<string[]>;

  async getJson<T>(key: string): Promise<T | undefined> {
    const text = await this.getText(key);
    if (text === undefined) return undefined;
    return JSON.parse(text) as T;
  }

  async setJson(key: string, value: unknown): Promise<void> {
    await this.setText(key, JSON.stringify(value));
  }
}
