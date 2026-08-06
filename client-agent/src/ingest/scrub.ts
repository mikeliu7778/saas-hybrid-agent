import type { IngestEvent } from "./types.js";

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bcrsr_[A-Za-z0-9_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

export function scrubText(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

export function scrubEvent(event: IngestEvent): IngestEvent {
  return {
    ...event,
    summary: scrubText(event.summary),
    skillHint: event.skillHint !== undefined ? scrubText(event.skillHint) : undefined,
    paths: event.paths.map((p) => scrubText(p)),
    scrubbed: true,
  };
}
