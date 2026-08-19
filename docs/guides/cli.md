# Command Line Tools

Installing `@adrianhall/cloudflare-toolkit` adds five binaries. They are package `bin` entries,
not JavaScript import subpaths.

| Command                   | Purpose                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `cf-access-policy`        | Reconcile reusable Access policies and self-hosted applications    |
| `generate-wrangler`       | Build `wrangler.jsonc` from a template and Terraform outputs       |
| `generate-wrangler-types` | Run `wrangler types` only when its output is stale                 |
| `destroy-containers`      | Remove matching container applications and OCI registry image tags |
| `empty-r2-bucket`         | Delete all objects in an R2 bucket before infrastructure teardown  |

## Deployment Workflow

A Terraform-managed project can wire the commands into npm lifecycle scripts:

```jsonc
{
  "scripts": {
    "provision": "terraform -chdir=infra apply",
    "postprovision": "generate-wrangler -cf -d src/worker -t infra",
    "generate:types": "generate-wrangler-types -d src/worker -- --strict-vars=false",
    "prebuild": "npm run generate:types",
    "build": "vite build",
    "preteardown:containers": "destroy-containers my-worker --env-file .env --yes",
    "preteardown:worker": "wrangler delete --force --config src/worker/wrangler.jsonc",
    "preteardown:r2": "empty-r2-bucket -t infra --env-file .env --yes",
    "preteardown": "run-s preteardown:containers preteardown:worker preteardown:r2",
    "teardown": "terraform -chdir=infra destroy"
  }
}
```

Use `--yes` only for an intentional non-interactive cleanup. The cleanup command otherwise asks
for confirmation.

For a project whose only separately provisioned infrastructure is Cloudflare Access, Terraform is
not required. Let `cf` deploy the Worker, then reconcile Access; remove Access before deleting the
Worker:

```jsonc
{
  "scripts": {
    "deploy": "cf deploy",
    "postdeploy": "cf-access-policy apply -c access.config.ts --yes",
    "preteardown": "cf-access-policy remove -c access.config.ts --yes",
    "teardown": "wrangler delete --force"
  }
}
```

## `cf-access-policy`

`cf-access-policy <apply|remove>` loads a TypeScript default export and reconciles Cloudflare
Access reusable policies and self-hosted applications by exact, unique `name`. It requires the
`cf@^0.6.0` peer. `cf` supplies both authentication and account context: set
`CLOUDFLARE_API_TOKEN`, or use an OAuth profile selected by `--profile`, the nearest directory
binding, or the default profile. The credential needs **Access: Apps and Policies Write**.

```ts
// access.config.ts
import { defineAccessConfig } from "@adrianhall/cloudflare-toolkit";

export default defineAccessConfig({
  policies: [
    {
      name: "example staff",
      decision: "allow",
      include: [{ email_domain: { domain: "example.com" } }],
      exclude: [{ email: { email: "suspended@example.com" } }],
      require: [{ country: { country_code: "US" } }],
      sessionDuration: "24h"
    }
  ],
  applications: [
    {
      name: "example app",
      domain: "app.example.com",
      destinations: [
        { type: "public", uri: "app.example.com/*" },
        { type: "public", uri: "app.example.com/api/*" }
      ],
      sessionDuration: "12h",
      policies: [{ name: "example staff", precedence: 1 }]
    },
    {
      name: "example admin",
      domain: "admin.example.com",
      destinations: [{ type: "public", uri: "admin.example.com/*" }],
      policies: [{ name: "example staff", precedence: 1 }]
    }
  ]
});
```

Policy `decision` is `"allow"`, `"deny"`, `"non_identity"`, or `"bypass"`; `include` must be
non-empty, while `exclude`, `require`, and policy/application `sessionDuration` are optional.
Applications are always `self_hosted`. Their optional destinations are public URI patterns, and
their policy references use configured policy names with unique positive precedence values. A
reusable policy can be shared by multiple applications, as above.

| Flag                  | Meaning                                                |
| --------------------- | ------------------------------------------------------ |
| `-c, --config <path>` | TypeScript config path (default `access.config.ts`)    |
| `--env-file <path>`   | Load dotenv values before `cf` resolves authentication |
| `--profile <name>`    | Select a named `cf` OAuth profile                      |
| `--dry-run`           | Print the plan without prompting or mutating           |
| `-y, --yes`           | Apply the printed plan without prompting               |
| `-q, --quiet`         | Emit warnings and errors only                          |
| `-v, --verbose`       | Emit debug logs                                        |
| `--help`              | Print help and exit                                    |
| `--version`           | Print the package version and exit                     |

`apply` discovers policies and applications once, then prints ordered `create`, `update`, or
`no-change` operations. It creates or updates policies before applications so configured policy
names can resolve to Cloudflare IDs. The command manages only the fields represented by the typed
config; exact matches are no-change.

`remove` is bounded to names present in the config. It never treats omission from the config as a
request to delete another account resource. Before prompting, it verifies each configured
policy's reported application count and refuses removal if a policy is linked to an unmanaged
application or has links it cannot verify. Approved removal deletes configured applications
before configured policies.

Both commands print the full plan first. A no-change plan and `--dry-run` return success without a
prompt; otherwise the default is an interactive confirmation. `--yes` is intended for reviewed
CI/deployment automation. Discovery and removal preflight are fail closed, and mutations execute
against the same snapshot used to produce the plan.

Exit codes:

- `0` help/version, no changes, dry run, or successful mutation,
- `1` declined by the operator,
- `2` environment-file or Access configuration failure,
- `3` `cf` authentication/account/discovery failure or unsafe removal preflight,
- `4` mutation failure,
- `6` argument error,
- `99` unexpected internal error.

The config is TypeScript, not JSONC. This command has no interpolation, generated output file,
direct REST credential flags, audience output, `--destroy` alias, or destination-overlap logic.
Use `remove` for bounded teardown and obtain Audience (AUD) Tags separately from each Access
application's overview when configuring runtime JWT validation.

## `generate-wrangler`

`generate-wrangler` replaces strict `{{output_name}}` markers in `wrangler.jsonc.tpl` and writes
`wrangler.jsonc`, reading the marker values from either `terraform output -json` (the default) or
a local JSON file (`--local`).

```jsonc
{
  "name": "{{worker_name}}",
  "account_id": "{{account_id}}",
  "d1_databases": [{ "binding": "DB", "database_id": "{{database_id}}" }]
}
```

Only `string` and `number` values are supported. Markers are case-sensitive and cannot contain
whitespace. Missing or null values are left unchanged with a warning; `--check` turns those
warnings into a validation failure before writing. Unsupported value types always fail. Verbose
substitution logs show `[REDACTED]` instead of values whose Terraform output has
`sensitive = true` (local-mode values are never marked sensitive).

| Flag                    | Meaning                                                         |
| ----------------------- | --------------------------------------------------------------- |
| `-c, --check`           | Validate every marker before substitution                       |
| `-d, --dir <dir>`       | Base input/output directory (default `.`)                       |
| `-f, --force`           | Overwrite an existing output                                    |
| `-i, --input <file>`    | Template path (default `wrangler.jsonc.tpl`)                    |
| `-l, --local <file>`    | Read marker values from a strict-JSON file instead of Terraform |
| `-o, --output <file>`   | Output path (default `wrangler.jsonc`)                          |
| `-t, --terraform <dir>` | Terraform state directory (default `.`)                         |
| `-q, --quiet`           | Emit warnings and errors only                                   |
| `-v, --verbose`         | Emit debug logs                                                 |

Exit codes:

- `0` success — in `--local` mode, this also covers the output already existing without
  `--force`, in which case nothing is read or written,
- `1` input read failure,
- `2` write failure, or (terraform mode only) the output already exists without `--force`,
- `3` missing Terraform directory or missing local variables file,
- `4` Terraform output failure, or local variables file read/parse failure,
- `5` check failure,
- `6` argument error, including `--local` combined with an explicit `--terraform`,
- `7` unsupported value type,
- `99` unexpected internal error.

### Local development

`--local <file>` is for running before local operations (`dev`, tests) where no Terraform state
exists yet. The file is a flat JSON object mapping marker names to values — not the nested
`terraform output -json` shape — and does not support JSONC comments or trailing commas. Only
`string` and `number` values can be substituted, exactly like Terraform mode; other JSON value
types are accepted by the file format but still fail with exit `7` if referenced by a marker.

```json
{
  "worker_name": "my-worker-dev",
  "account_id": "0123456789abcdef0123456789abcdef"
}
```

```sh
generate-wrangler --local local.vars.json -d src/worker
```

Unlike terraform mode, `--local` **never overwrites an existing `wrangler.jsonc`** unless
`--force` is also given — it exits `0` (not an error) and skips reading the variables file
entirely, so it is safe to run unconditionally from a `predev`/`pretest` script without clobbering
a `wrangler.jsonc` a prior `generate-wrangler -t infra` (or a previous `--local --force`) already
produced:

```jsonc
{
  "scripts": {
    "predev": "generate-wrangler --local local.vars.json -d src/worker",
    "dev": "vite dev"
  }
}
```

`--local` and an explicit `--terraform` are mutually exclusive (exit `6`); `--local` is exit `3`
if the file is missing, `4` if it cannot be read or fails to parse as strict JSON.

## `generate-wrangler-types`

This command wraps `wrangler types`. It compares the modification times of `wrangler.jsonc` and
`worker-configuration.d.ts`: a newer output is skipped with exit code `0`; a missing or stale
output is regenerated. `--force` always regenerates.

| Flag                  | Meaning                                                       |
| --------------------- | ------------------------------------------------------------- |
| `-c, --config <file>` | Wrangler config to watch (default `wrangler.jsonc`)           |
| `-d, --dir <dir>`     | Base directory for config/output paths (default `.`)          |
| `-f, --force`         | Bypass the freshness check                                    |
| `-o, --output <file>` | Output path (default `worker-configuration.d.ts`)             |
| `-q, --quiet`         | Emit warnings and errors only                                 |
| `-v, --verbose`       | Emit debug logs                                               |
| `--`                  | Forward every following argument verbatim to `wrangler types` |

```sh
generate-wrangler-types --force
generate-wrangler-types -c wrangler.staging.jsonc -o types/staging.d.ts
generate-wrangler-types -- --include-runtime=false --strict-vars=false
```

Exit codes:

- `0` fresh/success,
- `1` config missing,
- `2` Wrangler could not launch,
- `3` `wrangler types` failed,
- `6` argument error,
- `99` unexpected internal error.

## `destroy-containers`

This command discovers container applications and Cloudflare Registry image tags whose names or
image references contain the required worker name, prints the matches, then deletes image tags
before applications.

```sh
destroy-containers my-worker --env-file .env
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... destroy-containers my-worker --yes
```

| Flag                      | Meaning                                              |
| ------------------------- | ---------------------------------------------------- |
| `-a, --account-id <id>`   | Discouraged compatibility option; prefer environment |
| `-k, --api-token <token>` | Discouraged compatibility option; prefer environment |
| `--env-file <path>`       | Load dotenv defaults before credential resolution    |
| `-y, --yes`               | Skip confirmation                                    |
| `-q, --quiet`             | Emit warnings and errors only                        |
| `-v, --verbose`           | Emit debug logs                                      |

Matching deliberately preserves the source command's substring behavior. Use a specific worker
name and inspect the summary before confirming. Discovery is fail closed: application or registry
API/network failures produce nonzero exits before prompting or deleting anything. A successful
discovery with no matching resources exits `0`.

Exit codes:

- `0` nothing found/success,
- `1` declined,
- `2` credential failure,
- `3` application discovery/deletion failure,
- `4` registry discovery/deletion failure,
- `5` both resource classes failed discovery/deletion,
- `6` argument error,
- `99` unexpected internal error.

Cloudflare currently documents `wrangler containers images delete` as the normal interactive
image cleanup path. This command retains the direct application and OCI adapters so one
non-interactive preteardown step can clean both resource types.

## `empty-r2-bucket`

This command probes an R2 bucket for at least one object (never counting or listing every key),
prints a summary, then empties it through a mode-appropriate adapter. Exactly one of three modes
is resolved per invocation: standalone remote, Terraform-driven remote, or local Miniflare.

```sh
# Standalone remote, loading credentials from .env
empty-r2-bucket application-exports --env-file .env

# Terraform-provisioned bucket, reading account_id and r2_bucket_name outputs
empty-r2-bucket --terraform infra --env-file .env --yes

# Local Miniflare bucket via a running Wrangler or Vite dev server
empty-r2-bucket application-exports --local
empty-r2-bucket application-exports --local --local-url http://localhost:8787/cdn-cgi/explorer/api
```

| Flag                      | Meaning                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `-a, --account-id <id>`   | Cloudflare account ID; prefer `CLOUDFLARE_ACCOUNT_ID`                                       |
| `-k, --api-token <token>` | Cloudflare API token; prefer `CLOUDFLARE_API_TOKEN` or `--env-file`                         |
| `--env-file <path>`       | Load dotenv defaults before resolving remote credentials                                    |
| `-t, --terraform <dir>`   | Read `account_id` and `r2_bucket_name` from `terraform output -json`                        |
| `--local`                 | Use the Miniflare Local Explorer API instead of the Cloudflare REST API                     |
| `--local-url <url>`       | Override the Local Explorer API URL (default: `http://localhost:5173/cdn-cgi/explorer/api`) |
| `-y, --yes`               | Skip the destructive confirmation prompt                                                    |
| `-q, --quiet`             | Emit warnings and errors only                                                               |
| `-v, --verbose`           | Emit debug logs                                                                             |

`bucket-name` is a required positional argument in standalone remote and local modes, and is
omitted in Terraform mode (`--terraform` and a positional `bucket-name` are mutually exclusive).
`--local` requires a positional `bucket-name` and is mutually exclusive with `--terraform`,
`--account-id`, `--api-token`, and `--env-file`; local mode sends no Cloudflare credentials.

The production adapter issues one `GET .../r2/buckets/{bucket}/objects?per_page=1` probe, then one
`DELETE .../objects?prefix=` request, then polls the same probe with bounded backoff until
Cloudflare confirms the bucket is empty — the initial `DELETE` response is treated as acceptance,
not completion. This bearer-token-only flow works with just the `Workers R2 Storage Write`
permission group; it never uses the S3-compatible API or AWS Signature Version 4. The local
adapter instead paginates and batch-deletes through Miniflare's Local Explorer API, since that API
has no prefix-delete operation.

Exit codes:

- `0` bucket already empty, or emptying completed and final verification passed,
- `1` declined,
- `2` environment file, credential, Terraform directory/output, or mode-resolution failure,
- `3` the initial non-empty check failed or returned an invalid/incomplete response,
- `4` emptying, local batch deletion, completion polling, or final verification failed,
- `6` argument error,
- `99` unexpected internal error.

## Skills

Install the repository skills with:

```sh
npx skills add adrianhall/cloudflare-toolkit
```

Use `cloudflare-deploy-scripts` for the full provision/deploy/teardown pattern and
`cloudflare-terraform-best-practices` for Terraform provider schemas, token setup, and ordering.
The general `cloudflare-toolkit` skill stays focused on library APIs and
`generate-wrangler-types`.
