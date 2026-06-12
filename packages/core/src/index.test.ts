import { describe, expect, it } from "vitest";

import { CORE_VERSION } from "./index.js";

describe("core scaffold", () => {
  it("exposes a semver-shaped version string", () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
