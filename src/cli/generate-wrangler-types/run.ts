// Core orchestration logic for the `generate-wrangler-types` CLI (docs/SPECv2.md §5.7, §5.9).
// Ported from adrianhall/cloudflare-scripts's `src/cli/generate-types/run.ts` (same author, MIT —
// see docs/SPECv2.md §10; source repo is read-only and not modified by this port). Behavior,
// flags, and exit codes are unchanged from upstream (docs/SPECv2.md §5.7) — the only differences
// are: the bin name/`--help`/`--version` banner text (`generate-types` → `generate-wrangler-types`
// in `.name()`), and importing the CLI's own local `./logger.js` instead of
// `cloudflare-scripts`'s shared `#lib/logger` (this toolkit ships only this one CLI, so there is
// no other consumer to share that module with — see logger.ts's own header comment).
//
// This module owns the full execution pipeline:
//   1. Argument parsing (Commander, with `--` passthrough for wrangler args)
//   2. Logger creation
//   3. Path resolution
//   4. Wrangler config existence check
//   5. Freshness check (compare config vs. output modification times)
//   6. `wrangler types` execution
//
// All external I/O is accessed through the injected {@link GenerateWranglerTypesDeps} interfaces,
// making the function fully testable without touching the real filesystem or spawning processes.

import { isAbsolute, resolve } from "node:path";
import { Command, CommanderError } from "commander";
import type { LogLevel, LogSink } from "./logger.js";
import { createLogger } from "./logger.js";
import type { FileSystem, WranglerRunner } from "./types.js";

// CLI_VERSION is replaced at build time by tsup's `define` option (tsup.config.ts).
declare const CLI_VERSION: string;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a human-readable message from an unknown `catch` value.
 *
 * Returns `err.message` when the value is an `Error`, otherwise stringifies it with `String()`.
 *
 * @param err - The caught value (may be anything).
 * @returns A string suitable for log messages or user-facing error output.
 */
function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * External dependencies injected into {@link run} to keep I/O decoupled from business logic and
 * facilitate unit testing.
 */
export interface GenerateWranglerTypesDeps {
  /** Wrangler CLI adapter used to execute `wrangler types`. */
  wrangler: WranglerRunner;
  /** Filesystem adapter used for existence and modification time checks. */
  fs: FileSystem;
  /** If provided, used as the logger sink instead of the default stderr writer. */
  logSink?: LogSink;
}

// ---------------------------------------------------------------------------
// Core logic (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Runs the `generate-wrangler-types` CLI pipeline and returns a POSIX exit code.
 *
 * The function is intentionally pure with respect to side effects: all I/O is delegated to
 * `deps` so that every code path can be exercised in tests without spawning child processes or
 * touching real files.
 *
 * Exit codes:
 * | Code | Meaning |
 * |------|---------|
 * | `0`  | Types are already fresh (skipped), or `wrangler types` succeeded |
 * | `1`  | Wrangler config file not found (run `provision` first) |
 * | `2`  | `wrangler` could not be executed (binary not on PATH / ENOENT) |
 * | `3`  | `wrangler types` exited with a non-zero code (code is logged) |
 * | `6`  | Argument error (`--verbose` + `--quiet`, unknown option) |
 * | `99` | Unexpected internal error |
 *
 * @param argv - The raw `process.argv` array (first two elements are skipped by Commander).
 * @param deps - Injected I/O dependencies.
 * @returns A numeric exit code as listed above.
 */
export async function run(argv: string[], deps: GenerateWranglerTypesDeps): Promise<number> {
  const { wrangler, logSink } = deps;
  const fs = deps.fs;

  // -------------------------------------------------------------------------
  // Step 1 — Parse arguments
  //
  // Pre-split argv on `--` so that everything after the separator is forwarded verbatim to
  // `wrangler types`, independently of Commander's passthrough handling. Commander only ever
  // sees the first segment.
  // -------------------------------------------------------------------------
  const separatorIndex = argv.indexOf("--");
  const commanderArgv = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  // Everything after `--` is forwarded verbatim to `wrangler types`.
  const extraArgs = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);

  const program = new Command();
  program
    .name("generate-wrangler-types")
    .description("Regenerate worker-configuration.d.ts only when wrangler.jsonc has changed")
    .version(CLI_VERSION, "--version", "Print version and exit")
    .option("-c, --config <file>", "Wrangler config file to watch", "wrangler.jsonc")
    .option("-d, --dir <dir>", "Base directory for resolving relative paths", ".")
    .option("-f, --force", "Force regeneration even if types are already fresh")
    .option(
      "-o, --output <file>",
      "Output .d.ts file path (relative to --dir)",
      "worker-configuration.d.ts"
    )
    .option("-q, --quiet", "Quiet logging (min level: warn)")
    .option("-v, --verbose", "Verbose logging (min level: debug)")
    .allowUnknownOption(false);

  program.exitOverride();

  try {
    program.parse(commanderArgv);
  } catch (err: unknown) {
    if (err instanceof CommanderError) {
      // --help and --version exit with code 0 after printing.
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
        return 0;
      }
      // All other parse errors are argument problems → exit 6.
      return 6;
    }
    // Unexpected error during parse.
    process.stderr.write(`Internal error during argument parsing: ${String(err)}\n`);
    return 99;
  }

  const opts = program.opts<{
    config: string;
    dir: string;
    force?: boolean;
    output: string;
    quiet?: boolean;
    verbose?: boolean;
  }>();

  // -------------------------------------------------------------------------
  // Step 2 — Check -v / -q conflict
  // -------------------------------------------------------------------------
  if (opts.verbose && opts.quiet) {
    process.stderr.write("Error: --verbose (-v) and --quiet (-q) are mutually exclusive\n");
    return 6;
  }

  // Create the logger now that we know the level.
  const level: LogLevel =
    opts.verbose ? "debug"
    : opts.quiet ? "warn"
    : "info";
  const logger = createLogger({ level, sink: logSink });

  // -------------------------------------------------------------------------
  // Step 3 — Resolve paths
  // -------------------------------------------------------------------------
  const baseDir = opts.dir;

  const configPath = isAbsolute(opts.config) ? opts.config : resolve(baseDir, opts.config);

  const outputPath = isAbsolute(opts.output) ? opts.output : resolve(baseDir, opts.output);

  logger.debug(`Config path:  ${configPath}`);
  logger.debug(`Output path:  ${outputPath}`);
  if (extraArgs.length > 0) {
    logger.debug(`Wrangler args: ${extraArgs.join(" ")}`);
  }

  // -------------------------------------------------------------------------
  // Step 4 — Check config exists
  // -------------------------------------------------------------------------
  const configExists = await fs.fileExists(configPath);
  if (!configExists) {
    logger.error(
      `Wrangler config not found: ${configPath}\n`
        + "       Run `npm run provision` to provision infrastructure and generate it."
    );
    return 1;
  }

  // -------------------------------------------------------------------------
  // Step 5 — Freshness check (skip if output is newer than config)
  // -------------------------------------------------------------------------
  if (!opts.force) {
    const outputExists = await fs.fileExists(outputPath);
    if (outputExists) {
      let configMtime: number;
      let outputMtime: number;
      try {
        configMtime = await fs.getModifiedTime(configPath);
        outputMtime = await fs.getModifiedTime(outputPath);
      } catch (err: unknown) {
        process.stderr.write(
          `Internal error reading file modification times: ${getErrorMessage(err)}\n`
        );
        return 99;
      }

      if (outputMtime > configMtime) {
        logger.debug(
          `Types are fresh (output newer than config by ${Math.round(outputMtime - configMtime)}ms) — skipping`
        );
        return 0;
      }

      logger.info(`generate-types: ${opts.config} is newer than ${opts.output} — regenerating...`);
    } else {
      logger.info(`generate-types: ${opts.output} not found — generating...`);
    }
  } else {
    logger.debug("--force: skipping freshness check");
  }

  // -------------------------------------------------------------------------
  // Step 6 — Run wrangler types
  // -------------------------------------------------------------------------
  logger.debug(
    `Running: npx wrangler types ${outputPath}${extraArgs.length > 0 ? ` ${extraArgs.join(" ")}` : ""}`
  );

  let result: Awaited<ReturnType<WranglerRunner["runTypes"]>>;
  try {
    result = await wrangler.runTypes(outputPath, extraArgs, resolve(baseDir));
  } catch (err: unknown) {
    logger.error(`Failed to launch wrangler: ${getErrorMessage(err)}`);
    return 2;
  }

  // Log any captured wrangler output at debug level.
  if (result.stdout.trim().length > 0) {
    for (const line of result.stdout.trimEnd().split("\n")) {
      logger.debug(`wrangler: ${line}`);
    }
  }
  if (result.stderr.trim().length > 0) {
    for (const line of result.stderr.trimEnd().split("\n")) {
      logger.debug(`wrangler (stderr): ${line}`);
    }
  }

  const exitCode = result.exitCode ?? 1;

  if (exitCode !== 0) {
    logger.error(`wrangler types failed with exit code ${exitCode}`);
    return 3;
  }

  logger.info(`Wrote ${outputPath}`);
  return 0;
}
