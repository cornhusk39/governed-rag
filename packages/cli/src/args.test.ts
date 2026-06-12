import { describe, expect, it } from "vitest";

import { parseArgs, requireFlag } from "./args.js";

describe("parseArgs", () => {
  it("separates the command, positionals, and flags", () => {
    const parsed = parseArgs(["query", "net sales", "--db", "./x.db", "--fake-embeddings"]);
    expect(parsed.command).toBe("query");
    expect(parsed.positionals).toEqual(["net sales"]);
    expect(parsed.flags.db).toBe("./x.db");
    // A flag with no following value is a boolean switch.
    expect(parsed.flags["fake-embeddings"]).toBe(true);
  });

  it("treats a flag followed by another flag as boolean", () => {
    const parsed = parseArgs(["ingest", "--fake-embeddings", "--cik", "0000000001"]);
    expect(parsed.flags["fake-embeddings"]).toBe(true);
    expect(parsed.flags.cik).toBe("0000000001");
  });

  it("handles no arguments", () => {
    const parsed = parseArgs([]);
    expect(parsed.command).toBeUndefined();
    expect(parsed.positionals).toEqual([]);
  });
});

describe("requireFlag", () => {
  it("returns a present string flag", () => {
    expect(requireFlag({ out: "snapshot.json" }, "out")).toBe("snapshot.json");
  });

  it("throws when the flag is missing or boolean", () => {
    expect(() => requireFlag({}, "out")).toThrow(/--out/);
    expect(() => requireFlag({ out: true }, "out")).toThrow(/--out/);
  });
});
