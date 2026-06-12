// Flat ESLint config for the whole workspace. We keep the rule set close to the
// typescript-eslint recommended baseline and tighten only where it earns its
// keep. Generated and build output is ignored so lint stays fast and focused on
// source we actually own.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused vars are usually a mistake, but allow a leading underscore as the
      // conventional "intentionally unused" marker (for example caught errors we
      // deliberately ignore or required-but-unused callback params).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
