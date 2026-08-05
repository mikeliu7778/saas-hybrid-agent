import { describe, expect, it } from "vitest";
import {
  buildUserContent,
  countImages,
  extractText,
} from "../src/runtime/contentParts.js";

describe("contentParts helpers", () => {
  it("returns string when no images", () => {
    expect(buildUserContent("hi")).toBe("hi");
  });

  it("returns parts when images present", () => {
    const c = buildUserContent("see", [{ dataUrl: "data:image/png;base64,aa" }]);
    expect(Array.isArray(c)).toBe(true);
    expect(c).toEqual([
      { type: "text", text: "see" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aa" } },
    ]);
  });

  it("extractText joins text parts and ignores images", () => {
    expect(extractText("plain")).toBe("plain");
    expect(extractText(null)).toBe("");
    expect(
      extractText([
        { type: "text", text: "a" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aa" } },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
  });

  it("countImages counts image_url parts", () => {
    expect(countImages("hi")).toBe(0);
    expect(countImages(null)).toBe(0);
    expect(
      countImages([
        { type: "text", text: "see" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aa" } },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,bb" } },
      ]),
    ).toBe(2);
  });
});
