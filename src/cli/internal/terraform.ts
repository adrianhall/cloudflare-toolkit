/** @file Private Terraform CLI adapter shared by deployment-related bins. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getErrorMessage } from "./utils.js";

/** One entry from `terraform output -json`. */
export interface TerraformOutputEntry {
  /** Output value. */
  value: unknown;
  /** Terraform type name. */
  type: string;
  /** Whether Terraform marks the value sensitive. */
  sensitive: boolean;
}

/** Complete output map from `terraform output -json`. */
export type TerraformOutputMap = Record<string, TerraformOutputEntry>;

/** Injectable Terraform output reader. */
export interface TerraformRunner {
  /** Reads outputs from the Terraform working directory. */
  getOutputs(dir: string): Promise<TerraformOutputMap>;
}

/** Injectable process runner used to test Terraform invocation. */
export type ExecRunner = (command: string, args: string[]) => Promise<{ stdout: string }>;

/** Error raised when Terraform execution or output parsing fails. */
export class TerraformError extends Error {
  /** Creates a Terraform-specific error. */
  constructor(message: string) {
    super(message);
    this.name = "TerraformError";
  }
}

const execFileAsync = promisify(execFile);

const defaultExecRunner: ExecRunner = (command, args) => execFileAsync(command, args);

/** Creates a runner for `terraform -chdir=<dir> output -json`. */
export function createTerraformRunner(execRunner: ExecRunner = defaultExecRunner): TerraformRunner {
  return {
    async getOutputs(dir) {
      let stdout: string;
      try {
        ({ stdout } = await execRunner("terraform", [`-chdir=${dir}`, "output", "-json"]));
      } catch (error: unknown) {
        throw new TerraformError(`Failed to execute terraform: ${getErrorMessage(error)}`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        throw new TerraformError("Terraform output could not be parsed as JSON");
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new TerraformError("Terraform output is not a JSON object");
      }
      return parsed as TerraformOutputMap;
    }
  };
}
