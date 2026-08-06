/**
 * I5b-D — pluggable on-device intelligence for summary + rerank.
 * Default remains rule-based (I5a). Tiny backends swap in without cloud LLM.
 * Real onnx/wasm weights load via {@link loadWasmTinyModelBackend} when provided.
 */

import type { MemoryHit } from "./memoryPack.js";
import {
  localSessionSummary,
  rerankMemoryHits,
  type SessionSummaryInput,
} from "./localSummarizer.js";
import { cosine, hashEmbed } from "./InMemoryMemoryStore.js";

export interface TinyModelBackend {
  /** Stable id, e.g. `hash-32`, `wasm:custom`, `onnx:minilm`. */
  readonly id: string;
  embed(text: string): Promise<number[]>;
}

export interface OnDeviceIntelligence {
  readonly kind: "rules" | "tiny";
  readonly modelId?: string;
  summarizeSession(input: SessionSummaryInput): Promise<string>;
  rerankHits(hits: MemoryHit[], query: string): Promise<MemoryHit[]>;
}

/** Zero-dep stand-in for a tiny embedding model (CI / default tiny path). */
export class HashTinyModelBackend implements TinyModelBackend {
  readonly id: string;
  private readonly dims: number;

  constructor(opts?: { dims?: number; id?: string }) {
    this.dims = opts?.dims ?? 32;
    this.id = opts?.id ?? `hash-${this.dims}`;
  }

  async embed(text: string): Promise<number[]> {
    return hashEmbed(text, this.dims);
  }
}

export interface WasmTinyModelOptions {
  /** Absolute or package path that default-exports TinyModelBackend. */
  moduleUrl: string;
  /** Optional factory export name (default: `createTinyModelBackend`). */
  exportName?: string;
  initArgs?: unknown;
}

/**
 * Dynamic-import loader for onnx/wasm backends shipped by the host app.
 * Does not bundle model weights in client-agent.
 */
export async function loadWasmTinyModelBackend(
  opts: WasmTinyModelOptions,
): Promise<TinyModelBackend> {
  const mod = (await import(/* @vite-ignore */ opts.moduleUrl)) as Record<
    string,
    unknown
  >;
  const name = opts.exportName ?? "createTinyModelBackend";
  const factory = mod[name] ?? mod.default;
  if (typeof factory !== "function") {
    throw new Error(
      `loadWasmTinyModelBackend: ${opts.moduleUrl} missing ${name}()`,
    );
  }
  const backend = await (factory as (a?: unknown) => Promise<TinyModelBackend> | TinyModelBackend)(
    opts.initArgs,
  );
  if (!backend?.id || typeof backend.embed !== "function") {
    throw new Error("loadWasmTinyModelBackend: invalid TinyModelBackend");
  }
  return backend;
}

export function createRulesOnDeviceIntelligence(): OnDeviceIntelligence {
  return {
    kind: "rules",
    async summarizeSession(input) {
      return localSessionSummary(input);
    },
    async rerankHits(hits, query) {
      return rerankMemoryHits(hits, query);
    },
  };
}

/**
 * Tiny-model path: extractive summary via embedding centroid + cosine rerank blend.
 */
export function createTinyOnDeviceIntelligence(
  backend: TinyModelBackend,
): OnDeviceIntelligence {
  return {
    kind: "tiny",
    modelId: backend.id,
    async summarizeSession(input) {
      const maxChars = input.maxChars ?? 240;
      const sentences = splitSentences(
        `${input.userMessage}\n${input.assistantText}`,
      );
      if (sentences.length === 0) return localSessionSummary(input);
      if (sentences.length === 1) {
        return sentences[0]!.slice(0, maxChars);
      }
      const embs = await Promise.all(sentences.map((s) => backend.embed(s)));
      const centroid = average(embs);
      const ranked = sentences
        .map((s, i) => ({ s, score: cosine(embs[i]!, centroid) }))
        .sort((a, b) => b.score - a.score);
      const picked = [ranked[0]!.s];
      if (ranked[1] && picked[0]!.length < maxChars * 0.6) {
        picked.push(ranked[1].s);
      }
      return picked.join(" → ").slice(0, maxChars);
    },
    async rerankHits(hits, query) {
      if (hits.length === 0) return [];
      const qEmb = await backend.embed(query);
      const scored = await Promise.all(
        hits.map(async (h) => {
          const emb = await backend.embed(h.text);
          const modelScore = cosine(qEmb, emb);
          return {
            ...h,
            score: h.score * 0.55 + modelScore * 0.45,
          };
        }),
      );
      return scored.sort((a, b) => b.score - a.score);
    },
  };
}

export type CreateOnDeviceOptions =
  | { mode?: "rules" }
  | { mode: "tiny"; backend?: TinyModelBackend };

export function createOnDeviceIntelligence(
  opts?: CreateOnDeviceOptions,
): OnDeviceIntelligence {
  if (opts?.mode === "tiny") {
    return createTinyOnDeviceIntelligence(
      opts.backend ?? new HashTinyModelBackend(),
    );
  }
  return createRulesOnDeviceIntelligence();
}

let defaultIntel: OnDeviceIntelligence = createRulesOnDeviceIntelligence();

export function getDefaultOnDeviceIntelligence(): OnDeviceIntelligence {
  return defaultIntel;
}

export function setDefaultOnDeviceIntelligence(
  intel: OnDeviceIntelligence,
): void {
  defaultIntel = intel;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。.!?？\n])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 8);
}

function average(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0]!.length;
  const out = new Array(dims).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) out[i] += v[i] ?? 0;
  }
  for (let i = 0; i < dims; i++) out[i]! /= vectors.length;
  return out;
}
