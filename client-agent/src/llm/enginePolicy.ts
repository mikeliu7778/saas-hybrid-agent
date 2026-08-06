/**
 * I2 engine policy: sidecar providers own their tool loop — Hybrid must not
 * send client ToolHost schemas (avoids dual tool rings).
 */
export type LlmEngine = "openai" | "cursor" | "claude_code" | "codex" | string;

const SIDECAR_ENGINES = new Set(["cursor", "claude_code", "codex"]);

export function isSidecarEngine(engine: string | undefined | null): boolean {
  if (!engine) return false;
  return SIDECAR_ENGINES.has(engine.trim().toLowerCase());
}

/** Engines that keep the on-device Hybrid ToolHost loop. */
export function engineAllowsClientTools(engine: string | undefined | null): boolean {
  return !isSidecarEngine(engine);
}
