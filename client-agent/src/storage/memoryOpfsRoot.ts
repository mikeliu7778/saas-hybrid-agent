/**
 * Minimal in-memory OPFS-like directory tree for Node unit tests.
 * Browser uses navigator.storage.getDirectory() instead.
 */

export interface OpfsFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string | Uint8Array): Promise<void>;
    close(): Promise<void>;
  }>;
}

export interface OpfsDirectoryHandle {
  kind: "directory";
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<OpfsDirectoryHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, OpfsFileHandle | OpfsDirectoryHandle]>;
  keys(): AsyncIterableIterator<string>;
}

class MemFile implements OpfsFileHandle {
  kind = "file" as const;
  content = "";
  constructor(public name: string) {}

  async getFile(): Promise<File> {
    return new File([this.content], this.name);
  }

  async createWritable() {
    const self = this;
    return {
      async write(data: string | Uint8Array) {
        self.content = typeof data === "string" ? data : new TextDecoder().decode(data);
      },
      async close() {
        /* no-op */
      },
    };
  }
}

class MemDir implements OpfsDirectoryHandle {
  kind = "directory" as const;
  readonly children = new Map<string, MemFile | MemDir>();
  constructor(public name: string) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<OpfsDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing?.kind === "directory") return existing;
    if (existing) throw new Error(`Not a directory: ${name}`);
    if (!opts?.create) throw new Error(`Directory not found: ${name}`);
    const dir = new MemDir(name);
    this.children.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<OpfsFileHandle> {
    const existing = this.children.get(name);
    if (existing?.kind === "file") return existing;
    if (existing) throw new Error(`Not a file: ${name}`);
    if (!opts?.create) throw new Error(`File not found: ${name}`);
    const file = new MemFile(name);
    this.children.set(name, file);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    this.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, OpfsFileHandle | OpfsDirectoryHandle]> {
    for (const [k, v] of this.children) yield [k, v];
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const k of this.children.keys()) yield k;
  }
}

export function createMemoryOpfsRoot(): OpfsDirectoryHandle {
  return new MemDir("");
}

/** Browser helper — returns OPFS root (cast to our handle interface). */
export async function getBrowserOpfsRoot(): Promise<OpfsDirectoryHandle> {
  const nav = globalThis.navigator as
    | { storage?: { getDirectory?: () => Promise<OpfsDirectoryHandle> } }
    | undefined;
  if (!nav?.storage?.getDirectory) {
    throw new Error("OPFS is not available in this environment");
  }
  return await nav.storage.getDirectory();
}
