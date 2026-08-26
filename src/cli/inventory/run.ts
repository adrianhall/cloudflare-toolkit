/** @file Commander orchestration for `cf-inventory`. */
import { Command, CommanderError } from "commander";
import type { LogSink } from "../internal/logger.js";
import { createLogger } from "../internal/logger.js";
import type { EnvLoader } from "../internal/utils.js";
import { BindingIndex, BindingKind } from "./bindings.js";
import { createLimit } from "./http.js";
import { queryOtherProducts, queryPages, queryWorkers } from "./products.js";
import { buildDocument, renderTable } from "./report.js";

declare const CLI_VERSION: string;

/** Injected dependencies for inventory orchestration. */
export interface InventoryDeps {
  fetchImpl: typeof fetch;
  envLoader: EnvLoader;
  env?: NodeJS.ProcessEnv;
  write?: (value: string) => void;
  logSink?: LogSink;
  sleep?: (ms: number) => Promise<void>;
}

interface Options {
  accountId?: string;
  apiToken?: string;
  envFile?: string;
  quiet?: boolean;
  verbose?: boolean;
  format?: string;
}

/** Runs account inventory and returns its stable exit code. */
export async function run(argv: string[], deps: InventoryDeps): Promise<number> {
  const program = new Command()
    .name("cf-inventory")
    .description("Inventory account-wide Cloudflare Developer Platform resources")
    .version(CLI_VERSION, "--version", "Print version and exit")
    .option("--env-file <path>", "Load credentials from a dotenv file")
    .option("-a, --account-id <id>", "Compatibility option; prefer CLOUDFLARE_ACCOUNT_ID")
    .option("-k, --api-token <token>", "Compatibility option; prefer CLOUDFLARE_API_TOKEN")
    .option("--format <table|json>", "Output format", "table")
    .option("-q, --quiet", "Quiet logging (min level: warn)")
    .option("-v, --verbose", "Verbose logging and coverage-gap notes")
    .allowUnknownOption(false)
    .exitOverride();

  let options: Options;
  try {
    program.parse(argv);
    options = program.opts<Options>();
  } catch (error) {
    if (error instanceof CommanderError)
      return error.code === "commander.helpDisplayed" || error.code === "commander.version" ? 0 : 6;
    process.stderr.write(`Internal error during argument parsing: ${String(error)}\n`);
    return 99;
  }
  if (options.quiet && options.verbose) {
    process.stderr.write("Error: --quiet and --verbose are mutually exclusive\n");
    return 6;
  }
  if (options.format !== "table" && options.format !== "json") {
    process.stderr.write("Error: --format must be table or json\n");
    return 6;
  }

  const logger = createLogger({
    level:
      options.verbose ? "debug"
      : options.quiet ? "warn"
      : "info",
    sink: deps.logSink
  });
  if (options.envFile !== undefined) {
    try {
      await deps.envLoader.load(options.envFile);
    } catch (error) {
      logger.error(
        `Cannot load env file '${options.envFile}': ${error instanceof Error ? error.message : String(error)}`
      );
      return 2;
    }
  }
  const env = deps.env ?? process.env;
  const accountId = options.accountId ?? env.CLOUDFLARE_ACCOUNT_ID;
  const token = options.apiToken ?? env.CLOUDFLARE_API_TOKEN;
  if (accountId === undefined || accountId === "" || token === undefined || token === "") {
    logger.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must both be set");
    return 2;
  }
  if (options.accountId !== undefined || options.apiToken !== undefined)
    logger.warn("Credential flags are discouraged; prefer environment variables or --env-file");

  try {
    logger.info(`Discovering Cloudflare resources for account ${accountId}`);
    const context = {
      accountId,
      token,
      fetchImpl: deps.fetchImpl,
      bindings: new BindingIndex(),
      bindingDiscoveryComplete: true,
      limit: createLimit(8),
      timeoutMs: 15_000,
      retries: 3,
      sleep: deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    };
    const [workers, pages] = await Promise.all([queryWorkers(context), queryPages(context)]);
    for (const row of workers.resources)
      if (row.resourceType === "Worker")
        row.referencedBy.push(...context.bindings.get(BindingKind.service, row.name));
    for (const row of [...workers.resources, ...pages.resources])
      row.deletionDiscoveryComplete &&= context.bindingDiscoveryComplete;
    const sections = [workers, pages, ...(await queryOtherProducts(context))];
    const document = buildDocument(accountId, sections);
    const output =
      options.format === "json" ?
        `${JSON.stringify(document, null, 2)}\n`
      : renderTable(document, options.verbose === true);
    (deps.write ?? ((value: string) => process.stdout.write(value)))(output);
    return document.status === "partial" ? 3 : 0;
  } catch (error) {
    logger.error(
      `Unexpected inventory failure: ${error instanceof Error ? error.message : String(error)}`
    );
    return 99;
  }
}
