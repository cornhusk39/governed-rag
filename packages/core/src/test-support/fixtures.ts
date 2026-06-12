// Test-only helper for loading the synthetic fixture filings from disk. Excluded
// from the build; it exists so tests can run the real ingest path against cached
// documents with no network.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { filingMetaSchema, type FilingMeta } from "../types.js";

export interface FixtureFiling {
  file: string;
  html: string;
  meta: FilingMeta;
}

interface FixtureIndex {
  filings: Array<{ file: string; meta: unknown }>;
}

const FIXTURE_DIR = new URL("../../fixtures/filings/", import.meta.url);

export function loadFixtureFilings(): FixtureFiling[] {
  const indexPath = fileURLToPath(new URL("index.json", FIXTURE_DIR));
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as FixtureIndex;

  return index.filings.map((entry) => {
    const htmlPath = fileURLToPath(new URL(entry.file, FIXTURE_DIR));
    return {
      file: entry.file,
      html: readFileSync(htmlPath, "utf8"),
      meta: filingMetaSchema.parse(entry.meta),
    };
  });
}

export function loadFixtureFiling(file: string): FixtureFiling {
  const filing = loadFixtureFilings().find((f) => f.file === file);
  if (!filing) {
    throw new Error(`fixture not found: ${file}`);
  }
  return filing;
}
