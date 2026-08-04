import { BaseKvStore } from "./types.js";
import type { OpfsDirectoryHandle } from "./memoryOpfsRoot.js";

/**
 * Key-value persistence on OPFS (or memory OPFS shim).
 * Keys like `sessions/s1.json` map to nested directories/files.
 */
export class OpfsKvStore extends BaseKvStore {
  private readonly root: OpfsDirectoryHandle;
  private readonly namespace: string;

  constructor(root: OpfsDirectoryHandle, namespace = "agent-data") {
    super();
    this.root = root;
    this.namespace = namespace;
  }

  private async ns(): Promise<OpfsDirectoryHandle> {
    return this.root.getDirectoryHandle(this.namespace, { create: true });
  }

  async getText(key: string): Promise<string | undefined> {
    try {
      const { dir, name } = await this.resolve(key, false);
      const fh = await dir.getFileHandle(name);
      const file = await fh.getFile();
      return await file.text();
    } catch {
      return undefined;
    }
  }

  async setText(key: string, value: string): Promise<void> {
    const { dir, name } = await this.resolve(key, true);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(value);
    await w.close();
  }

  async delete(key: string): Promise<void> {
    try {
      const { dir, name } = await this.resolve(key, false);
      await dir.removeEntry(name);
    } catch {
      /* missing ok */
    }
  }

  async list(prefix = ""): Promise<string[]> {
    const base = await this.ns();
    const out: string[] = [];
    await walk(base, "", out);
    const p = prefix.replace(/^\/+/, "");
    return out.filter((k) => !p || k === p || k.startsWith(p.endsWith("/") ? p : `${p}/`)).sort();
  }

  private async resolve(
    key: string,
    create: boolean,
  ): Promise<{ dir: OpfsDirectoryHandle; name: string }> {
    const parts = key.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length === 0) throw new Error("empty key");
    let dir = await this.ns();
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create });
    }
    return { dir, name: parts[parts.length - 1] };
  }
}

async function walk(dir: OpfsDirectoryHandle, prefix: string, out: string[]): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") out.push(path);
    else await walk(handle, path, out);
  }
}
