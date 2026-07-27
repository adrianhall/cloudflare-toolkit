/** @file Orchestration for the `destroy-containers` CLI. */
import { Command, CommanderError } from "commander";
import type { ContainersApi, RegistryClient, RepoInfo } from "../internal/cloudflare.js";
import type { LogLevel, LogSink } from "../internal/logger.js";
import { createLogger } from "../internal/logger.js";
import type { EnvLoader, Prompter } from "../internal/utils.js";
import { getErrorMessage } from "../internal/utils.js";

declare const CLI_VERSION: string;

const CREDENTIAL_FIELDS = [
  { cliOpt: "accountId" as const, envVar: "CLOUDFLARE_ACCOUNT_ID", label: "account-id" },
  { cliOpt: "apiToken" as const, envVar: "CLOUDFLARE_API_TOKEN", label: "api-token" }
];

/** Injected dependencies for `destroy-containers`. */
export interface DestroyContainersDeps {
  /** Container application API. */
  containers: ContainersApi;
  /** OCI registry adapter. */
  registry: RegistryClient;
  /** Confirmation prompt. */
  prompter: Prompter;
  /** Dotenv loader. */
  envLoader: EnvLoader;
  /** Optional test log sink. */
  logSink?: LogSink;
}

/** Runs `destroy-containers` and returns its documented exit code. */
export async function run(argv: string[], deps: DestroyContainersDeps): Promise<number> {
  const program = new Command()
    .name("destroy-containers")
    .description(
      "Delete container applications and registry images for a worker (preteardown step)"
    )
    .version(CLI_VERSION, "--version", "Print version and exit")
    .argument("<worker-name>", "Worker name to filter container resources")
    .option("-a, --account-id <id>", "Cloudflare account ID (env: CLOUDFLARE_ACCOUNT_ID)")
    .option(
      "-k, --api-token <token>",
      "Compatibility option; prefer CLOUDFLARE_API_TOKEN or --env-file"
    )
    .option("--env-file <path>", "Load environment variables from a dotenv file before resolution")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-q, --quiet", "Quiet logging (min level: warn)")
    .option("-v, --verbose", "Verbose logging (min level: debug)")
    .allowUnknownOption(false)
    .exitOverride();
  let options: {
    accountId?: string;
    apiToken?: string;
    envFile?: string;
    yes?: boolean;
    quiet?: boolean;
    verbose?: boolean;
  };
  let workerName: string;
  try {
    program.parse(argv);
    options = program.opts();
    workerName = program.args[0];
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
  if (options.envFile !== undefined) {
    logger.debug(`Loading env file: ${options.envFile}`);
    try {
      await deps.envLoader.load(options.envFile);
    } catch (error: unknown) {
      logger.error(`Cannot load env file '${options.envFile}': ${getErrorMessage(error)}`);
      return 2;
    }
  }
  const credentials: Partial<Record<"accountId" | "apiToken", string>> = {};
  for (const { cliOpt, envVar, label } of CREDENTIAL_FIELDS) {
    const value = options[cliOpt] ?? process.env[envVar];
    if (value === undefined || value === "") {
      logger.error(`Missing credential: --${label} not provided and ${envVar} not set`);
      return 2;
    }
    logger.debug(
      options[cliOpt] !== undefined ?
        `${label}: source=cli-arg`
      : `${label}: source=env-var (${envVar})`
    );
    credentials[cliOpt] = value;
  }
  const accountId = credentials.accountId!;
  const apiToken = credentials.apiToken!;
  let applications: Awaited<ReturnType<ContainersApi["listApplications"]>> = [];
  let appDiscoveryFailed = false;
  try {
    applications = await deps.containers.listApplications(accountId, apiToken);
  } catch (error: unknown) {
    appDiscoveryFailed = true;
    logger.error(`Container application discovery failed: ${getErrorMessage(error)}`);
  }
  const matchedApps = applications.filter(
    (application) =>
      application.name?.includes(workerName) === true
      || application.image?.includes(workerName) === true
  );
  logger.debug(
    `Applications: ${applications.length} total, ${matchedApps.length} matching '${workerName}'`
  );
  let repositories: RepoInfo[] = [];
  let registryAuth = "";
  let registryDiscoveryFailed = false;
  try {
    registryAuth = await deps.containers.getRegistryCredentials(accountId, apiToken);
    repositories = await deps.registry.listRepos(registryAuth, workerName);
  } catch (error: unknown) {
    registryDiscoveryFailed = true;
    logger.error(`Registry discovery failed: ${getErrorMessage(error)}`);
  }
  if (appDiscoveryFailed || registryDiscoveryFailed) {
    if (appDiscoveryFailed && registryDiscoveryFailed) return 5;
    return appDiscoveryFailed ? 3 : 4;
  }
  const tagCount = repositories.reduce((total, repository) => total + repository.tags.length, 0);
  if (matchedApps.length === 0 && tagCount === 0) {
    logger.info(
      `No container applications or image tags found for '${workerName}' - nothing to clean up`
    );
    return 0;
  }
  const summary = [
    `Found ${matchedApps.length} container application(s) and ${tagCount} image tag(s) to delete:`,
    ...matchedApps.map((application) => `  Container app: ${application.name ?? application.id}`),
    ...repositories.flatMap((repository) =>
      repository.tags.map((tag) => `  Image: ${repository.name}:${tag}`)
    )
  ];
  process.stdout.write(`${summary.join("\n")}\n\n`);
  if (!options.yes && !(await deps.prompter.confirm("Delete all? (y/N) "))) {
    logger.info("Deletion declined by operator");
    return 1;
  }
  let tagFailures = 0;
  for (const repository of repositories) {
    for (const tag of repository.tags) {
      logger.info(`Deleting image tag: ${repository.name}:${tag}`);
      if (!(await deps.registry.deleteTag(registryAuth, repository.name, tag))) tagFailures++;
    }
  }
  let appFailures = 0;
  for (const application of matchedApps) {
    logger.info(`Deleting container application: ${application.name ?? application.id}`);
    if (!(await deps.containers.deleteApplication(accountId, apiToken, application.id)))
      appFailures++;
  }
  logger.debug(
    `Summary: apps=${matchedApps.length - appFailures}/${matchedApps.length}, tags=${tagCount - tagFailures}/${tagCount}`
  );
  if (appFailures === 0 && tagFailures === 0) {
    logger.info("All container resources deleted successfully");
    return 0;
  }
  if (appFailures > 0 && tagFailures > 0) {
    logger.error(`${appFailures} application(s) and ${tagFailures} image tag(s) failed to delete`);
    return 5;
  }
  if (appFailures > 0) {
    logger.error(`${appFailures} application(s) failed to delete`);
    return 3;
  }
  logger.error(`${tagFailures} image tag(s) failed to delete`);
  return 4;
}
