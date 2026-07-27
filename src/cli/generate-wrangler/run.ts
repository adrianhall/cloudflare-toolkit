/** @file Orchestration for the `generate-wrangler` CLI. */
import { isAbsolute, resolve } from "node:path";
import { Command, CommanderError } from "commander";
import type { LogLevel, LogSink } from "../internal/logger.js";
import { createLogger } from "../internal/logger.js";
import type { TerraformRunner } from "../internal/terraform.js";
import { getErrorMessage, getValueDefault } from "../internal/utils.js";
import { scanMarkers, substituteTemplate, validateOutputs } from "./template.js";
import type { FileSystem } from "./types.js";

declare const CLI_VERSION: string;

/** Injected dependencies for `generate-wrangler`. */
export interface GenerateWranglerDeps {
  /** Terraform output reader. */
  terraform: TerraformRunner;
  /** Filesystem adapter. */
  fs: FileSystem;
  /** Optional test log sink. */
  logSink?: LogSink;
}

/** Runs `generate-wrangler` and returns its documented exit code. */
export async function run(argv: string[], deps: GenerateWranglerDeps): Promise<number> {
  const program = new Command()
    .name("generate-wrangler")
    .description("Generate wrangler.jsonc from terraform outputs and a template")
    .version(CLI_VERSION, "--version", "Print version and exit")
    .option("-c, --check", "Check for non-substituted values")
    .option("-d, --dir <dir>", "Directory containing input/output files", ".")
    .option("-f, --force", "Force write even if the output file already exists")
    .option("-i, --input <file>", "Input file", "wrangler.jsonc.tpl")
    .option("-o, --output <file>", "Output file", "wrangler.jsonc")
    .option("-q, --quiet", "Quiet logging (min level: warn)")
    .option("-t, --terraform <dir>", "Directory where terraform state files are", ".")
    .option("-v, --verbose", "Verbose logging (min level: debug)")
    .allowUnknownOption(false)
    .exitOverride();
  try {
    program.parse(argv);
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      return error.code === "commander.helpDisplayed" || error.code === "commander.version" ? 0 : 6;
    }
    process.stderr.write(`Internal error during argument parsing: ${String(error)}\n`);
    return 99;
  }
  const options = program.opts<{
    check?: boolean;
    dir: string;
    force?: boolean;
    input: string;
    output: string;
    quiet?: boolean;
    terraform: string;
    verbose?: boolean;
  }>();
  if (options.verbose && options.quiet) {
    process.stderr.write("Error: --verbose (-v) and --quiet (-q) are mutually exclusive\n");
    return 6;
  }
  const level: LogLevel =
    options.verbose ? "debug"
    : options.quiet ? "warn"
    : "info";
  const logger = createLogger({ level, sink: deps.logSink });
  const inputPath = isAbsolute(options.input) ? options.input : resolve(options.dir, options.input);
  const outputPath =
    isAbsolute(options.output) ? options.output : resolve(options.dir, options.output);
  if (inputPath === outputPath) {
    logger.error("Input and output paths must be different");
    return 6;
  }
  if (!(await deps.fs.directoryExists(options.terraform))) {
    logger.error(`Terraform directory does not exist: ${options.terraform}`);
    return 3;
  }
  let outputs: Awaited<ReturnType<TerraformRunner["getOutputs"]>>;
  try {
    logger.debug(`Running: terraform -chdir=${options.terraform} output -json`);
    outputs = await deps.terraform.getOutputs(options.terraform);
    const summary = Object.entries(outputs)
      .map(([key, value]) => `${key}:${value.type}`)
      .join(", ");
    logger.debug(`Terraform outputs: ${getValueDefault(summary, "(none)")}`);
  } catch (error: unknown) {
    logger.error(`Failed to read terraform outputs: ${getErrorMessage(error)}`);
    return 4;
  }
  let template: string;
  logger.debug(`Reading template: ${inputPath}`);
  try {
    template = await deps.fs.readFile(inputPath);
  } catch (error: unknown) {
    logger.error(`Cannot read input file '${inputPath}': ${getErrorMessage(error)}`);
    return 1;
  }
  if (options.check) {
    const markers = scanMarkers(template);
    logger.debug(`Template markers: ${getValueDefault(markers.join(", "), "(none)")}`);
    if (!validateOutputs(markers, outputs, logger).valid) return 5;
  }
  const result = substituteTemplate({ template, outputs, logger });
  if (!result.success) return result.exitCode;
  if ((await deps.fs.fileExists(outputPath)) && !options.force) {
    logger.error(`Output file already exists: ${outputPath} (use --force to overwrite)`);
    return 2;
  }
  logger.debug(`Writing output: ${outputPath}`);
  try {
    await deps.fs.writeFile(outputPath, result.content);
  } catch (error: unknown) {
    logger.error(`Cannot write output file '${outputPath}': ${getErrorMessage(error)}`);
    return 2;
  }
  logger.info(`Wrote ${outputPath}`);
  return 0;
}
