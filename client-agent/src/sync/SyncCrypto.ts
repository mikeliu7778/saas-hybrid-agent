/**
 * I4b — optional E2E Sync envelope for mutation payloads.
 * Server stores opaque JSON; only the device with the key can read Memory bodies.
 */

const E2E_MARKER = "__e2e";

export interface SyncCrypto {
  readonly mode: "plaintext" | "e2e";
  wrapPayload(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  unwrapPayload(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export const plaintextSyncCrypto: SyncCrypto = {
  mode: "plaintext",
  async wrapPayload(payload) {
    return payload;
  },
  async unwrapPayload(payload) {
    return payload;
  },
};

export interface AesGcmSyncCryptoOptions {
  /** Raw 32-byte key, or passphrase (PBKDF2). */
  keyMaterial: string | Uint8Array;
  salt?: Uint8Array;
  iterations?: number;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveAesKey(
  material: string | Uint8Array,
  salt: Uint8Array,
  iterations: number,
): Promise<unknown> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("AesGcmSyncCrypto: Web Crypto subtle required");

  if (typeof material === "string") {
    const base = await subtle.importKey(
      "raw",
      new TextEncoder().encode(material),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  const raw = material;
  if (raw.byteLength !== 32) {
    throw new Error("AesGcmSyncCrypto: raw key must be 32 bytes");
  }
  return subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * AES-GCM envelope crypto for Sync payloads (optional E2E).
 */
export class AesGcmSyncCrypto implements SyncCrypto {
  readonly mode = "e2e" as const;
  private keyPromise: Promise<unknown>;

  constructor(opts: AesGcmSyncCryptoOptions) {
    const salt =
      opts.salt ?? new TextEncoder().encode("saas-hybrid-agent-sync-e2e-v1");
    this.keyPromise = deriveAesKey(
      opts.keyMaterial,
      salt instanceof Uint8Array ? salt : new TextEncoder().encode(String(salt)),
      opts.iterations ?? 100_000,
    );
  }

  async wrapPayload(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const subtle = globalThis.crypto.subtle;
    const key = await this.keyPromise;
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(payload));
    const ct = new Uint8Array(
      await subtle.encrypt(
        { name: "AES-GCM", iv },
        key as Parameters<typeof subtle.encrypt>[1],
        plain,
      ),
    );
    return {
      [E2E_MARKER]: true,
      alg: "AES-GCM",
      iv: b64encode(iv),
      ct: b64encode(ct),
    };
  }

  async unwrapPayload(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!payload[E2E_MARKER]) return payload;
    const subtle = globalThis.crypto.subtle;
    const key = await this.keyPromise;
    const iv = b64decode(String(payload.iv ?? ""));
    const ct = b64decode(String(payload.ct ?? ""));
    const plain = new Uint8Array(
      await subtle.decrypt(
        { name: "AES-GCM", iv },
        key as Parameters<typeof subtle.decrypt>[1],
        ct,
      ),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
  }
}

export function isE2ePayload(payload: Record<string, unknown>): boolean {
  return payload[E2E_MARKER] === true;
}
