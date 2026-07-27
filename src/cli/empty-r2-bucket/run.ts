/** @file Orchestration for the `empty-r2-bucket` CLI. */
import { Command, CommanderError } from "commander";
import { getR2Endpoint } from "../internal/cloudflare.js";
import type { R2Client, R2Credentials, R2Jurisdiction } from "../internal/cloudflare.js";
import type { LogLevel, LogSink } from "../internal/logger.js";
import { createLogger } from "../internal/logger.js";
import type { TerraformRunner } from "../internal/terraform.js";
import type { EnvLoader, Prompter } from "../internal/utils.js";
import { getErrorMessage, getValueDefault } from "../internal/utils.js";
import { extractR2Credentials, isR2Jurisdiction } from "./terraform.js";
import type { FileSystem } from "./types.js";

declare const CLI_VERSION: string;

const CREDENTIAL_FIELDS: readonly {
  cliOpt: "accountId" | "bucket" | "accessKeyId" | "secretAccessKey";
  envVar: string;
  credField: Exclude<keyof R2Credentials, "jurisdiction">;
  label: string;
}[] = [
  {
    cliOpt: "accountId",
    envVar: "CLOUDFLARE_ACCOUNT_ID",
    credField: "accountId",
    label: "account-id"
  },
  { cliOpt: "bucket", envVar: "R2_BUCKET_NAME", credField: "bucketName", label: "bucket" },
  {
    cliOpt: "accessKeyId",
    envVar: "R2_ACCESS_KEY_ID",
    credField: "accessKeyId",
    label: "access-key-id"
  },
  {
    cliOpt: "secretAccessKey",
    envVar: "R2_SECRET_ACCESS_KEY",
    credField: "secretAccessKey",
    label: "secret-access-key"
  }
];

/** Injected dependencies for `empty-r2-bucket`. */
export interface EmptyR2BucketDeps {
  /** Terraform output reader. */
  terraform: TerraformRunner;
  /** R2 object adapter. */
  r2: R2Client;
  /** Confirmation prompt. */
  prompter: Prompter;
  /** Dotenv loader. */
  envLoader: EnvLoader;
  /** Filesystem adapter. */
  fs: FileSystem;
  /** Optional test log sink. */
  logSink?: LogSink;
}

/** Runs `empty-r2-bucket` and returns its documented exit code. */
export async function run(argv: string[], deps: EmptyR2BucketDeps): Promise<number> {
  const program = new Command()
    .name("empty-r2-bucket")
    .description("Delete all objects from an R2 bucket (preteardown step for terraform destroy)")
    .version(CLI_VERSION, "--version", "Print version and exit")
    .option(
      "-t, --terraform [dir]",
      "Read all credentials from terraform output (default dir: '.')"
    )
    .option("--account-id <id>", "Cloudflare account ID")
    .option("--bucket <name>", "R2 bucket name")
    .option("--access-key-id <id>", "R2 S3-compatible access key ID")
    .option("--secret-access-key <key>", "R2 S3-compatible secret access key")
    .option("--jurisdiction <jurisdiction>", "R2 jurisdiction: auto, eu, or fedramp", undefined)
    .option("--env-file <path>", "Load environment variables from a dotenv file before resolution")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-q, --quiet", "Quiet logging (min level: warn)")
    .option("-v, --verbose", "Verbose logging (min level: debug)")
    .allowUnknownOption(false)
    .exitOverride();
  let options: {
    terraform?: string | true;
    accountId?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    jurisdiction?: string;
    envFile?: string;
    yes?: boolean;
    quiet?: boolean;
    verbose?: boolean;
  };
  try {
    program.parse(argv);
    options = program.opts();
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
  const level: LogLevel =
    options.verbose ? "debug"
    : options.quiet ? "warn"
    : "info";
  const logger = createLogger({ level, sink: deps.logSink });
  let cliJurisdiction: R2Jurisdiction | undefined;
  if (options.jurisdiction !== undefined) {
    if (!isR2Jurisdiction(options.jurisdiction)) {
      logger.error("--jurisdiction must be one of: auto, eu, fedramp");
      return 6;
    }
    cliJurisdiction = options.jurisdiction;
  }
  if (options.envFile !== undefined) {
    logger.debug(`Loading env file: ${options.envFile}`);
    try {
      await deps.envLoader.load(options.envFile);
    } catch (error: unknown) {
      logger.error(`Cannot load env file '${options.envFile}': ${getErrorMessage(error)}`);
      return 2;
    }
  }
  const hasTerraform = options.terraform !== undefined;
  const hasPerValue = CREDENTIAL_FIELDS.some(({ cliOpt }) => options[cliOpt] !== undefined);
  if (hasTerraform && hasPerValue) {
    logger.error(
      "--terraform and per-value credential arguments (--account-id, --bucket, --access-key-id, --secret-access-key) are mutually exclusive"
    );
    return 6;
  }
  let credentials: R2Credentials;
  if (hasTerraform) {
    const directory = options.terraform === true ? "." : options.terraform!;
    logger.debug(`Credential mode: terraform (dir: ${directory})`);
    if (!(await deps.fs.directoryExists(directory))) {
      logger.error(`Terraform directory does not exist: ${directory}`);
      return 2;
    }
    logger.debug(`Running: terraform -chdir=${directory} output -json`);
    let outputs: Awaited<ReturnType<TerraformRunner["getOutputs"]>>;
    try {
      outputs = await deps.terraform.getOutputs(directory);
      const summary = Object.entries(outputs)
        .map(([key, value]) => `${key}:${value.type}`)
        .join(", ");
      logger.debug(`Terraform outputs: ${getValueDefault(summary, "(none)")}`);
    } catch (error: unknown) {
      logger.error(`Failed to read terraform outputs: ${getErrorMessage(error)}`);
      return 2;
    }
    try {
      credentials = extractR2Credentials(outputs);
      if (cliJurisdiction !== undefined) credentials.jurisdiction = cliJurisdiction;
    } catch (error: unknown) {
      logger.error(`Terraform credential extraction failed: ${getErrorMessage(error)}`);
      return 2;
    }
  } else {
    logger.debug("Credential mode: per-value");
    const result: Partial<R2Credentials> = {};
    for (const { cliOpt, envVar, credField, label } of CREDENTIAL_FIELDS) {
      const cliValue = options[cliOpt];
      const value = cliValue ?? process.env[envVar];
      if (value === undefined || value === "") {
        logger.error(`Missing credential: --${label} not provided and ${envVar} not set`);
        return 2;
      }
      logger.debug(
        cliValue !== undefined ? `${label}: source=cli-arg` : `${label}: source=env-var (${envVar})`
      );
      result[credField] = value;
    }
    const configuredJurisdiction = cliJurisdiction ?? process.env.R2_JURISDICTION ?? "auto";
    if (!isR2Jurisdiction(configuredJurisdiction)) {
      logger.error("R2_JURISDICTION must be one of: auto, eu, fedramp");
      return 2;
    }
    credentials = {
      ...(result as Omit<R2Credentials, "jurisdiction">),
      jurisdiction: configuredJurisdiction
    };
  }
  logger.debug(`S3 endpoint: ${getR2Endpoint(credentials.accountId, credentials.jurisdiction)}`);
  let keys: string[];
  try {
    keys = await deps.r2.listAllObjects(credentials);
  } catch (error: unknown) {
    logger.error(
      `Failed to list objects in bucket '${credentials.bucketName}': ${getErrorMessage(error)}`
    );
    return 3;
  }
  if (keys.length === 0) {
    logger.info(`Bucket '${credentials.bucketName}' is already empty`);
    return 0;
  }
  if (
    !options.yes
    && !(await deps.prompter.confirm(
      `${keys.length} object(s) in "${credentials.bucketName}". Delete all? (y/N) `
    ))
  ) {
    logger.info("Deletion declined by operator");
    return 1;
  }
  logger.info(`Deleting ${keys.length} object(s) from '${credentials.bucketName}'...`);
  let deleted: number;
  let errors: number;
  try {
    ({ deleted, errors } = await deps.r2.deleteObjects(credentials, keys));
  } catch (error: unknown) {
    logger.error(`Failed to delete objects: ${getErrorMessage(error)}`);
    return 4;
  }
  logger.info(`Deleted ${deleted}/${keys.length}`);
  if (errors > 0 || deleted !== keys.length) {
    logger.error(`${keys.length - deleted} object(s) failed to delete`);
    return 4;
  }
  let remainingKeys: string[];
  try {
    remainingKeys = await deps.r2.listAllObjects(credentials);
  } catch (error: unknown) {
    logger.error(`Failed to verify bucket is empty: ${getErrorMessage(error)}`);
    return 4;
  }
  if (remainingKeys.length > 0) {
    logger.error(`${remainingKeys.length} object(s) remain after deletion`);
    return 4;
  }
  logger.info(`All objects deleted from '${credentials.bucketName}'`);
  return 0;
}
