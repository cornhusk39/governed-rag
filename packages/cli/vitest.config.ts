import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The CLI imports @governed-rag/core. During tests we resolve that to core's
// source rather than its built dist, so tests run without a prior build step.
// At runtime the built CLI resolves core through the pnpm workspace symlink.
export default defineConfig({
  resolve: {
    alias: {
      "@governed-rag/core": fileURLToPath(
        new URL("../core/src/index.ts", import.meta.url),
      ),
    },
  },
});
