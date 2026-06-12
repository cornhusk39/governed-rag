import { describe, expect, it, vi } from "vitest";

import { CLI_VERSION, dispatch } from "./index.js";

describe("cli dispatch", () => {
  it("prints the version and exits 0 with no command", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(await dispatch([])).toBe(0);
    expect(write).toHaveBeenCalledWith(expect.stringContaining(CLI_VERSION));
    write.mockRestore();
  });

  it("returns 0 for the --version flag", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(await dispatch(["--version"])).toBe(0);
    write.mockRestore();
  });

  it("returns a nonzero code and a hint for an unknown command", async () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await dispatch(["bogus"])).toBe(1);
    expect(write).toHaveBeenCalledWith(expect.stringContaining("unknown command"));
    write.mockRestore();
  });
});
