/** @file R2 credential extraction from Terraform outputs. */
import type { R2Credentials, R2Jurisdiction } from "../internal/cloudflare.js";
import type { TerraformOutputMap } from "../internal/terraform.js";

const FIELD_MAP: readonly {
  tfKey: string;
  credField: Exclude<keyof R2Credentials, "jurisdiction">;
}[] = [
  { tfKey: "account_id", credField: "accountId" },
  { tfKey: "r2_bucket_name", credField: "bucketName" },
  { tfKey: "r2_token_id", credField: "accessKeyId" },
  { tfKey: "r2_token_value", credField: "secretAccessKey" }
];

/** Extracts the four required string credentials from Terraform output. */
export function extractR2Credentials(outputs: TerraformOutputMap): R2Credentials {
  const result: Partial<R2Credentials> = {};
  for (const { tfKey, credField } of FIELD_MAP) {
    const value = outputs[tfKey]?.value;
    if (value === null || value === undefined) {
      throw new Error(`Required terraform output '${tfKey}' is missing or null`);
    }
    if (typeof value !== "string") {
      throw new Error(`Required terraform output '${tfKey}' must be a string, got ${typeof value}`);
    }
    result[credField] = value;
  }
  const jurisdiction = outputs.r2_jurisdiction?.value ?? "auto";
  if (!isR2Jurisdiction(jurisdiction)) {
    throw new Error(
      "Optional terraform output 'r2_jurisdiction' must be one of: auto, eu, fedramp"
    );
  }
  return { ...(result as Omit<R2Credentials, "jurisdiction">), jurisdiction };
}

/** Checks whether a value is a supported R2 jurisdiction. */
export function isR2Jurisdiction(value: unknown): value is R2Jurisdiction {
  return value === "auto" || value === "eu" || value === "fedramp";
}
