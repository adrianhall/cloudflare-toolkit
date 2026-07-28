/**
 * @file Vitest configuration for opt-in live R2 tests.
 *
 * Deliberately **not** listed in the root `vitest.config.ts`'s `test.projects` array, so
 * `npm test`/`npm run test:coverage`/CI never discover or run anything under this directory.
 * Invoked explicitly via `npm run test:live:r2`, which passes this file as `--config`.
 *
 * `root` must be set explicitly to this directory. The other per-project configs
 * (`test/node/vitest.config.ts`, etc.) can omit it because the root `vitest.config.ts`'s
 * `test.projects` array scopes each one to its own config file's directory automatically - but
 * this config is run standalone via `--config` (not through that `projects` mechanism), where
 * Vitest otherwise defaults `root` to `process.cwd()` and would pick up every `*.test.ts` file in
 * the whole repo, including ones relying on `test/node/vitest.config.ts`'s `CLI_VERSION` define.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "live",
    root: import.meta.dirname,
    environment: "node",
    include: ["**/*.test.ts"],
    // Live tests create real remote infrastructure and poll a real completion endpoint;
    // the default 5s test timeout is too short for that round trip.
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
});
