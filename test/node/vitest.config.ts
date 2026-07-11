import { defineConfig } from "vitest/config";

export default defineConfig({
  // `CLI_VERSION` is normally substituted by tsdown's own `define` option (tsdown.config.ts) at
  // build time. Tests here run directly against `src/` via esbuild/vitest, bypassing tsdown
  // entirely, so `src/cli/generate-wrangler-types/run.ts`'s `declare const CLI_VERSION: string`
  // needs the same substitution here — a fixed test string.
  define: {
    CLI_VERSION: JSON.stringify("0.0.0-test")
  },
  test: {
    name: "node",
    environment: "node",
    include: ["**/*.test.ts"]
  }
});
