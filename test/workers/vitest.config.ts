import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    // cloudflareTest() owns the runner pool and sets the Workers environment
    // itself — never set `test.environment` for this project.
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" }
    })
  ],
  test: {
    name: "workers",
    include: ["**/*.test.ts"]
  }
});
