/** @file Orchestration for the `cf-access-policy` CLI. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import type { AccessConfig } from "../../lib/access-config.js";
import type { LogLevel, LogSink } from "../internal/logger.js";
import { createLogger } from "../internal/logger.js";
import type { EnvLoader, Prompter } from "../internal/utils.js";
import { getErrorMessage } from "../internal/utils.js";
import type { AccessApi } from "./cf.js";
import {
  discoverAccess,
  executeAccessApply,
  executeAccessRemove,
  planAccessApply,
  planAccessRemove,
  validateAccessConfig
} from "./reconcile.js";

declare const CLI_VERSION: string;

/** Injectable configuration module loader. */
export type AccessConfigLoader = (path: string) => Promise<unknown>;

/** Injected dependencies for `cf-access-policy`. */
export interface AccessPolicyDeps {
  /** Creates the `cf` adapter after CLI options are parsed. */
  createApi(profile?: string): AccessApi;
  /** Confirmation prompt. */
  prompter: Prompter;
  /** Dotenv loader. */
  envLoader: EnvLoader;
  /** Optional configuration loader used by tests. */
  configLoader?: AccessConfigLoader;
  /** Optional test log sink. */
  logSink?: LogSink;
}

async function defaultConfigLoader(path: string): Promise<unknown> {
  return import(pathToFileURL(resolve(path)).href);
}

function printPlan(changes: { action: string; kind: string; name: string }[]): void {
  for (const change of changes)
    process.stdout.write(`${change.action.padEnd(9)} ${change.kind} ${change.name}\n`);
  if (changes.every(({ action }) => action === "no-change")) process.stdout.write("No changes.\n");
}

/**
 * Runs `cf-access-policy` and returns its documented exit code.
 *
 * @param argv - Node-style argument vector.
 * @param deps - CLI adapters and test seams.
 * @returns Zero on success or a stable categorized failure code.
 */
export async function run(argv: string[], deps: AccessPolicyDeps): Promise<number> {
  const program = new Command()
    .name("cf-access-policy")
    .description("Reconcile reusable Cloudflare Access policies and applications")
    .version(CLI_VERSION, "--version", "Print version and exit")
    .argument("<command>", "Operation to perform: apply or remove")
    .option("-c, --config <path>", "Typed Access config file", "access.config.ts")
    .option("--env-file <path>", "Load environment variables from a dotenv file")
    .option("--profile <name>", "Use a named cf authentication profile")
    .option("--dry-run", "Print the plan without mutation or prompting")
    .option("-y, --yes", "Approve the plan without prompting")
    .option("-q, --quiet", "Quiet logging (min level: warn)")
    .option("-v, --verbose", "Verbose logging (min level: debug)")
    .allowUnknownOption(false)
    .exitOverride();
  let options: {
    config: string;
    envFile?: string;
    profile?: string;
    dryRun?: boolean;
    yes?: boolean;
    quiet?: boolean;
    verbose?: boolean;
  };
  let command: string;
  try {
    program.parse(argv);
    options = program.opts();
    command = program.args[0];
  } catch (error: unknown) {
    if (error instanceof CommanderError)
      return error.code === "commander.helpDisplayed" || error.code === "commander.version" ? 0 : 6;
    process.stderr.write(`Internal error during argument parsing: ${String(error)}\n`);
    return 99;
  }
  if ((command !== "apply" && command !== "remove") || (options.verbose && options.quiet)) {
    process.stderr.write(
      "Error: command must be apply or remove, and -v/-q are mutually exclusive\n"
    );
    return 6;
  }
  const level: LogLevel =
    options.verbose ? "debug"
    : options.quiet ? "warn"
    : "info";
  const logger = createLogger({ level, sink: deps.logSink });
  if (options.envFile !== undefined) {
    try {
      await deps.envLoader.load(options.envFile);
    } catch (error: unknown) {
      logger.error(`Cannot load env file '${options.envFile}': ${getErrorMessage(error)}`);
      return 2;
    }
  }
  let config: AccessConfig;
  try {
    const loaded = await (deps.configLoader ?? defaultConfigLoader)(options.config);
    if (loaded === null || typeof loaded !== "object" || !("default" in loaded))
      throw new Error(`${options.config} must have a default export.`);
    const value = loaded.default;
    validateAccessConfig(value);
    config = value;
  } catch (error: unknown) {
    logger.error(`Access configuration failed: ${getErrorMessage(error)}`);
    return 2;
  }
  let api: AccessApi;
  let snapshot;
  let changes;
  try {
    api = deps.createApi(options.profile);
    snapshot = discoverAccess(api);
    changes =
      command === "apply" ? planAccessApply(config, snapshot) : planAccessRemove(config, snapshot);
  } catch (error: unknown) {
    logger.error(`Access discovery failed: ${getErrorMessage(error)}`);
    return 3;
  }
  printPlan(changes);
  const changing = changes.some(({ action }) => action !== "no-change");
  if (!changing || options.dryRun) return 0;
  if (!options.yes && !(await deps.prompter.confirm("Apply this plan? (y/N) "))) {
    logger.info("Access changes declined by operator");
    return 1;
  }
  try {
    if (command === "apply") executeAccessApply(config, snapshot, changes, api);
    else executeAccessRemove(snapshot, changes, api);
    return 0;
  } catch (error: unknown) {
    logger.error(`Access mutation failed: ${getErrorMessage(error)}`);
    return 4;
  }
}
