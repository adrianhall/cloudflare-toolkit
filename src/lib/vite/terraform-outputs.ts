/**
 * @file `readTerraformOutputs`/`requireTerraformOutputs` — runtime helpers for bridging
 * `terraform output -json` into a `cloudflare.config.ts` file (the `cf`-CLI/`defineWorker` era
 * successor to the Wrangler-era `generate-wrangler --terraform` bridge documented in the
 * `cloudflare-terraform-best-practices` skill).
 *
 * Unlike `generate-wrangler`, which substitutes Terraform outputs into a template file as a
 * separate build step, `cloudflare.config.ts` is a real TypeScript module evaluated directly by
 * `cf dev`/`cf build`/`cf deploy` — there is no generation step to hook into. These helpers read
 * a gitignored `infra/outputs.json` (written by a project's own `postdeploy:<apply-script>` npm
 * hook, e.g. `terraform -chdir=infra output -json > infra/outputs.json`) directly with
 * `node:fs`, so a `defineWorker((ctx) => ...)` callback can branch on whether live Terraform
 * infrastructure is available.
 *
 * `readTerraformOutputs` is a soft-fail probe: it returns `undefined` on any failure (file
 * missing because `terraform apply` hasn't run yet, malformed JSON, an expected key missing or
 * non-string) rather than throwing, so a caller can choose between "live infra available" and
 * "local placeholder" modes. `requireTerraformOutputs` is the loud-fail counterpart for
 * production mode, throwing a ready-made, actionable error (naming the missing/incomplete path
 * and the caller-supplied `hint` command) instead of every consumer hand-writing the same throw.
 *
 * Depends on `../guards/index.js` (`throwIfNull`) per this repo's own "use the guards, don't
 * reinvent them" rule (AGENTS.md) — never the reverse.
 */
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { throwIfNull } from "../guards/index.js";

/** Default location of the Terraform outputs JSON file, relative to `process.cwd()`. */
const DEFAULT_OUTPUTS_PATH = "infra/outputs.json";

/**
 * Maps each key of the desired output shape `T` to the corresponding (typically snake_case)
 * Terraform output name declared in `outputs.tf`.
 */
export type TerraformOutputKeys<T extends Record<string, string>> = {
  [K in keyof T]: string;
};

/** Options shared by {@link readTerraformOutputs} and {@link requireTerraformOutputs}. */
export interface ReadTerraformOutputsOptions<T extends Record<string, string>> {
  /**
   * Maps each key of `T` to its Terraform output name, e.g. `{ workerName: "worker_name" }`.
   */
  keys: TerraformOutputKeys<T>;
  /**
   * Path to the Terraform outputs JSON file, resolved against `process.cwd()` if relative.
   *
   * @default "infra/outputs.json"
   */
  path?: string;
}

/** Options for {@link requireTerraformOutputs}. */
export interface RequireTerraformOutputsOptions<
  T extends Record<string, string>
> extends ReadTerraformOutputsOptions<T> {
  /**
   * A command the operator should run to produce/refresh the outputs file, interpolated into
   * the thrown error message, e.g. `"npm run deploy:infra"`.
   */
  hint: string;
}

/** Shape of a single entry in the JSON produced by `terraform output -json`. */
interface RawTerraformOutputValue {
  value: unknown;
  type?: unknown;
  sensitive?: boolean;
}

/**
 * Read and parse a Terraform outputs JSON file (produced by `terraform output -json`),
 * projecting it onto a typed, caller-named shape via `options.keys`. Returns `undefined` on any
 * failure — the file doesn't exist yet, its contents aren't valid JSON, or one of the mapped
 * output names is missing or not a string — rather than throwing, so callers can use it as a
 * soft-fail "is live infra available?" probe (typically to choose between real Terraform-backed
 * values and hermetic local-dev placeholders in a `cloudflare.config.ts` `defineWorker`
 * callback).
 *
 * Only `string`-valued Terraform outputs are supported, matching the scalar-output convention
 * documented in the `cloudflare-terraform-best-practices` skill.
 *
 * @param options - `keys` (required) mapping `T`'s keys to Terraform output names, and an
 *   optional `path` (defaults to `"infra/outputs.json"` resolved against `process.cwd()`).
 * @returns The projected outputs, or `undefined` if they could not be read.
 */
export function readTerraformOutputs<T extends Record<string, string>>(
  options: ReadTerraformOutputsOptions<T>
): T | undefined {
  try {
    const outputsPath = resolve(process.cwd(), options.path ?? DEFAULT_OUTPUTS_PATH);
    const parsed = JSON.parse(readFileSync(outputsPath, "utf-8")) as Record<
      string,
      RawTerraformOutputValue
    >;

    const outputs = {} as T;
    for (const [key, outputName] of Object.entries(options.keys) as [keyof T, string][]) {
      const value = parsed[outputName]?.value;
      if (typeof value !== "string") {
        return undefined;
      }
      outputs[key] = value as T[keyof T];
    }

    return outputs;
  } catch {
    return undefined;
  }
}

/**
 * Like {@link readTerraformOutputs}, but throws an actionable `Error` — naming the outputs path
 * and the caller-supplied `hint` command — instead of returning `undefined`. Intended for a
 * `cloudflare.config.ts` `defineWorker` callback's production branch, where missing/incomplete
 * Terraform outputs mean the deploy cannot proceed and should fail loudly rather than silently
 * falling back to placeholder values.
 *
 * @param options - Same as {@link readTerraformOutputs}, plus a required `hint` (a command the
 *   operator should run to produce/refresh the outputs file, e.g. `"npm run deploy:infra"`).
 * @returns The projected outputs.
 * @throws {Error} If the outputs could not be read (see {@link readTerraformOutputs}).
 */
export function requireTerraformOutputs<T extends Record<string, string>>(
  options: RequireTerraformOutputsOptions<T>
): T {
  const outputs = readTerraformOutputs(options);
  const path = options.path ?? DEFAULT_OUTPUTS_PATH;
  throwIfNull(
    outputs,
    `Terraform outputs are missing or incomplete at "${path}". Run \`${options.hint}\` `
      + "before building or deploying this Worker."
  );
  return outputs;
}
