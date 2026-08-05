import type { ContentPart, RunTurnImages } from "./types.js";

/** Build user message content: plain string when no images, else OpenAI-style parts. */
export function buildUserContent(
  text: string,
  images?: RunTurnImages,
): string | ContentPart[] {
  if (!images || images.length === 0) {
    return text;
  }
  return [
    { type: "text", text },
    ...images.map(
      (img): ContentPart => ({
        type: "image_url",
        image_url: { url: img.dataUrl },
      }),
    ),
  ];
}

/** Extract concatenated text from string or content parts (images ignored). */
export function extractText(content: string | ContentPart[] | null): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Count image_url parts in content. */
export function countImages(content: string | ContentPart[] | null): number {
  if (content == null || typeof content === "string") return 0;
  return content.filter((p) => p.type === "image_url").length;
}
