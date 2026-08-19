---
name: cloudflare-deploy-scripts
description: CLI tools and npm-script orchestration for deploying Cloudflare Workers projects with @adrianhall/cloudflare-toolkit. Covers cf-native Access policy/application reconciliation, the Terraform provision/deploy/teardown pattern, generate-wrangler templating, type freshness, Containers and R2 cleanup, safety rules, and npm scripts. Load when wiring deployment scripts for a Cloudflare Workers project. For Terraform schema and service patterns, load the sibling `cloudflare-terraform-best-practices` skill.
---

# Cloudflare Deploy Scripts: CLI Tools and npm-Script Orchestration

This skill describes the **CLI tools** shipped by `@adrianhall/cloudflare-toolkit` and the **npm script wiring** that ties them together with Terraform and Wrangler to deploy a Cloudflare Workers project.

The CLIs:

- **`cf-access-policy`** — reconciles reusable Cloudflare Access policies
  and self-hosted applications from typed TypeScript configuration through
  the `cf` CLI.
- **`generate-wrangler`** — substitutes Terraform outputs into a
  `wrangler.jsonc.tpl` template, producing a ready-to-use
  `wrangler.jsonc`.
- **`generate-wrangler-types`** — runs `wrangler types` only when
  `wrangler.jsonc` has changed (cheap pre-script).
- **`destroy-containers`** — deletes container applications and OCI
  registry images that `wrangler deploy` created but Terraform cannot
  see.
- **`empty-r2-bucket`** — deletes every object in an R2 bucket before
  `terraform destroy`, since the R2 API refuses to delete a non-empty
  bucket. Works with only the `Workers R2 Storage Write` permission
  group — no S3-compatible access key ID/secret access key pair
  required.

> **Terraform schema, HCL conventions, token model, per-service patterns, and teardown ordering principles live in the sibling `cloudflare-terraform-best-practices` skill.** Load it before writing any `cloudflare_*` resource block. This skill assumes the Terraform stack is already designed correctly and focuses on the CLI-side orchestration.

## Access-only workflow without Terraform

When Cloudflare Access is the only separately provisioned infrastructure,
use `cf-access-policy` and `cf deploy`; Terraform is not required. The
required `cf@^0.6.0` peer owns authentication and account context. It first
uses `CLOUDFLARE_API_TOKEN`, otherwise the OAuth profile selected by
`--profile`, the nearest directory binding, or the default profile. The
credential needs **Access: Apps and Policies Write**.

Define reusable policies once and link them by name from one or more
self-hosted applications:

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

The command is exactly `cf-access-policy <apply|remove>`. Its options are:

```text
-c, --config <path>  TypeScript config (default: access.config.ts)
--env-file <path>    Load dotenv values before cf resolves authentication
--profile <name>     Select a named cf OAuth profile
--dry-run            Print the plan without prompting or mutation
-y, --yes            Apply the printed plan without prompting
-q, --quiet          Warn/error logging only
-v, --verbose        Debug logging
--help               Print help
--version            Print the package version
```

`apply` reconciles exact unique names and reports `create`, `update`, or
`no-change`, applying policies before applications. `remove` deletes only
configured names, applications before policies. Before any removal it
verifies reusable-policy application counts and refuses unmanaged or
unverifiable links. Discovery and preflight failures happen before the
prompt and before all mutation. Both commands print a plan; no-change and
`--dry-run` do not prompt, while `--yes` is suitable for reviewed automation.

Exit codes are `0` success/help/version/dry run, `1` declined, `2` env or
config failure, `3` discovery/auth/account or unsafe-removal preflight, `4`
mutation failure, `6` argument error, and `99` unexpected internal failure.

The input is TypeScript, not JSONC. There is no interpolation, output file,
direct REST credential option, audience output, `--destroy`, or overlap
logic. Application Audience (AUD) Tags must be obtained separately for
runtime JWT validation.

Wire Access after Worker deployment and remove it before Worker deletion:

```json
{
  "scripts": {
    "deploy": "cf deploy",
    "postdeploy": "cf-access-policy apply -c access.config.ts --yes",
    "preteardown": "cf-access-policy remove -c access.config.ts --yes",
    "teardown": "wrangler delete --force"
  }
}
```

Do not let Terraform and `cf-access-policy` own the same Access policy or
application. Projects already managing Access in Terraform should keep that
ownership and skip this CLI; mixed projects may use `cf-access-policy` only
for a disjoint set of names/resources.

## Overview: The Three-Phase Pattern

```
provision                    deploy                     teardown
─────────────────────        ──────────────────         ──────────────────────────
terraform apply          →   wrangler deploy        →   destroy-containers
  ↓ (postprovision)              (uses wrangler.jsonc)     ↓
generate-wrangler                                      wrangler delete --force
  (writes wrangler.jsonc                                 ↓
   from terraform outputs)                             empty-r2-bucket
  ↓ (prebuild/predeploy/prestart)                        ↓
generate-wrangler-types                                terraform destroy
  (writes worker-configuration.d.ts                      ↓ (postteardown)
   from wrangler.jsonc, only when                      remove generated files
   wrangler.jsonc has changed)
```

**Why this pattern:**

- Terraform owns all Cloudflare infrastructure (D1, KV, R2, the Worker
  registration itself). `terraform destroy` cleanly removes everything
  that Terraform created.
- `generate-wrangler` bridges the two tools: it reads live Terraform
  output values and substitutes `{{placeholder}}` markers in a
  `wrangler.jsonc.tpl` template.
- `generate-wrangler-types` keeps TypeScript bindings in sync by running
  `wrangler types` only when `wrangler.jsonc` has changed — safe to add
  as a `pre` script without slowing down unrelated builds.
- `destroy-containers` deletes container applications and OCI registry
  images that `wrangler deploy` created but Terraform cannot see.
- `empty-r2-bucket` deletes every object in an R2 bucket, since the R2
  API refuses to delete a non-empty bucket and Terraform's own
  `terraform destroy` cannot empty one either.
- Wrangler handles code and configuration deployment; container cleanup,
  Worker deletion, and R2 bucket emptying must all occur before
  Terraform teardown.
- `wrangler.jsonc` and `worker-configuration.d.ts` are both generated,
  never committed.
- This split is endorsed by Cloudflare. The
  [Workers Infrastructure as Code guide](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/)
  states: _"you could use just the `cloudflare_worker` resource and
  seamlessly use Wrangler or your own deployment tools for Versions or
  Deployments."_

For the **rationale behind the split** — what Terraform owns vs. what
wrangler owns, and why the preteardown chain is necessary — load the
`cloudflare-terraform-best-practices` skill ("Teardown ordering"
section).

## Canonical Directory Structure

```
project-root/
├── .env                              # Cloudflare credentials (gitignored)
├── infra/
│   ├── versions.tf                   # Required providers block
│   ├── main.tf                       # Provider config, data sources, resources
│   └── outputs.tf                    # String/number outputs consumed by generate-wrangler
├── src/
│   └── worker/
│       ├── wrangler.jsonc.tpl        # Template with {{placeholders}}
│       ├── wrangler.jsonc            # Generated — gitignored, never commit
│       ├── worker-configuration.d.ts # Generated — gitignored, never commit
│       └── src/
│           └── index.ts              # Worker source code
└── package.json                      # npm scripts orchestration
```

The `infra/` and `src/worker/` split is conventional but not required.
What matters is:

- The template (`.tpl`) and output (`wrangler.jsonc`) live in the same
  directory (or you use explicit `-i`/`-o` flags on
  `generate-wrangler`).
- The Terraform state files are accessible via the `-t` flag.

`.env` lives at the **project root** (not inside `infra/`). For the
ingestion mechanics via `data.dotenv.env.env.*`, see the
`cloudflare-terraform-best-practices` skill ("Provider setup" section).

## Template File: `src/worker/wrangler.jsonc.tpl`

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "{{worker_name}}",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "account_id": "{{account_id}}",

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-worker-db",
      "database_id": "{{d1_database_id}}"
    }
  ],

  "kv_namespaces": [
    {
      "binding": "CACHE",
      "id": "{{kv_namespace_id}}"
    }
  ],

  "r2_buckets": [
    {
      "binding": "ASSETS",
      "bucket_name": "{{r2_bucket_name}}"
    }
  ]
}
```

Each `{{name}}` marker is replaced by the value of the Terraform output
with the same name (or, in `--local` mode, the same key in the local
variables file — see "Local development without Terraform" below).
Values must be `string` or `number` — any other type causes
`generate-wrangler` to exit with code 7. For the Terraform side of this
(writing the outputs), load the `cloudflare-terraform-best-practices`
skill ("Outputs and secrets flow" section).

### Template syntax rules

- Markers are **strict**: `{{name}}` — no whitespace inside braces.
  `{{ name }}` is treated as literal text with no warning.
- Identifiers follow Terraform identifier rules: letters, digits, `_`,
  `-`; must start with a letter or `_`. Regex:
  `/\{\{([A-Za-z_][A-Za-z0-9_-]*)\}\}/g`.
- Identifiers are **case-sensitive** and must exactly match the `output`
  name in `outputs.tf`.
- The same identifier may appear multiple times — all occurrences are
  replaced.
- Only `string` and `number` Terraform output types are substituted. Any
  other type (bool, list, map, object, set, tuple) causes exit code 7.
- Missing or null outputs produce a warning and leave the marker
  verbatim — unless `--check` (`-c`) is used, which fails fast and lists
  all problems before writing.

## npm Scripts

Add these to your `package.json`. The `pre`/`post` lifecycle scripts run
automatically when you call `npm run provision`, `npm run deploy`, etc.

```json
{
  "scripts": {
    "preprovision": "terraform -chdir=infra init",
    "provision": "terraform -chdir=infra apply -auto-approve",
    "postprovision": "generate-wrangler -cf -d src/worker -t infra",
    "generate:types": "generate-wrangler-types -d src/worker -- --include-runtime=false --strict-vars=false",
    "prebuild": "npm run generate:types",
    "build": "tsc -b src --noEmit",
    "predeploy": "run-s generate:types build",
    "deploy": "wrangler deploy --config src/worker/wrangler.jsonc",
    "prestart": "run-s generate:types build",
    "start": "wrangler dev --config src/worker/wrangler.jsonc",
    "preteardown": "run-s preteardown:containers preteardown:worker preteardown:r2",
    "preteardown:containers": "destroy-containers my-worker --env-file .env --yes",
    "preteardown:worker": "wrangler delete --force --config src/worker/wrangler.jsonc",
    "preteardown:r2": "empty-r2-bucket -t infra --env-file .env --yes",
    "teardown": "terraform -chdir=infra destroy -auto-approve",
    "postteardown": "run-s postteardown:wrangler postteardown:types",
    "postteardown:wrangler": "shx rm -f src/worker/wrangler.jsonc",
    "postteardown:types": "shx rm -f src/worker/worker-configuration.d.ts"
  },
  "devDependencies": {
    "@adrianhall/cloudflare-toolkit": "^2.2.0",
    "npm-run-all2": "^7.0.0",
    "shx": "^0.3.4",
    "wrangler": "^4.0.0"
  }
}
```

### Script-by-script breakdown

| Script                   | Command                                                          | Notes                                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preprovision`           | `terraform -chdir=infra init`                                    | Runs before every `npm run provision`. Idempotent — safe to always run. Downloads providers on first run; does nothing if already initialized.                                                                                                                                                 |
| `provision`              | `terraform -chdir=infra apply -auto-approve`                     | Creates/updates all Cloudflare resources. `-auto-approve` skips the interactive prompt; remove it if you want manual confirmation.                                                                                                                                                             |
| `postprovision`          | `generate-wrangler -cf -d src/worker -t infra`                   | `-c` validates all markers are present before writing. `-f` forces overwrite so re-provisioning doesn't fail if `wrangler.jsonc` already exists.                                                                                                                                               |
| `generate:types`         | `generate-wrangler-types -d src/worker -- ...`                   | Runs `wrangler types` only when `wrangler.jsonc` is newer than `worker-configuration.d.ts`. Invoked by `prebuild`, `predeploy`, `prestart`.                                                                                                                                                    |
| `prebuild`               | `npm run generate:types`                                         | Ensures types are fresh before every build.                                                                                                                                                                                                                                                    |
| `predeploy`              | `run-s generate:types build`                                     | Runs type generation then build before every deploy.                                                                                                                                                                                                                                           |
| `prestart`               | `run-s generate:types build`                                     | Runs type generation then build before every dev server start.                                                                                                                                                                                                                                 |
| `deploy`                 | `wrangler deploy --config src/worker/wrangler.jsonc`             | Deploys worker code. Requires `wrangler.jsonc` to exist (run `provision` first on a fresh checkout).                                                                                                                                                                                           |
| `preteardown`            | `run-s preteardown:containers preteardown:worker preteardown:r2` | Runs cleanup in dependency-safe order and fails fast.                                                                                                                                                                                                                                          |
| `preteardown:containers` | `destroy-containers my-worker --env-file .env --yes`             | Deletes container applications and OCI registry images matching the worker name. Required because `wrangler deploy` creates container resources that Terraform does not track. Replace `my-worker` with your worker name.                                                                      |
| `preteardown:worker`     | `wrangler delete --force --config src/worker/wrangler.jsonc`     | Removes the Worker before Terraform teardown.                                                                                                                                                                                                                                                  |
| `preteardown:r2`         | `empty-r2-bucket -t infra --env-file .env --yes`                 | Empties the Terraform-provisioned R2 bucket (`account_id`/`r2_bucket_name` outputs). Required because `terraform destroy` cannot delete a non-empty bucket. Ordered after `preteardown:worker` so a worker stuck mid-export cannot keep writing objects between the listing and delete passes. |
| `teardown`               | `terraform -chdir=infra destroy -auto-approve`                   | Destroys all Cloudflare resources including the worker.                                                                                                                                                                                                                                        |
| `postteardown`           | `run-s postteardown:*`                                           | Cleans up both generated files after teardown.                                                                                                                                                                                                                                                 |

For the _why_ behind the preteardown chain (wrangler-managed bindings are invisible to Terraform; ordering matters), load the `cloudflare-terraform-best-practices` skill ("Teardown ordering" section).

### Full provision + deploy in one command

```bash
npm run provision && npm run deploy
```

### generate-wrangler flags used in postprovision

```
-c   --check    Validate all {{markers}} against terraform outputs before writing.
                Exits with code 5 if any are missing, null, or unsupported type.
                Prevents silently writing a broken wrangler.jsonc.
-f   --force    Overwrite wrangler.jsonc if it already exists.
                Required for re-provisioning (provision runs more than once).
-d   --dir      Base directory for input/output paths.
                Default input: wrangler.jsonc.tpl; default output: wrangler.jsonc.
-t   --terraform Directory containing Terraform state files (infra/).
-l   --local <file>  Read marker values from a flat strict-JSON file instead
                of terraform outputs. Mutually exclusive with an explicit
                -t/--terraform. See "Local development without Terraform"
                below.
```

### Local development without Terraform

For `dev`/`start`/tests before any `terraform apply` has run — or for a
sandbox that intentionally never provisions real infrastructure — point
`generate-wrangler` at a flat JSON file of placeholder values instead:

```json
// src/worker/local.vars.json
{
  "worker_name": "my-worker-dev",
  "account_id": "0123456789abcdef0123456789abcdef",
  "d1_database_id": "00000000-0000-0000-0000-000000000000",
  "kv_namespace_id": "0000000000000000000000000000000",
  "r2_bucket_name": "my-worker-dev-bucket"
}
```

```json
{
  "scripts": {
    "predev": "generate-wrangler --local src/worker/local.vars.json -d src/worker",
    "dev": "vite dev"
  }
}
```

This file is a flat `name -> value` map — not the nested
`terraform output -json` shape — and must be **strict JSON**: no `//`
comments, no trailing commas, despite the `.jsonc`-suggestive naming
some projects use for it. Only `string` and `number` values substitute;
any other JSON value type still exits with code 7 if a template marker
references it, exactly like an unsupported Terraform output type.

The critical difference from terraform mode: `--local` **fails soft**
when `wrangler.jsonc` already exists and `--force` is not given — it
exits `0` and does not even read the variables file, instead of exiting
2 like terraform mode does. That makes it safe to wire into `predev`
unconditionally on every run, including runs where a previous
`postprovision` (or an earlier `--local --force`) already produced a
`wrangler.jsonc` that should be left alone. Use `--local ... --force`
only when you explicitly want the placeholder file to take precedence.

`--local` and an explicit `-t`/`--terraform` are mutually exclusive
(exit code 6) — pick one variable source per invocation.

### generate-wrangler-types flags and passthrough

```
-d   --dir      Base directory; wrangler runs here as cwd.
                Default config: wrangler.jsonc; default output: worker-configuration.d.ts.
-f   --force    Bypass the freshness check and always regenerate.

-- --include-runtime=false
                Omit bundled workerd runtime types when tsconfig.json already
                references @cloudflare/workers-types (prevents duplicate type errors).

-- --strict-vars=false
                Emit `string` for vars types instead of string literals.
                Without this, wrangler embeds actual secret token values as
                TypeScript literal types in the generated file.
```

### empty-r2-bucket flags and modes

```
-t   --terraform <dir>  Read account_id and r2_bucket_name from
                         `terraform output -json` in <dir>. Mutually
                         exclusive with a positional bucket-name.
--local                  Use the Miniflare Local Explorer API instead of
                         the Cloudflare REST API. Requires a positional
                         bucket-name; mutually exclusive with
                         --terraform, --account-id, --api-token, and
                         --env-file (local mode sends no credentials).
--local-url <url>        Override the Local Explorer API base URL.
                         Default: http://localhost:5173/cdn-cgi/explorer/api
                         (Vite's standard port). Use
                         http://localhost:8787/cdn-cgi/explorer/api for
                         Wrangler's standard port.
-y   --yes               Skip the destructive confirmation prompt.
```

The production adapter works with only the `Workers R2 Storage Write`
account-level permission group — it never depends on the S3-compatible
API or AWS Signature Version 4, so no access key ID/secret access key
pair is required. It probes for at least one object before prompting
(never listing or counting every key), issues a single
`DELETE .../objects?prefix=` request, then polls until Cloudflare
confirms completion.

### Cleanup CLI safety rules

- `cf-access-policy remove` is bounded to configured names, refuses
  unmanaged or unverifiable reusable-policy links, and deletes applications
  before policies.
- `destroy-containers` fails closed if application or registry discovery
  fails. It does not prompt or delete from a partial discovery result.
- `empty-r2-bucket` fails closed if the initial non-empty probe fails or
  returns a malformed response. It never prompts or deletes in that case.
- Prefer `--env-file` or `CLOUDFLARE_ACCOUNT_ID` and
  `CLOUDFLARE_API_TOKEN`. The `--account-id` and `--api-token` flags are
  compatibility options; command-line tokens can be exposed in process
  listings and shell history.

## Validation and Formatting Integration

`terraform validate` and `terraform fmt` integrate cleanly into your
project-level check and format scripts, alongside JavaScript tooling.

**Validation (run in CI, alongside eslint/biome/tsc):**

```json
{
  "scripts": {
    "check": "terraform -chdir=infra validate && tsc --noEmit && biome check ."
  }
}
```

> `terraform validate` requires `terraform init` to have been run first (providers must be downloaded). In CI, run `preprovision` (or `terraform -chdir=infra init -backend=false`) before your check script.

**Formatting (run alongside prettier/biome):**

```json
{
  "scripts": {
    "fmt": "terraform -chdir=infra fmt && biome format --write ."
  }
}
```

`terraform fmt` recursively formats all `.tf` files in the `infra/`
directory. It is safe to run at any time and produces deterministic
output.

## .gitignore Additions

```gitignore
# Generated wrangler config — always re-created from terraform outputs
src/worker/wrangler.jsonc

# Generated TypeScript bindings — always re-created from wrangler.jsonc
src/worker/worker-configuration.d.ts

# Credentials — never commit
.env

# Terraform working directory and state
infra/.terraform/
infra/.terraform.lock.hcl
infra/*.tfstate
infra/*.tfstate.backup
```

If using local state backend, `*.tfstate` files contain resource IDs.
Back them up separately or use a remote backend (Terraform Cloud, S3,
etc.).

## CLI Anti-Patterns

These are common mistakes when wiring the CLIs into npm scripts. Each
will cause silent failures or non-idempotent behaviour.

> **Terraform/HCL anti-patterns** (legacy resources, missing required
> blocks, token-resource mismatches, etc.) live in the
> `cloudflare-terraform-best-practices` skill. This list is
> CLI-orchestration only.

---

### 1. Missing `--force` flag in `postprovision`

**Wrong:**

```json
"postprovision": "generate-wrangler -c -d src/worker -t infra"
```

**Correct:**

```json
"postprovision": "generate-wrangler -cf -d src/worker -t infra"
```

**Why.** Without `--force` (`-f`), `generate-wrangler` exits with code 2
if `wrangler.jsonc` already exists. The first `npm run provision`
succeeds, but every subsequent run fails at the `postprovision` step.

---

### 2. Committing `wrangler.jsonc` to version control

**Why.** `wrangler.jsonc` contains resource IDs (D1 database UUID, KV
namespace ID, etc.) that are specific to a particular Terraform state.
Committing it:

- Leaks infrastructure IDs into git history.
- Causes conflicts when multiple developers provision separate
  environments.
- Creates a false impression that the config is manually maintained.

Always add `src/worker/wrangler.jsonc` (or wherever your output lives)
to `.gitignore`.

---

### 3. Using complex types in Terraform outputs

**Wrong:**

```hcl
output "database_ids" {
  value = [cloudflare_d1_database.db.id]   # list — unsupported type
}
```

**Correct:**

```hcl
output "d1_database_id" {
  value = cloudflare_d1_database.db.id     # string — supported
}
```

**Why.** `generate-wrangler` only supports `string` and `number`
Terraform output types. Passing a `list`, `map`, `object`, `set`, or
`tuple` causes it to exit with code 7. Always output individual scalar
values, one per binding.

For the Terraform side of this constraint (output design), see the
`cloudflare-terraform-best-practices` skill ("Outputs and secrets flow"
section).

---

### 4. Committing `worker-configuration.d.ts` to version control

**Why.** `worker-configuration.d.ts` is generated from `wrangler.jsonc`
and contains binding types derived from your specific infrastructure
IDs. Committing it:

- May embed secret variable names (or with `--strict-vars=true`, actual
  secret values) as TypeScript literal types in the file.
- Causes conflicts when multiple developers provision separate
  environments.
- Creates stale type definitions when `wrangler.jsonc` changes but the
  `.d.ts` is not regenerated.

Always add `src/worker/worker-configuration.d.ts` (or wherever your
output lives) to `.gitignore`. The file is regenerated automatically by
`generate-wrangler-types` in every `prebuild`, `predeploy`, and `prestart`.

---

### 5. Whitespace inside template markers

**Wrong:**

```jsonc
"database_id": "{{ d1_database_id }}"   // treated as literal text — not substituted
```

**Correct:**

```jsonc
"database_id": "{{d1_database_id}}"     // strict form — no spaces
```

**Why.** The template engine uses a strict regex:
`/\{\{([A-Za-z_][A-Za-z0-9_-]*)\}\}/g`. Anything that doesn't match
exactly (including `{{ name }}`, `{{1bad}}`, `{{a b}}`) is silently
left as literal text. There is no warning — the marker just won't be
replaced. Use `--check` (`-c`) during development to catch these before
they reach production.

---

### 6. Forgetting to clean up container images and R2 objects before teardown

**Wrong:**

```json
"teardown": "terraform -chdir=infra destroy -auto-approve"
```

**Correct:**

```json
"preteardown:containers": "destroy-containers my-worker --env-file .env --yes",
"preteardown:worker":     "wrangler delete --force --config src/worker/wrangler.jsonc",
"preteardown:r2":         "empty-r2-bucket -t infra --env-file .env --yes",
"preteardown":            "run-s preteardown:containers preteardown:worker preteardown:r2",
"teardown":               "terraform -chdir=infra destroy -auto-approve"
```

**Why.** Container applications and OCI registry images are created by
`wrangler deploy`, not by Terraform. `terraform destroy` has no
knowledge of them. Left behind, they consume registry storage and
clutter the Containers dashboard. The `destroy-containers` command
discovers container applications and registry images matching the
worker name, then deletes them.

Separately, the R2 API refuses to delete a non-empty bucket, so
`terraform destroy` fails partway through if a Terraform-managed R2
bucket still has objects in it. The `empty-r2-bucket` command empties
the bucket first, ordered after `preteardown:worker` so a worker stuck
mid-export cannot keep writing objects into the bucket between the
listing and delete passes.

The `--yes` flag skips the interactive confirmation prompt on both
commands. The `--env-file .env` flag loads `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` from the project's `.env` file. Replace
`my-worker` with your actual worker name.

For the general principle ("anything wrangler attaches at deploy time
is invisible to Terraform"), load the
`cloudflare-terraform-best-practices` skill ("Teardown ordering"
section).
