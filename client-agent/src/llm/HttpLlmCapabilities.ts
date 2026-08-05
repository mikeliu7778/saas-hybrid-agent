export interface FetchLlmCapabilitiesOptions {
  baseUrl: string;
  token: string;
  model?: string;
  provider?: string;
  fetchImpl?: typeof fetch;
}

export interface LlmCapabilities {
  vision: boolean;
  model: string;
}

/**
 * GET /v1/llm/capabilities — whether the effective model supports vision.
 */
export async function fetchLlmCapabilities(
  opts: FetchLlmCapabilitiesOptions,
): Promise<LlmCapabilities> {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  const params = new URLSearchParams();
  if (opts.model) params.set("model", opts.model);
  if (opts.provider) params.set("provider", opts.provider);
  const qs = params.toString();
  const url = `${baseUrl}/v1/llm/capabilities${qs ? `?${qs}` : ""}`;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`LLM capabilities HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { vision?: boolean; model?: string };
  return {
    vision: Boolean(body.vision),
    model: typeof body.model === "string" ? body.model : opts.model ?? "",
  };
}
