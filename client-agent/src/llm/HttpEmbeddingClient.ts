export interface HttpEmbeddingClientOptions {
  baseUrl: string;
  token: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export class HttpEmbeddingClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpEmbeddingClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.model = opts.model ?? "text-embedding-3-small";
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  async embed(text: string): Promise<{ embedding: number[]; modelId: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/llm/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: text, model: this.model }),
    });
    if (!res.ok) {
      throw new Error(`Embedding gateway HTTP ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      model: string;
      data: Array<{ embedding: number[]; index: number }>;
    };
    const embedding = body.data?.[0]?.embedding;
    if (!embedding) {
      throw new Error("Embedding gateway returned empty data");
    }
    return { embedding, modelId: body.model };
  }
}
