/** @file Local (non-Terraform) variable source for `generate-wrangler`. */
import type { TerraformOutputEntry, TerraformOutputMap } from "../internal/terraform.js";
import { getErrorMessage } from "../internal/utils.js";

/** Returns the {@link TerraformOutputEntry} `type` label for a parsed JSON value. */
function typeOf(value: unknown): TerraformOutputEntry["type"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "list";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "bool";
    default:
      return "object";
  }
}

/**
 * Parses a strict-JSON local variables file into a {@link TerraformOutputMap}, so `--local`
 * shares `template.ts`'s marker scanning, validation, and substitution unchanged with
 * `--terraform`.
 *
 * The file is a flat `name -> value` map (not the nested `terraform output -json` shape).
 * Every value is treated as non-sensitive. Comments and trailing commas (JSONC) are not
 * supported — the file must be strict JSON.
 *
 * @throws {Error} if the content is not valid JSON, or the parsed value is not a JSON object.
 */
export function parseLocalVariables(content: string): TerraformOutputMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new Error(
      `Local variables file is not valid JSON (comments and trailing commas are not supported): ${getErrorMessage(error)}`
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Local variables file must contain a JSON object of name -> value pairs");
  }
  const outputs: TerraformOutputMap = {};
  for (const [name, value] of Object.entries(parsed)) {
    outputs[name] = { value, type: typeOf(value), sensitive: false };
  }
  return outputs;
}
