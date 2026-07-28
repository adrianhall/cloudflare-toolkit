/**
 * @file Orchestration for the `empty-r2-bucket` CLI.
 *
 * Resolves exactly one of three mutually exclusive modes (standalone remote, Terraform-driven
 * remote, or local Miniflare), probes the target bucket for at least one object without counting
 * or retrieving every key, and - after an interactive confirmation or `--yes` - delegates emptying
 * to the mode-appropriate {@link R2BucketCleaner} adapter. See `docs/specs/EMPTY_R2_BUCKET.md` for
 * the full design rationale.
 */
import { Command, CommanderError } from "commander";
import type { R2BucketCleaner, R2Target } from "../internal/cloudflare.js";
import type { LogLevel, LogSink } from "../internal/logger.js";
import { createLogger } from "../internal/logger.js";
import type { TerraformOutputMap, TerraformRunner } from "../internal/terraform.js";
import type { EnvLoader, Prompter } from "../internal/utils.js";
import { getErrorMessage } from "../internal/utils.js";

declare const CLI_VERSION: string;

/** Default Local Explorer API base URL, matching Vite's standard dev server port. */
export const DEFAULT_LOCAL_URL = "http://localhost:5173/cdn-cgi/explorer/api";

/** Injected dependencies for `empty-r2-bucket`. */
export interface EmptyR2BucketDeps {
  /** Production Cloudflare REST API adapter. */
  remoteCleaner: R2BucketCleaner;
  /** Miniflare Local Explorer adapter. */
  localCleaner: R2BucketCleaner;
  /** Terraform output reader. */
  terraform: TerraformRunner;
  /** Confirmation prompt. */
  prompter: Prompter;
  /** Dotenv loader. */
  envLoader: EnvLoader;
  /** Optional test log sink. */
  logSink?: LogSink;
}

interface EmptyR2BucketOptions {
  accountId?: string;
  apiToken?: string;
  envFile?: string;
  terraform?: string;
  local?: boolean;
  localUrl?: string;
  yes?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

/**
 * Runs `empty-r2-bucket` and returns its documented exit code.
 *
 * Exit codes:
 * | Code | Meaning                                                                                  |
 * |------|-------------------------------------------------------------------------------------------|
 * | `0`  | Bucket was already empty, or the empty operation completed and final verification passed |
 * | `1`  | Operator declined deletion                                                               |
 * | `2`  | Environment file, credential, Terraform directory, output, or mode-resolution failure    |
 * | `3`  | The initial non-empty check failed or returned an invalid/incomplete response            |
 * | `4`  | Emptying, local batch deletion, completion polling, or final verification failed         |
 * | `6`  | Invalid arguments, conflicting modes, unknown option, or `-q`/`-v` conflict              |
 * | `99` | Unexpected internal failure                                                              |
 */
export async function run(argv: string[], deps: EmptyR2BucketDeps): Promise<number> {
  const program = new Command()
    .name("empty-r2-bucket")
    .description("Delete all objects in an R2 bucket before infrastructure teardown")
    .version(CLI_VERSION, "--version", "Print version and exit")
    .argument("[bucket-name]", "Bucket name (required in standalone remote and local modes)")
    .option("-a, --account-id <id>", "Cloudflare account ID (env: CLOUDFLARE_ACCOUNT_ID)")
    .option(
      "-k, --api-token <token>",
      "Compatibility option; prefer CLOUDFLARE_API_TOKEN or --env-file"
    )
    .option("--env-file <path>", "Load environment variables from a dotenv file before resolution")
    .option(
      "-t, --terraform <dir>",
      "Read account_id and r2_bucket_name from terraform output -json in this directory"
    )
    .option("--local", "Use the Miniflare Local Explorer API instead of the Cloudflare REST API")
    .option(
      "--local-url <url>",
      `Override the Local Explorer API URL (default: ${DEFAULT_LOCAL_URL})`
    )
    .option("-y, --yes", "Skip the destructive confirmation prompt")
    .option("-q, --quiet", "Quiet logging (min level: warn)")
    .option("-v, --verbose", "Verbose logging (min level: debug)")
    .allowUnknownOption(false)
    .exitOverride();

  let options: EmptyR2BucketOptions;
  let bucketName: string | undefined;
  try {
    program.parse(argv);
    options = program.opts();
    bucketName = program.args[0];
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      return error.code === "commander.helpDisplayed" || error.code === "commander.version" ? 0 : 6;
    }
    process.stderr.write(`Internal error during argument parsing: ${String(error)}\n`);
    return 99;
  }

  if (options.verbose && options.quiet) {
    process.stderr.write("Error: --verbose (-v) and --quiet (-q) are mutually exclusive\n");
    return 6;
  }

  if (options.local) {
    if (bucketName === undefined) {
      process.stderr.write("Error: bucket-name is required with --local\n");
      return 6;
    }
    if (options.terraform !== undefined) {
      process.stderr.write("Error: --local and --terraform are mutually exclusive\n");
      return 6;
    }
    if (
      options.accountId !== undefined
      || options.apiToken !== undefined
      || options.envFile !== undefined
    ) {
      process.stderr.write(
        "Error: --local is mutually exclusive with --account-id, --api-token, and --env-file\n"
      );
      return 6;
    }
  } else {
    if (options.localUrl !== undefined) {
      process.stderr.write("Error: --local-url requires --local\n");
      return 6;
    }
    if (options.terraform !== undefined) {
      if (bucketName !== undefined) {
        process.stderr.write(
          "Error: --terraform and a positional bucket-name are mutually exclusive\n"
        );
        return 6;
      }
    } else if (bucketName === undefined) {
      process.stderr.write("Error: bucket-name is required (or use --terraform or --local)\n");
      return 6;
    }
  }

  const level: LogLevel =
    options.verbose ? "debug"
    : options.quiet ? "warn"
    : "info";
  const logger = createLogger({ level, sink: deps.logSink });

  if (options.envFile !== undefined) {
    logger.debug(`Loading env file: ${options.envFile}`);
    try {
      await deps.envLoader.load(options.envFile);
    } catch (error: unknown) {
      logger.error(`Cannot load env file '${options.envFile}': ${getErrorMessage(error)}`);
      return 2;
    }
  }

  let target: R2Target;
  let cleaner: R2BucketCleaner;

  if (options.local) {
    const localUrl = options.localUrl ?? DEFAULT_LOCAL_URL;
    logger.debug(`Local Explorer API URL: ${localUrl}`);
    target = { bucketName, localUrl };
    cleaner = deps.localCleaner;
  } else {
    let accountId: string;
    let resolvedBucketName: string;
    if (options.terraform !== undefined) {
      let outputs: TerraformOutputMap;
      try {
        logger.debug(`Running: terraform -chdir=${options.terraform} output -json`);
        outputs = await deps.terraform.getOutputs(options.terraform);
      } catch (error: unknown) {
        logger.error(`Failed to read terraform outputs: ${getErrorMessage(error)}`);
        return 2;
      }
      const accountIdOutput = outputs.account_id;
      if (
        accountIdOutput?.type !== "string"
        || typeof accountIdOutput.value !== "string"
        || accountIdOutput.value === ""
      ) {
        logger.error("Terraform output 'account_id' is missing or not a string");
        return 2;
      }
      const bucketNameOutput = outputs.r2_bucket_name;
      if (
        bucketNameOutput?.type !== "string"
        || typeof bucketNameOutput.value !== "string"
        || bucketNameOutput.value === ""
      ) {
        logger.error("Terraform output 'r2_bucket_name' is missing or not a string");
        return 2;
      }
      accountId = accountIdOutput.value;
      resolvedBucketName = bucketNameOutput.value;
    } else {
      const value = options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
      if (value === undefined || value === "") {
        logger.error(
          "Missing credential: --account-id not provided and CLOUDFLARE_ACCOUNT_ID not set"
        );
        return 2;
      }
      accountId = value;
      resolvedBucketName = bucketName!;
    }
    const apiToken = options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
    if (apiToken === undefined || apiToken === "") {
      logger.error("Missing credential: --api-token not provided and CLOUDFLARE_API_TOKEN not set");
      return 2;
    }
    target = { bucketName: resolvedBucketName, accountId, apiToken };
    cleaner = deps.remoteCleaner;
  }

  let hasObjects: boolean;
  try {
    hasObjects = await cleaner.hasObjects(target);
  } catch (error: unknown) {
    logger.error(`Failed to check bucket contents: ${getErrorMessage(error)}`);
    return 3;
  }

  if (!hasObjects) {
    logger.info(`Bucket '${target.bucketName}' is already empty`);
    return 0;
  }

  process.stdout.write(`Bucket '${target.bucketName}' contains objects.\n\n`);
  if (!options.yes && !(await deps.prompter.confirm("Delete all objects? (y/N) "))) {
    logger.info("Deletion declined by operator");
    return 1;
  }

  try {
    await cleaner.empty(target);
  } catch (error: unknown) {
    logger.error(`Failed to empty bucket: ${getErrorMessage(error)}`);
    return 4;
  }

  logger.info(`Bucket '${target.bucketName}' is now empty`);
  return 0;
}
