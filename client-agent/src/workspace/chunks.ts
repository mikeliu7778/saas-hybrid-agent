/**
 * I5a — large workspace file chunking by content hash.
 * Chunks stay on-device; sync can later ship hashes + pull missing chunks on demand.
 */

export interface TextChunk {
  index: number;
  hash: string;
  content: string;
}

export interface ChunkedFileMeta {
  path: string;
  contentHash: string;
  chunkCount: number;
  chunkHashes: string[];
  updatedAt: string;
  byteLength: number;
}

export interface ChunkTextOptions {
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 4_000;

/** Prefer Web Crypto; fall back to FNV-1a for non-crypto environments. */
export async function contentHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export async function chunkText(
  text: string,
  opts?: ChunkTextOptions,
): Promise<TextChunk[]> {
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;
  if (text.length === 0) {
    return [{ index: 0, hash: await contentHash(""), content: "" }];
  }
  const chunks: TextChunk[] = [];
  for (let i = 0, index = 0; i < text.length; i += maxChars, index++) {
    const content = text.slice(i, i + maxChars);
    chunks.push({
      index,
      hash: await contentHash(content),
      content,
    });
  }
  return chunks;
}

/**
 * Local chunk index: path → meta, hash → chunk body.
 * `getChunk` supports on-demand pull by hash (sync peer later).
 */
export class WorkspaceChunkStore {
  private readonly maxChars: number;
  readonly files = new Map<string, ChunkedFileMeta>();
  readonly chunks = new Map<string, TextChunk>();

  constructor(opts?: { maxChars?: number }) {
    this.maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;
  }

  async putFile(path: string, content: string): Promise<ChunkedFileMeta> {
    const parts = await chunkText(content, { maxChars: this.maxChars });
    for (const part of parts) {
      this.chunks.set(part.hash, part);
    }
    const meta: ChunkedFileMeta = {
      path,
      contentHash: await contentHash(content),
      chunkCount: parts.length,
      chunkHashes: parts.map((p) => p.hash),
      updatedAt: new Date().toISOString(),
      byteLength: new TextEncoder().encode(content).byteLength,
    };
    this.files.set(path, meta);
    return meta;
  }

  getMeta(path: string): ChunkedFileMeta | undefined {
    return this.files.get(path);
  }

  getChunk(hash: string): TextChunk | undefined {
    return this.chunks.get(hash);
  }

  /** Apply Sync manifest without bodies (I5b-A). */
  applyManifest(meta: ChunkedFileMeta): void {
    this.files.set(meta.path, { ...meta, chunkHashes: [...meta.chunkHashes] });
  }

  putChunkBody(hash: string, content: string, index = 0): void {
    this.chunks.set(hash, { index, hash, content });
  }

  /** Hashes listed in meta but missing locally. */
  missingHashes(path: string): string[] {
    const meta = this.files.get(path);
    if (!meta) return [];
    return meta.chunkHashes.filter((h) => !this.chunks.has(h));
  }

  /** Reconstruct file from local chunks; returns undefined if any chunk missing. */
  async readFile(path: string): Promise<string | undefined> {
    const meta = this.files.get(path);
    if (!meta) return undefined;
    const parts: string[] = [];
    for (const hash of meta.chunkHashes) {
      const chunk = this.chunks.get(hash);
      if (!chunk) return undefined;
      parts.push(chunk.content);
    }
    return parts.join("");
  }

  /** List paths that have chunk metadata (for sync manifests). */
  listPaths(): string[] {
    return [...this.files.keys()].sort();
  }

  /** Drop chunk bodies not referenced by any file (GC after sync). */
  gcUnreferenced(): number {
    const live = new Set<string>();
    for (const meta of this.files.values()) {
      for (const h of meta.chunkHashes) live.add(h);
    }
    let removed = 0;
    for (const hash of [...this.chunks.keys()]) {
      if (!live.has(hash)) {
        this.chunks.delete(hash);
        removed++;
      }
    }
    return removed;
  }
}
