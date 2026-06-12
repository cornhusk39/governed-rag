// Voyage AI embedding provider.
//
// This is the live ingest path. It talks to Voyage's REST API directly with fetch
// so we do not take on an SDK dependency for one endpoint. The API key comes from
// the environment only and is never logged. Tests never construct this: they use
// the FakeEmbedder, so the suite stays offline and key-free.

import type { Embedder } from "./types.js";

export interface VoyageOptions {
  apiKey: string;
  // Defaults to voyage-3. The model fixes the output dimensionality, so changing
  // it means rebuilding the index.
  model?: string;
  dimensions?: number;
  // Voyage distinguishes document vs query embeddings; ingest passes "document".
  inputType?: "document" | "query";
  baseUrl?: string;
}

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

// Output dimensions for the supported Voyage models. Voyage-3 family is 1024.
const MODEL_DIMENSIONS: Record<string, number> = {
  "voyage-3": 1024,
  "voyage-3-large": 1024,
  "voyage-3-lite": 512,
};

export class VoyageEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly inputType: "document" | "query";
  private readonly baseUrl: string;

  constructor(options: VoyageOptions) {
    if (!options.apiKey) {
      throw new Error("VoyageEmbedder requires an API key (set VOYAGE_API_KEY).");
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? "voyage-3";
    this.dimensions = options.dimensions ?? MODEL_DIMENSIONS[this.model] ?? 1024;
    this.inputType = options.inputType ?? "document";
    this.baseUrl = options.baseUrl ?? "https://api.voyageai.com/v1";
    this.id = `voyage:${this.model}:${this.dimensions}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        input_type: this.inputType,
      }),
    });

    if (!response.ok) {
      // Surface the status but not the key. The body may carry a useful message.
      const detail = await response.text().catch(() => "");
      throw new Error(`Voyage embeddings request failed: ${response.status} ${detail}`);
    }

    const payload = (await response.json()) as VoyageResponse;
    // Sort by the returned index so output order matches input order regardless of
    // how the API ordered its response.
    return payload.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((row) => row.embedding);
  }
}
