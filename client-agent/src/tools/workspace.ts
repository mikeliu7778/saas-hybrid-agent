import type { OpfsDirectoryHandle } from "../storage/memoryOpfsRoot.js";

/** Async workspace filesystem — Memory (tests) or OPFS (browser). */
export interface WorkspaceFs {
  write(path: string, content: string): Promise<void>;
  read(path: string): Promise<string | undefined>;
  list(dir?: string): Promise<string[]>;
}

export function normalizeWorkspacePath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "..") {
      if (stack.length === 0) throw new Error("path escapes sandbox");
      stack.pop();
    } else {
      stack.push(p);
    }
  }
  return "/" + stack.join("/");
}

export class MemoryWorkspace implements WorkspaceFs {
  private readonly files = new Map<string, string>();

  async write(path: string, content: string): Promise<void> {
    this.files.set(normalizeWorkspacePath(path), content);
  }

  async read(path: string): Promise<string | undefined> {
    return this.files.get(normalizeWorkspacePath(path));
  }

  async list(dir = "/"): Promise<string[]> {
    const prefix = normalizeWorkspacePath(dir).replace(/\/?$/, "/");
    const names = new Set<string>();
    for (const p of this.files.keys()) {
      if (prefix === "//" || p.startsWith(prefix) || (prefix === "/" && p.startsWith("/"))) {
        const rest = prefix === "/" ? p.replace(/^\//, "") : p.slice(prefix.length);
        if (!rest) continue;
        const part = rest.split("/")[0];
        if (part) names.add(part);
      }
    }
    return [...names].sort();
  }
}

export class OpfsWorkspace implements WorkspaceFs {
  constructor(
    private readonly root: OpfsDirectoryHandle,
    private readonly workspaceDir = "workspace",
  ) {}

  private async base(): Promise<OpfsDirectoryHandle> {
    return this.root.getDirectoryHandle(this.workspaceDir, { create: true });
  }

  async read(path: string): Promise<string | undefined> {
    const normalized = normalizeWorkspacePath(path);
    try {
      const { dir, name } = await this.resolveNormalized(normalized, false);
      const fh = await dir.getFileHandle(name);
      return await (await fh.getFile()).text();
    } catch (e) {
      if (e instanceof Error && e.message.includes("escapes")) throw e;
      return undefined;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path);
    const { dir, name } = await this.resolveNormalized(normalized, true);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }

  async list(dirPath = "/"): Promise<string[]> {
    const normalized = normalizeWorkspacePath(dirPath);
    let dir = await this.base();
    const parts = normalized.replace(/^\//, "").split("/").filter(Boolean);
    for (const p of parts) {
      dir = await dir.getDirectoryHandle(p);
    }
    const names: string[] = [];
    for await (const name of dir.keys()) names.push(name);
    return names.sort();
  }

  private async resolveNormalized(
    normalized: string,
    create: boolean,
  ): Promise<{ dir: OpfsDirectoryHandle; name: string }> {
    const parts = normalized.replace(/^\//, "").split("/").filter(Boolean);
    if (parts.length === 0) throw new Error("invalid path");
    let dir = await this.base();
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create });
    }
    return { dir, name: parts[parts.length - 1] };
  }
}
