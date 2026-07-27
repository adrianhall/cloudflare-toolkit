---
name: cloudflare-deploy-scripts
description: CLI tools and npm-script orchestration for deploying Cloudflare Workers projects with @adrianhall/cloudflare-toolkit. Covers the three-phase provision/deploy/teardown pattern, generate-wrangler templating, generate-wrangler-types freshness checks, empty-r2-bucket and destroy-containers cleanup, template rules, npm scripts, and CLI anti-patterns. Load when wiring deployment scripts for a Cloudflare Workers project. For Terraform schema and service patterns, load the sibling `cloudflare-terraform-best-practices` skill.
---

# Cloudflare Deploy Scripts: CLI Tools and npm-Script Orchestration

This skill describes the **CLI tools** shipped by
`@adrianhall/cloudflare-toolkit` and the **npm script wiring** that ties
them together with Terraform and Wrangler to deploy a Cloudflare Workers
project.

The CLIs:

- **`generate-wrangler`** — substitutes Terraform outputs into a
  `wrangler.jsonc.tpl` template, producing a ready-to-use
  `wrangler.jsonc`.
- **`generate-wrangler-types`** — runs `wrangler types` only when
  `wrangler.jsonc` has changed (cheap pre-script).
- **`empty-r2-bucket`** — deletes all objects from an R2 bucket before
  `terraform destroy` (the Cloudflare API rejects deletion of a
  non-empty bucket).
- **`destroy-containers`** — deletes container applications and OCI
  registry images that `wrangler deploy` created but Terraform cannot
  see.

> **Terraform schema, HCL conventions, token model, per-service
> patterns, and teardown ordering principles live in the sibling
> `cloudflare-terraform-best-practices` skill.** Load it before writing
> any `cloudflare_*` resource block. This skill assumes the Terraform
> stack is already designed correctly and focuses on the CLI-side
> orchestration.

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
- `empty-r2-bucket` deletes R2 objects before `terraform destroy` (the
  R2 API refuses non-empty bucket deletion).
- `destroy-containers` deletes container applications and OCI registry
  images that `wrangler deploy` created but Terraform cannot see.
- Wrangler handles code and configuration deployment; container cleanup
  and Worker deletion must occur before Terraform teardown.
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
with the same name. Outputs must be `string` or `number` — any other
type causes `generate-wrangler` to exit with code 7. For the Terraform
side of this (writing the outputs), load the
`cloudflare-terraform-best-practices` skill ("Outputs and secrets flow"
section).

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
    "preteardown:r2": "empty-r2-bucket -t infra --yes",
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

| Script                   | Command                                                          | Notes                                                                                                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preprovision`           | `terraform -chdir=infra init`                                    | Runs before every `npm run provision`. Idempotent — safe to always run. Downloads providers on first run; does nothing if already initialized.                                                                            |
| `provision`              | `terraform -chdir=infra apply -auto-approve`                     | Creates/updates all Cloudflare resources. `-auto-approve` skips the interactive prompt; remove it if you want manual confirmation.                                                                                        |
| `postprovision`          | `generate-wrangler -cf -d src/worker -t infra`                   | `-c` validates all markers are present before writing. `-f` forces overwrite so re-provisioning doesn't fail if `wrangler.jsonc` already exists.                                                                          |
| `generate:types`         | `generate-wrangler-types -d src/worker -- ...`                   | Runs `wrangler types` only when `wrangler.jsonc` is newer than `worker-configuration.d.ts`. Invoked by `prebuild`, `predeploy`, `prestart`.                                                                               |
| `prebuild`               | `npm run generate:types`                                         | Ensures types are fresh before every build.                                                                                                                                                                               |
| `predeploy`              | `run-s generate:types build`                                     | Runs type generation then build before every deploy.                                                                                                                                                                      |
| `prestart`               | `run-s generate:types build`                                     | Runs type generation then build before every dev server start.                                                                                                                                                            |
| `deploy`                 | `wrangler deploy --config src/worker/wrangler.jsonc`             | Deploys worker code. Requires `wrangler.jsonc` to exist (run `provision` first on a fresh checkout).                                                                                                                      |
| `preteardown`            | `run-s preteardown:containers preteardown:worker preteardown:r2` | Runs cleanup in dependency-safe order and fails fast.                                                                                                                                                                     |
| `preteardown:containers` | `destroy-containers my-worker --env-file .env --yes`             | Deletes container applications and OCI registry images matching the worker name. Required because `wrangler deploy` creates container resources that Terraform does not track. Replace `my-worker` with your worker name. |
| `preteardown:worker`     | `wrangler delete --force --config src/worker/wrangler.jsonc`     | Removes the Worker before R2 is emptied.                                                                                                                                                                                  |
| `preteardown:r2`         | `empty-r2-bucket -t infra --yes`                                 | Empties and verifies R2 after the Worker can no longer write objects.                                                                                                                                                     |
| `teardown`               | `terraform -chdir=infra destroy -auto-approve`                   | Destroys all Cloudflare resources including the worker.                                                                                                                                                                   |
| `postteardown`           | `run-s postteardown:*`                                           | Cleans up both generated files after teardown.                                                                                                                                                                            |

For the _why_ behind the preteardown chain (wrangler-managed bindings
are invisible to Terraform; ordering matters), load the
`cloudflare-terraform-best-practices` skill ("Teardown ordering"
section).

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
```

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

### Cleanup CLI safety rules

- `empty-r2-bucket --jurisdiction` accepts `auto`, `eu`, or `fedramp`.
  In per-value mode it falls back to `R2_JURISDICTION`, then `auto`.
  Terraform mode reads optional `r2_jurisdiction` and defaults to `auto`.
- `empty-r2-bucket` exits nonzero unless every requested key is
  accounted for and a final listing verifies the bucket is empty.
- `destroy-containers` fails closed if application or registry discovery
  fails. It does not prompt or delete from a partial discovery result.
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

> `terraform validate` requires `terraform init` to have been run first
> (providers must be downloaded). In CI, run `preprovision` (or
> `terraform -chdir=infra init -backend=false`) before your check
> script.

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

### 6. Forgetting to empty R2 buckets before `terraform destroy`

**Wrong:**

```json
"teardown": "terraform -chdir=infra destroy -auto-approve"
```

**Correct:**

```json
"preteardown:containers": "destroy-containers my-worker --env-file .env --yes",
"preteardown:worker":     "wrangler delete --force --config src/worker/wrangler.jsonc",
"preteardown:r2":         "empty-r2-bucket -t infra --yes",
"preteardown":            "run-s preteardown:containers preteardown:worker preteardown:r2",
"teardown":               "terraform -chdir=infra destroy -auto-approve"
```

**Why.** The Cloudflare API rejects deletion of a non-empty R2 bucket.
If your Terraform state includes `cloudflare_r2_bucket` resources and
the bucket contains objects, `terraform destroy` fails part-way through,
leaving resources in a broken state. The `empty-r2-bucket` command lists,
deletes, and verifies all objects before destroy begins. As a `preteardown` npm
lifecycle script, it runs automatically when you call
`npm run teardown`.

The `--yes` flag skips the interactive confirmation prompt, which is
required for non-interactive (CI) usage. The `-t infra` flag reads R2
credentials from Terraform output (the `account_id`, `r2_bucket_name`,
`r2_token_id`, and `r2_token_value` outputs). For the Terraform side
of those outputs (the v5 token derivation rule), load the
`cloudflare-terraform-best-practices` skill ("Cloudflare R2" section).

---

### 7. Forgetting to clean up container images before teardown

**Wrong:**

```json
"preteardown": "empty-r2-bucket -t infra --yes",
"teardown":    "terraform -chdir=infra destroy -auto-approve"
```

**Correct:**

```json
"preteardown:containers": "destroy-containers my-worker --env-file .env --yes",
"preteardown:worker":     "wrangler delete --force --config src/worker/wrangler.jsonc",
"preteardown:r2":         "empty-r2-bucket -t infra --yes",
"preteardown":            "run-s preteardown:containers preteardown:worker preteardown:r2",
"teardown":               "terraform -chdir=infra destroy -auto-approve"
```

**Why.** Container applications and OCI registry images are created by
`wrangler deploy`, not by Terraform. `terraform destroy` has no
knowledge of them. Left behind, they consume registry storage and
clutter the Containers dashboard. The `destroy-containers` command
discovers container applications and registry images matching the
worker name, then deletes them.

The `--yes` flag skips the interactive confirmation prompt. The
`--env-file .env` flag loads `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` from the project's `.env` file. Replace
`my-worker` with your actual worker name.

For the general principle ("anything wrangler attaches at deploy time
is invisible to Terraform"), load the
`cloudflare-terraform-best-practices` skill ("Teardown ordering"
section).
