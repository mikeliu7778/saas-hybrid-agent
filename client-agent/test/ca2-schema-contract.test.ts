import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemasDir = join(root, "schemas");

describe("CA-2.1 / CA-2.2 OpenAPI & sync schemas exist", () => {
  it("ships openapi-phase-a.yaml with required paths", () => {
    const yaml = readFileSync(join(schemasDir, "openapi-phase-a.yaml"), "utf8");
    for (const path of [
      "/v1/llm/chat",
      "/v1/llm/embeddings",
      "/v1/sync/push",
      "/v1/sync/pull",
      "/v1/devices",
      "/v1/quota",
    ]) {
      expect(yaml).toContain(path);
    }
    expect(yaml).toContain("SseChatEvent");
    expect(yaml).toContain("text/event-stream");
  });

  it("ships sync-entities.json with version/deviceId/embeddingModelId fields", () => {
    const raw = readFileSync(join(schemasDir, "sync-entities.json"), "utf8");
    expect(raw).toContain("embeddingModelId");
    expect(raw).toContain("deviceId");
    expect(raw).toContain('"version"');
    expect(raw).toContain("tombstone");
  });
});

describe("CA-2.3 contract fixtures validate against sync schema", () => {
  const schema = JSON.parse(
    readFileSync(join(schemasDir, "sync-entities.json"), "utf8"),
  );
  const fixtures = JSON.parse(
    readFileSync(join(schemasDir, "fixtures/phase-a-examples.json"), "utf8"),
  ) as Record<string, unknown>;

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  for (const key of ["semantic", "episode", "message", "session_meta", "tombstone"] as const) {
    it(`fixture ${key} validates`, () => {
      const ok = validate(fixtures[key]);
      expect(ok, JSON.stringify(validate.errors)).toBe(true);
    });
  }

  it("rejects a mutation missing version", () => {
    const bad = { ...(fixtures.semantic as Record<string, unknown>) };
    delete bad.version;
    expect(validate(bad)).toBe(false);
  });
});
