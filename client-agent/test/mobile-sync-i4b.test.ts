import { describe, expect, it, vi, afterEach } from "vitest";
import { hashEmbed, InMemoryMemoryStore } from "../src/memory/InMemoryMemoryStore.js";
import { InMemorySyncBackend } from "../src/sync/InMemorySyncBackend.js";
import { HttpSyncBackend } from "../src/sync/HttpSyncBackend.js";
import { LocalSyncEngine } from "../src/sync/LocalSyncEngine.js";
import { MobileMemoryClient } from "../src/sync/MobileMemoryClient.js";
import {
  AesGcmSyncCrypto,
  isE2ePayload,
  plaintextSyncCrypto,
} from "../src/sync/SyncCrypto.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("I4b HttpSyncBackend + MobileMemoryClient", () => {
  it("POSTs /v1/sync/push and GETs /v1/sync/pull", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/push")) {
        return new Response(JSON.stringify({ accepted: 1 }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          cursor: "1",
          mutations: [
            {
              entityType: "semantic",
              entityId: "s1",
              version: 1,
              updatedAt: "2026-08-06T00:00:00.000Z",
              deviceId: "phone",
              payload: { text: "prefers dark mode", tags: [] },
              embedding: hashEmbed("prefers dark mode"),
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const http = new HttpSyncBackend({
      baseUrl: "https://api.example.com/",
      token: "tok",
    });
    await http.push({
      deviceId: "phone",
      mutations: [
        {
          entityType: "semantic",
          entityId: "s0",
          version: 1,
          updatedAt: "2026-08-06T00:00:00.000Z",
          deviceId: "phone",
          payload: { text: "x" },
        },
      ],
    });
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/v1/sync/push");

    const pulled = await http.pull("0");
    expect(pulled.mutations).toHaveLength(1);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("/v1/sync/pull?since=0");
  });

  it("MobileMemoryClient refresh + recall after sync", async () => {
    const backend = new InMemorySyncBackend();
    const memA = new InMemoryMemoryStore({ deviceId: "web" });
    const memPhone = new InMemoryMemoryStore({ deviceId: "phone" });
    const syncA = new LocalSyncEngine(backend, memA, "web");
    const syncPhone = new LocalSyncEngine(backend, memPhone, "phone");

    const text = "user timezone Asia/Shanghai";
    syncA.enqueue({
      entityType: "semantic",
      entityId: "sem-tz",
      version: 1,
      updatedAt: "2026-08-06T01:00:00.000Z",
      deviceId: "web",
      payload: { text, tags: ["pref"] },
      embedding: hashEmbed(text),
    });
    await syncA.push();

    const mobile = new MobileMemoryClient({ memory: memPhone, sync: syncPhone });
    await mobile.refresh();
    const hits = await mobile.recall("timezone Shanghai");
    expect(hits.some((h) => h.id === "sem-tz")).toBe(true);
  });
});

describe("I4b optional E2E SyncCrypto", () => {
  it("encrypts payload on push so backend log has no plaintext", async () => {
    const backend = new InMemorySyncBackend();
    const key = new Uint8Array(32).fill(7);
    const crypto = new AesGcmSyncCrypto({ keyMaterial: key });
    const memA = new InMemoryMemoryStore({ deviceId: "A" });
    const memB = new InMemoryMemoryStore({ deviceId: "B" });
    const syncA = new LocalSyncEngine(backend, memA, "A", { crypto });
    const syncB = new LocalSyncEngine(backend, memB, "B", { crypto });

    const secret = "private note about AuthService.ts";
    syncA.enqueue({
      entityType: "semantic",
      entityId: "sem-e2e",
      version: 1,
      updatedAt: "2026-08-06T02:00:00.000Z",
      deviceId: "A",
      payload: { text: secret, tags: [] },
      embedding: hashEmbed(secret),
    });
    await syncA.push();

    const stored = backend.pull("0").mutations[0]!;
    expect(isE2ePayload(stored.payload)).toBe(true);
    expect(JSON.stringify(stored.payload)).not.toContain("AuthService");
    expect(JSON.stringify(stored.payload)).not.toContain(secret);

    await syncB.pull();
    expect(memB.semantic.get("sem-e2e")?.text).toBe(secret);
  });

  it("plaintext mode leaves payload readable", async () => {
    expect(plaintextSyncCrypto.mode).toBe("plaintext");
    const p = await plaintextSyncCrypto.wrapPayload({ text: "hi" });
    expect(p).toEqual({ text: "hi" });
  });
});
