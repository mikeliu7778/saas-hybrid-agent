import { BaseKvStore } from "./types.js";

export class MemoryKvStore extends BaseKvStore {
  private readonly map = new Map<string, string>();

  async getText(key: string): Promise<string | undefined> {
    return this.map.get(normalizeKey(key));
  }

  async setText(key: string, value: string): Promise<void> {
    this.map.set(normalizeKey(key), value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(normalizeKey(key));
  }

  async list(prefix = ""): Promise<string[]> {
    const p = normalizeKey(prefix).replace(/^\//, "");
    return [...this.map.keys()]
      .map((k) => k.replace(/^\//, ""))
      .filter((k) => {
        if (!p) return true;
        if (k === p) return true;
        const withSlash = p.endsWith("/") ? p : `${p}/`;
        return k.startsWith(withSlash) || k.startsWith(p);
      })
      .sort();
  }
}

function normalizeKey(key: string): string {
  return "/" + key.replace(/^\/+/, "");
}
