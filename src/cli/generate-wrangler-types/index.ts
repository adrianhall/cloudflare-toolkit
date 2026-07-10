#!/usr/bin/env node
/// <reference types="node" />
// Entry point for the `generate-wrangler-types` CLI binary (docs/SPECv2.md §5.7, §5.9). Ported
// from adrianhall/cloudflare-scripts's `src/cli/generate-types/index.ts` (same author, MIT — see
// docs/SPECv2.md §10; source repo is read-only and not modified by this port).
//
// Wires together the real filesystem adapter and Wrangler runner, then delegates to {@link run}
// which owns all argument parsing and business logic. The process exits with the numeric code
// returned by `run`.
//
// The shebang above is preserved verbatim by tsup in the built `dist/cli/generate-wrangler-types/
// index.js` (no `banner` option needed in tsup.config.ts) so that `package.json#bin` resolves to
// a directly executable file once npm links it.
//
// Excluded from coverage thresholds (root vitest.config.ts's `src/**/index.ts` pattern) — this
// file is a thin wiring shim around `run()`, which is itself fully covered by
// `test/node/cli/generate-wrangler-types/run.test.ts` (docs/SPECv2.md §7.1).

import process from "node:process";
import { createFileSystem } from "./fs.js";
import { run } from "./run.js";
import { createWranglerRunner } from "./wrangler.js";

const exitCode = await run(process.argv, {
  wrangler: createWranglerRunner(),
  fs: createFileSystem()
});
process.exit(exitCode);
