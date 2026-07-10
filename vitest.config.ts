/**
 * @file Root Vitest configuration.
 *
 * Runtime-specific settings live alongside the tests they govern so each runtime assumption is
 * explicit:
 *
 *   test/node/vitest.config.ts     — plain Node (pure logic, Node-safe code)
 *   test/workers/vitest.config.ts  — workerd via @cloudflare/vitest-pool-workers
 *   test/package/vitest.config.ts  — plain Node (built `dist/` import/export checks)
 *
 * Coverage uses Istanbul rather than V8 because workerd does not expose the V8 coverage
 * profiler; Istanbul instruments at transpile time and works in every runtime uniformly.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "test/node/vitest.config.ts",
      "test/workers/vitest.config.ts",
      "test/package/vitest.config.ts"
    ],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/index.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      }
    }
  }
});
