// Loads the read-only demo snapshot for the server components to read.
//
// The snapshot path is configurable via GOVERNED_RAG_DEMO_DATA; it defaults to
// the committed sample so the app builds and renders out of the box. This is the
// only data source the web app has: no database, no API keys, no generation.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { DemoSnapshot } from "@governed-rag/core";

let cached: DemoSnapshot | undefined;

function snapshotPath(): string {
  const fromEnv = process.env.GOVERNED_RAG_DEMO_DATA;
  if (fromEnv) {
    return fromEnv;
  }
  return path.join(process.cwd(), "data", "sample-snapshot.json");
}

export function loadSnapshot(): DemoSnapshot {
  if (!cached) {
    cached = JSON.parse(readFileSync(snapshotPath(), "utf8")) as DemoSnapshot;
  }
  return cached;
}
