import type { MemoryBundle } from "../runtime/types.js";

/** Format a retrieve() bundle for system-prompt injection (I2). */
export function formatMemoryBundle(bundle: MemoryBundle): string[] {
  return [
    ...bundle.semantic.map((s) => `- fact: ${s.text}`),
    ...bundle.episode.map((e) => `- past: ${e.summary}`),
    ...bundle.procedural.map((p) => `- skill: ${p.text}`),
    ...bundle.workspaceHints.map((h) => `- workspace: ${h}`),
  ];
}

export function recalledIdsFromBundle(bundle: MemoryBundle): string[] {
  return [
    ...bundle.semantic.map((s) => s.id),
    ...bundle.episode.map((e) => e.id),
    ...bundle.procedural.map((p) => p.id),
  ];
}
