/** @file Strict Terraform-output template substitution for `generate-wrangler`. */
import type { Logger } from "../internal/logger.js";
import type { TerraformOutputMap } from "../internal/terraform.js";

/** Strict template marker grammar. */
export const MARKER_REGEX = /\{\{([A-Za-z_][A-Za-z0-9_-]*)\}\}/g;

/** One check-mode validation failure. */
export interface ValidationError {
  /** Failure category. */
  kind: "missing" | "invalid-type";
  /** Marker name. */
  name: string;
  /** Invalid Terraform type, when applicable. */
  type?: string;
}

/** Result of validating all referenced markers. */
export interface ValidationResult {
  /** Whether every marker can be substituted. */
  valid: boolean;
  /** Collected failures. */
  errors: ValidationError[];
}

/** Result of template substitution. */
export type SubstituteResult =
  { success: true; content: string } | { success: false; exitCode: number };

/** Returns unique strict marker names in first-occurrence order. */
export function scanMarkers(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(new RegExp(MARKER_REGEX.source, "g"))) found.add(match[1]);
  return [...found];
}

/** Validates every marker and reports all failures at once. */
export function validateOutputs(
  markers: string[],
  outputs: TerraformOutputMap,
  logger: Logger
): ValidationResult {
  const errors: ValidationError[] = [];
  for (const name of markers) {
    const entry = outputs[name];
    if (entry === undefined || entry.value === null) errors.push({ kind: "missing", name });
    else if (entry.type !== "string" && entry.type !== "number")
      errors.push({ kind: "invalid-type", name, type: entry.type });
  }
  if (errors.length > 0) {
    logger.error(
      `Template validation failed: ${errors
        .map((error) =>
          error.kind === "missing" ?
            `${error.name} (missing or null)`
          : `${error.name} (type: ${error.type})`
        )
        .join(", ")}`
    );
  }
  return { valid: errors.length === 0, errors };
}

/** Substitutes string and number outputs, preserving missing markers verbatim. */
export function substituteTemplate(options: {
  template: string;
  outputs: TerraformOutputMap;
  logger: Logger;
}): SubstituteResult {
  const { template, outputs, logger } = options;
  let invalidType = false;
  const content = template.replace(new RegExp(MARKER_REGEX.source, "g"), (_, name: string) => {
    const entry = outputs[name];
    if (entry === undefined || entry.value === null) {
      logger.warn(`Variable '${name}' is missing or null - leaving marker unchanged`);
      return `{{${name}}}`;
    }
    if (entry.type === "string" || entry.type === "number") {
      // The Terraform type metadata is validated immediately above.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const value = String(entry.value);
      logger.debug(`Substituting ${name} -> ${entry.sensitive ? "[REDACTED]" : value}`);
      return value;
    }
    logger.error(`Variable '${name}' has unsupported type '${entry.type}'; cannot substitute`);
    invalidType = true;
    return `{{${name}}}`;
  });
  return invalidType ? { success: false, exitCode: 7 } : { success: true, content };
}
