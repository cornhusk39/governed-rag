// A deterministic, dependency-free embedder for tests and offline use.
//
// It maps text to a hashed bag-of-words vector: each lowercased token bumps one
// dimension, then the vector is L2-normalized. The point is not semantic quality,
// it is determinism and a useful property for retrieval spot-checks: texts that
// share vocabulary land near each other under cosine similarity. Because it needs
// no network and no key, the whole test suite can exercise the real retrieval
// path without live services.

import type { Embedder } from "./types.js";

// A small, fast string hash (FNV-1a). Stable across runs and platforms, which is
// what we need for deterministic vectors.
function fnv1a(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    // Multiply by the FNV prime using Math.imul to stay in 32-bit space.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to an unsigned 32-bit integer.
  return hash >>> 0;
}

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  return matches ?? [];
}

export interface FakeEmbedderOptions {
  dimensions: number;
}

export class FakeEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions: number;

  constructor(options: FakeEmbedderOptions = { dimensions: 256 }) {
    this.dimensions = options.dimensions;
    this.id = `fake-hash-v1:${this.dimensions}`;
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (const token of tokenize(text)) {
      const index = fnv1a(token) % this.dimensions;
      vector[index]! += 1;
    }
    // L2-normalize so cosine similarity behaves and zero vectors stay zero.
    let norm = 0;
    for (const value of vector) {
      norm += value * value;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i]! /= norm;
      }
    }
    return vector;
  }

  // Async to satisfy the interface; the work itself is synchronous and local.
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }
}
