import { defineConfig } from "vitest/config";

export default defineConfig({
  // `CLI_VERSION` is normally substituted by tsup's own `define` option (tsup.config.ts) at
  // build time. Tests here run directly against `src/` via esbuild/vitest, bypassing tsup
  // entirely, so `src/cli/generate-wrangler-types/run.ts`'s `declare const CLI_VERSION: string`
  // needs the same substitution here — a fixed test string, mirroring
  // `cloudflare-scripts`'s own `vitest.config.ts` (docs/SPECv2.md §10, §5.7).
  define: {
    CLI_VERSION: JSON.stringify("0.0.0-test")
  },
  test: {
    name: "node",
    environment: "node",
    include: ["**/*.test.ts"]
  }
});
