// The embedding provider interface. Retrieval depends on embeddings, but the
// pipeline does not care who produces them: live ingest uses Voyage, tests use a
// deterministic local embedder. Keeping this seam small is what makes the
// provider swappable and the test suite key-free.

export interface Embedder {
  // Stable identifier of the provider and model, recorded in the audit log so a
  // stored vector can always be traced to how it was produced.
  readonly id: string;
  // Vector dimensionality. The vector index is created against this, so it must
  // be stable for a given index.
  readonly dimensions: number;
  // Embed a batch of texts, returning one vector per input in the same order.
  embed(texts: string[]): Promise<number[][]>;
}
