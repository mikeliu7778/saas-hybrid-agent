/**
 * I5b-A — chunk bodies live outside Sync mutations (control plane keeps hash manifests only).
 * Production may swap this for HTTP blob / peer fetch; tests use the in-memory map.
 */

export interface ChunkBackend {
  put(hash: string, content: string): void;
  get(hash: string): string | undefined;
  has(hash: string): boolean;
}

export class InMemoryChunkBackend implements ChunkBackend {
  readonly bodies = new Map<string, string>();

  put(hash: string, content: string): void {
    this.bodies.set(hash, content);
  }

  get(hash: string): string | undefined {
    return this.bodies.get(hash);
  }

  has(hash: string): boolean {
    return this.bodies.has(hash);
  }
}
