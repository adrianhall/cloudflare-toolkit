# Command Line Tools

Installing `@adrianhall/cloudflare-toolkit` adds three binaries. They are package `bin` entries,
not JavaScript import subpaths.

| Command                   | Purpose                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `generate-wrangler`       | Build `wrangler.jsonc` from a template and Terraform outputs       |
| `generate-wrangler-types` | Run `wrangler types` only when its output is stale                 |
| `destroy-containers`      | Remove matching container applications and OCI registry image tags |

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
    "preteardown": "run-s preteardown:containers preteardown:worker",
    "teardown": "terraform -chdir=infra destroy"
  }
}
```

Use `--yes` only for an intentional non-interactive cleanup. The cleanup command otherwise asks
for confirmation.

## `generate-wrangler`

`generate-wrangler` reads `terraform output -json`, replaces strict `{{output_name}}` markers in
`wrangler.jsonc.tpl`, and writes `wrangler.jsonc`.

```jsonc
{
  "name": "{{worker_name}}",
  "account_id": "{{account_id}}",
  "d1_databases": [{ "binding": "DB", "database_id": "{{database_id}}" }]
}
```

Only Terraform `string` and `number` outputs are supported. Markers are case-sensitive and cannot
contain whitespace. Missing or null outputs are left unchanged with a warning; `--check` turns
those warnings into a validation failure before writing. Unsupported output types always fail.
Verbose substitution logs show `[REDACTED]` instead of values whose Terraform output has
`sensitive = true`.

| Flag                    | Meaning                                      |
| ----------------------- | -------------------------------------------- |
| `-c, --check`           | Validate every marker before substitution    |
| `-d, --dir <dir>`       | Base input/output directory (default `.`)    |
| `-f, --force`           | Overwrite an existing output                 |
| `-i, --input <file>`    | Template path (default `wrangler.jsonc.tpl`) |
| `-o, --output <file>`   | Output path (default `wrangler.jsonc`)       |
| `-t, --terraform <dir>` | Terraform state directory (default `.`)      |
| `-q, --quiet`           | Emit warnings and errors only                |
| `-v, --verbose`         | Emit debug logs                              |

Exit codes:

- `0` success,
- `1` input read failure,
- `2` output exists/write failure,
- `3` missing Terraform directory,
- `4` Terraform output failure,
- `5` check failure,
- `6` argument error,
- `7` unsupported Terraform type,
- `99` unexpected internal error.

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

## Skills

Install the repository skills with:

```sh
npx skills add adrianhall/cloudflare-toolkit
```

Use `cloudflare-deploy-scripts` for the full provision/deploy/teardown pattern and
`cloudflare-terraform-best-practices` for Terraform provider schemas, token setup, and ordering.
The general `cloudflare-toolkit` skill stays focused on library APIs and
`generate-wrangler-types`.
