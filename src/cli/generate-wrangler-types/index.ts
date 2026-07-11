#!/usr/bin/env node
/// <reference types="node" />
/**
 * @file Entry point for the `generate-wrangler-types` CLI binary.
 *
 * Wires together the real filesystem adapter and Wrangler runner, then delegates to {@link run}
 * which owns all argument parsing and business logic. The process exits with the numeric code
 * returned by `run`.
 *
 * The shebang above is preserved verbatim by tsdown in the built
 * `dist/cli/generate-wrangler-types/index.js` so that `package.json#bin` resolves to a directly
 * executable file once npm links it.
 *
 * This file is a thin wiring shim around `run()`, which is fully covered by
 * `test/node/cli/generate-wrangler-types/run.test.ts`, and is excluded from coverage thresholds.
 */
import process from "node:process";
import { createFileSystem } from "./fs.js";
import { run } from "./run.js";
import { createWranglerRunner } from "./wrangler.js";

const exitCode = await run(process.argv, {
  wrangler: createWranglerRunner(),
  fs: createFileSystem()
});
process.exit(exitCode);
