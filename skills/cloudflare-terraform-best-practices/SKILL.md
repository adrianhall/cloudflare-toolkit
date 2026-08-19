---
name: cloudflare-terraform-best-practices
description: Terraform v5 best practices for the Cloudflare provider. Use when writing, reviewing, or generating Terraform/HCL that provisions the Cloudflare Developer Platform (Workers, D1, Workers KV, R2, Queues, AI Gateway, Zero Trust Access).
---

# Cloudflare Terraform Best Practices (v5 provider)

This skill captures the non-obvious rules, idempotency requirements, and anti-patterns that surface when running the **Cloudflare Terraform v5 provider** (`cloudflare/cloudflare ~> 5`) against a real Cloudflare account. Each section below is the resolution of a real failure mode and ships with working v5 HCL.

**Scope:** Terraform schema, resource shapes, token model, secrets flow, file layout, dependency/teardown ordering, Cloudflare Access, and validation/security tooling. Patterns are grouped by Cloudflare _service_ where that helps, and by _file_ where that helps more.

> The v5 provider made significant breaking changes from v4 — attribute names, block shapes, nested syntax (attribute lists `[{ ... }]` instead of repeated HCL blocks), and resource responsibilities all changed. Several v4 resources have been removed, and some v5 resources (for example, R2 CORS) didn't exist at v5's launch and were added in later minor releases. Do not rely on pre-trained knowledge for v5 HCL — always retrieve the docs.

## References

- [Cloudflare Terraform overview](https://developers.cloudflare.com/terraform/)
- [Cloudflare v5 provider docs](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs) ([Source](https://github.com/cloudflare/terraform-provider-cloudflare/tree/main/docs/resources))
- [Cloudflare Workers IaC guide](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/)
- [dotenv Terraform provider docs](https://registry.terraform.io/providers/jrhouston/dotenv/latest/docs)
- [Terraform `depends_on` reference](https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on)
- [Terraform style guide](https://developer.hashicorp.com/terraform/language/style) ([Skill](https://raw.githubusercontent.com/hashicorp/agent-skills/refs/heads/main/terraform/code-generation/skills/terraform-style-guide/SKILL.md))
- [Trivy security scanner](https://github.com/aquasecurity/trivy)
- [tflint tool](https://github.com/terraform-linters/tflint)

## Retrieval sources

**Always retrieve the provider docs before writing or reviewing any `cloudflare_*` resource.** Schemas, required fields, and available attributes change across releases.

When a pre-trained assumption about a resource attribute conflicts with the live docs, **trust the docs**.

## Choose one Access owner

Access-only projects can avoid Terraform and use the toolkit's
`cf-access-policy` CLI with `cf deploy`. Projects that already use Terraform
for Workers, bindings, DNS, or other infrastructure may keep Access in the
Cloudflare provider using the patterns below. Never let Terraform and
`cf-access-policy` own the same reusable policy or application: choose one
owner per resource, or keep any mixed ownership strictly disjoint by stable
resource name.

## Recommended file layout

Follow HashiCorp's file-per-concern convention (see "Style guide compliance" below) rather than collapsing everything into one or two files. The concern boundaries that matter for a Cloudflare Developer Platform stack are: **credentials/provider setup**, **Access** (which protects the whole hostname surface, not any one Worker), **each Worker and the bindings that belong exclusively to it**, and **bindings shared across more than one Worker**:

| File                  | Contents                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providers.tf`        | `terraform{}` required-providers block, the `dotenv` data source, the `cloudflare` provider block, and **every** `locals{}` block that reads `data.dotenv.config.env[...]`. Nothing else.                                                            |
| `access.tf`           | Every `cloudflare_zero_trust_access_policy` and `cloudflare_zero_trust_access_application` resource, for every Worker in the stack. Nothing else — Access is a cross-cutting concern, not something any one Worker file should own.                  |
| `<worker-name>.tf`    | One file **per Worker**: its `cloudflare_worker` resource, its bootstrap version/deployment, its custom domain, and any binding-backing resource (D1, KV, R2, Queue) that is exclusively that Worker's — plus any token scoped to just that binding. |
| `<shared-binding>.tf` | One file per binding that is shared across **more than one** Worker (a KV namespace both a `chat` and an `api` Worker write to, for example). Never let a shared resource live inside one Worker's file — see "Dedicated vs. shared bindings" below. |
| `outputs.tf`          | Every `output` block — scalar `string`/`number` values only (see "Outputs and secrets flow").                                                                                                                                                        |

A single-Worker stack (the common case) naturally ends up with four files, since there's nothing to share and nothing to split:

```
infra/
├── providers.tf  # dotenv + locals + provider
├── access.tf     # Zero Trust Access policies + applications
├── demo.tf       # the one Worker: registration, bootstrap deployment, custom domain, its D1/KV/R2/Queue
└── outputs.tf    # scalar outputs consumed by generate-wrangler
```

A multi-Worker stack should **not** be squeezed into that same four-file shape — split by Worker and by shared binding as the stack actually grows:

```
infra/
├── providers.tf     # dotenv + locals + provider
├── access.tf        # Access policies + applications for every Worker
├── chat.tf          # chat Worker: registration, bootstrap deployment, custom domain, its own D1 database
├── api.tf           # api Worker: registration, bootstrap deployment, custom domain, its own R2 bucket
├── notifications.tf # queue-consumer Worker: registration, bootstrap deployment (no custom domain)
├── shared-kv.tf     # Workers KV namespace read by both chat and api — belongs to neither Worker's file
├── shared-queue.tf  # Queue that api produces to and notifications consumes from
└── outputs.tf       # scalar outputs consumed by generate-wrangler
```

If a single Worker's own bindings grow large enough that its file becomes hard to navigate (several dedicated D1 databases, per-database tokens, etc.), split that Worker's file further by resource type (`chat-d1.tf`, `chat-r2.tf`) — the same file-per-concern principle applies recursively. `providers.tf`, `access.tf`, and `outputs.tf` stay single files regardless of stack size; they don't grow the way per-Worker and per-binding resources do.

## `providers.tf`: dotenv, provider setup, and locals

### `terraform{}` and the dotenv data source

```hcl
# infra/providers.tf
terraform {
  required_version = ">= 1.10.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.22.0"
    }
    dotenv = {
      source  = "jrhouston/dotenv"
      version = "~> 1.0"
    }
  }
}

data "dotenv" "config" {
  filename = "${path.module}/../.env"
}

provider "cloudflare" {
  api_token = data.dotenv.config.env["CLOUDFLARE_API_TOKEN"]
}

locals {
  cloudflare_api_token   = sensitive(data.dotenv.config.env["CLOUDFLARE_API_TOKEN"])
  cloudflare_account_id  = data.dotenv.config.env["CLOUDFLARE_ACCOUNT_ID"]
  cloudflare_zone_id     = data.dotenv.config.env["CLOUDFLARE_ZONE_ID"]
  cloudflare_team_domain = data.dotenv.config.env["CLOUDFLARE_TEAM_DOMAIN"]

  # Project-specific inputs, same mechanism:
  demo_domain = data.dotenv.config.env["DEMO_DOMAIN"]
  demo_name   = data.dotenv.config.env["DEMO_NAME"]
  hostname    = "${local.demo_name}.${local.demo_domain}"
  worker_name = local.demo_name
}
```

Pin `required_version` on the Terraform CLI itself, not just the providers — the `dotenv` data source's index-expression syntax (`data.dotenv.config.env["KEY"]`, used throughout this skill in preference to the older attribute-style `data.dotenv.config.env.KEY`) and some HCL functions used elsewhere in a stack require a reasonably current Terraform.

Wrap the API token in `sensitive(...)` when you expose it as a `local` — `data.dotenv.config.env["CLOUDFLARE_API_TOKEN"]` itself isn't marked sensitive by the provider, so anything that re-derives it (rather than consuming it only inside the `provider` block) should be wrapped explicitly to keep it out of plan/apply console output.

### `.env` (gitignored, project root — not inside `infra/`)

```
# Required permissions (Account API Token):
#   Entire Account → Developer Platform:
#     D1 : Edit
#     Workers KV Storage : Edit
#     Workers R2 Storage : Edit
#     Workers Scripts : Edit
#     Workers Tail : Read
#   Entire Account → Cloudflare One / Zero Trust:
#     Access : Edit
#     Access: Identity Providers : Read
#   <your-domain> → DNS & Zones:
#     DNS : Write
CLOUDFLARE_API_TOKEN="<from-dashboard>"
CLOUDFLARE_ACCOUNT_ID="<from-dashboard>"

# DNS zone information
CLOUDFLARE_ZONE_ID="<from-dashboard>"
DEMO_DOMAIN="your-apps-domain.example"

# Cloudflare Access information
CLOUDFLARE_TEAM_DOMAIN="your-team.cloudflareaccess.com"

# Specific to this demo
DEMO_NAME="my-worker"
```

Document the token's required permission scopes as a comment block at the top of `.env` (and `.env.example`) — the account-token permission model is opaque enough from the dashboard alone that a future operator regenerating the token will otherwise have to reverse-engineer it from `terraform plan` 403s.

No `variable {}` blocks are required, and this skill deliberately departs from the "every input is a described, typed, validated `variable`" convention in the HashiCorp style guide for this specific case — see "Style guide compliance" below for the reasoning.

### Anti-pattern: relying on `TF_VAR_*` env vars from npm scripts

```jsonc
// package.json — DO NOT do this
"provision": "TF_VAR_worker_name=my-worker terraform -chdir=infra apply -auto-approve"
```

**Why it fails.** Terraform's `TF_VAR_<name>` convention only populates `var.<name>` when the variable is **exported by the shell that invokes `terraform apply`**. `npm run provision` (and pnpm, yarn equivalents) runs Terraform in a fresh npm-script shell that does **not** auto-source `.env`. Even if the operator sourced `.env` in their interactive shell, the value won't reach Terraform — and Terraform will fall back to its interactive prompt, breaking `-auto-approve`.

**Fix.** Thread every input through `data.dotenv.config.env[...]`. The operator runs a plain `npm run provision` from any shell with no preparation steps.

## Credentials and token model

This section is cross-cutting — every Cloudflare service that needs an API token follows the same rules.

### User tokens vs account tokens

The v5 provider exposes **two** distinct token resources. The choice is not stylistic — it's determined by what kind of credential will run `terraform apply`.

| Resource / data source                                | Endpoint                                      | Auth required                                                            |
| ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `cloudflare_api_token`                                | `POST /user/tokens`                           | User-level credentials (email + Global API Key, or user-owned API token) |
| `cloudflare_account_token`                            | `POST /accounts/{id}/tokens`                  | Account API token with `Account API Tokens: Edit`                        |
| `cloudflare_api_token_permission_groups_list`         | `GET /user/tokens/permission_groups`          | User-level only                                                          |
| `cloudflare_account_api_token_permission_groups_list` | `GET /accounts/{id}/tokens/permission_groups` | Account API token                                                        |

For a fully-automated stack driven by a single `CLOUDFLARE_API_TOKEN` (an **account** API token), the answer is always `cloudflare_account_token` for token resources, and `cloudflare_account_api_token_permission_groups_list` for the permission-groups lookup.

#### Anti-pattern: `cloudflare_api_token` under an account API token

```hcl
# DO NOT — provider is configured with an account API token
resource "cloudflare_api_token" "kv_bulk" {     # user-level resource
  name = "kv-bulk"
  # ...
}
```

Apply fails with HTTP 403 / error code `9109`: `"Valid user-level authentication not found"` — the request hits `/user/tokens`, which an account API token is not authorised to call. **Fix.** Use `cloudflare_account_token` (see the R2/KV recipes below). The same fix applies to the permission-groups data source — use the `_account_` form.

### JSON-encoded `resources` block

`policies[].resources` on `cloudflare_account_token` (and `cloudflare_api_token`) is typed `String`. The Cloudflare API expects a **JSON object string**. The provider rejects HCL maps.

```hcl
# DO NOT — v5 rejects this
resources = {
  "com.cloudflare.api.account.${local.cloudflare_account_id}" = "*"
}

# Correct
resources = jsonencode({
  "com.cloudflare.api.account.${local.cloudflare_account_id}" = "*"
})
```

### URL-encoded `name` filter on the permission-groups data source

The `name` argument on `data.cloudflare_account_api_token_permission_groups_list` is forwarded verbatim to the API as a query-string filter. Spaces break the request — the API contract requires URL encoding.

```hcl
data "cloudflare_account_api_token_permission_groups_list" "kv_write" {
  account_id = local.cloudflare_account_id
  name       = "Workers%20KV%20Storage%20Write"   # URL-encoded
}

locals {
  kv_write_permission_group_id = one([
    for g in data.cloudflare_account_api_token_permission_groups_list.kv_write.result :
    g.id if g.name == "Workers KV Storage Write"
  ])
}
```

Symptom of using the unencoded form: the data source returns zero results, and `one(...)` raises an error because the list is empty.

### Narrow exception: a Worker calling Cloudflare's REST API directly (AI Gateway logs)

The general rule elsewhere in this toolkit is to prefer a Workers runtime binding over calling Cloudflare's REST API from inside a Worker. AI Gateway's logs-list endpoint (`GET /accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs`) is a real, narrow exception: the generated `AiGateway` binding type only exposes `getLog()`, `patchLog()`, `run()`, and `getUrl()` — nothing that lists or filters logs. A Worker that needs to correlate its own calls against gateway logs (cost/usage reconciliation, for example) has no choice but to call this one REST endpoint directly.

Provision a purpose-scoped token for exactly this call, the same recipe as the KV bulk-write / R2 S3 tokens above — never reach for the account's main `CLOUDFLARE_API_TOKEN` inside the deployed Worker:

```hcl
data "cloudflare_account_api_token_permission_groups_list" "ai_gateway_read" {
  account_id = local.cloudflare_account_id
  name       = "AI%20Gateway%20Read"
}

locals {
  ai_gateway_read_permission_group_id = one([
    for g in data.cloudflare_account_api_token_permission_groups_list.ai_gateway_read.result :
    g.id if g.name == "AI Gateway Read"
  ])
}

resource "cloudflare_account_token" "ai_gateway_logs" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name}-ai-gateway-logs"

  policies = [{
    effect = "allow"
    permission_groups = [{
      id = local.ai_gateway_read_permission_group_id
    }]
    resources = jsonencode({
      "com.cloudflare.api.account.${local.cloudflare_account_id}" = "*"
    })
  }]
}

output "ai_gateway_logs_token" {
  description = "Account token scoped to AI Gateway Read, for the Worker's direct logs-list REST call."
  value       = cloudflare_account_token.ai_gateway_logs.value
  sensitive   = true
}
```

Thread the sensitive output into a `wrangler secret put` — never a plain `wrangler.jsonc` `vars` entry — the same way every other Terraform-created credential reaches the Worker (see "Secrets flow direction" below).

## Style guide compliance (HashiCorp)

Baseline HCL style comes from [HashiCorp's Terraform style guide](https://developer.hashicorp.com/terraform/language/style), condensed into an agent-consumable form as the [`terraform-style-guide` skill](https://raw.githubusercontent.com/hashicorp/agent-skills/refs/heads/main/terraform/code-generation/skills/terraform-style-guide/SKILL.md). This skill's Cloudflare-specific conventions are compatible with that guide, with one deliberate, documented deviation.

**Adopt without modification:**

- **File organization by concern, not by convenience.** No monolithic
  `main.tf`. Provider/credential setup, Access, each Worker, and each
  shared binding each get their own file — see "Recommended file layout"
  above. Resist the temptation to fold a second Worker into an existing
  Worker's file just because it's small; the point of the split is that a
  file's name tells you its blast radius before you open it.
- **Formatting.** Two-space indentation, no tabs, aligned `=` for
  consecutive arguments on adjacent lines. `terraform fmt -recursive`
  enforces this automatically — never hand-format.
- **Naming.** Lowercase with underscores, descriptive nouns, **singular**
  resource labels (`cloudflare_r2_bucket.media`, not `.buckets`). Default
  to `demo` / `main` for the one-and-only instance of a resource type in
  the stack (as the four reference demos all do for `cloudflare_worker`)
  — a more specific name is redundant when there's only one Worker.

  ```hcl
  # Bad
  resource "cloudflare_r2_bucket" "MediaBuckets" {}
  resource "cloudflare_worker" "workers" {}

  # Good
  resource "cloudflare_r2_bucket" "media" {}
  resource "cloudflare_worker" "demo" {}
  ```

- **Block ordering inside a resource.** Meta-arguments (`count`,
  `for_each`, `depends_on`) first, then ordinary arguments, then nested
  blocks/attribute-list arguments, then `lifecycle {}` last.
- **Outputs need a `description`.** Every `output` block in this skill's
  examples carries one — treat a missing `description` as a review
  finding, not a style nit; it's the only documentation a consumer of
  `terraform output -json` (i.e. `generate-wrangler`) ever sees.
- **Sensitive values are marked `sensitive = true`** on both the
  underlying `local`/resource attribute reference and the `output` block
  that surfaces it (see the R2 token recipe below).
- **`for_each` over `count`** for anything that produces more than one
  similarly-shaped resource. This skill's Cloudflare Access "multi-policy"
  pattern (below) intentionally uses **named, distinct resource blocks**
  instead of `for_each` over a policy map, because each path-scoped
  application differs enough in `destinations`/`policies` shape that a
  `for_each` map would obscure more than it clarifies for a 2–3-application
  stack. If a project grows to 5+ near-identical path-scoped applications,
  revisit that call and switch to `for_each`.
- **Version pinning.** `~> 5.22.0` for the Cloudflare provider (not a bare
  `~> 5.0`) once your stack depends on a resource introduced in a later
  5.x minor — `cloudflare_r2_bucket_cors` is one such example (see the R2
  section). Bump the pin deliberately, not automatically.
- **`terraform fmt`/`terraform validate`** before every commit (see
  "Validating, formatting, and scanning" below).

**Deliberate deviation: no `variables.tf`.**

The style guide's canonical layout has a `variables.tf` with typed, described, validated `variable` blocks, fed by `*.tfvars` or `TF_VAR_*`. This skill's `providers.tf` uses `locals` sourced from `data.dotenv.config.env[...]` instead, for two reasons specific to this stack:

1. Every input here is either a secret (API token) or an environment value already required to live in `.env` for Wrangler's own tooling (see "Terraform + Wrangler" below) — introducing a second `variable`-based input channel on top of `.env` would mean keeping two sources of truth in sync, or reintroducing the `TF_VAR_*` anti-pattern as the bridge between them.
2. `variable { validation {} }` blocks are valuable when a human runs `terraform apply` interactively and benefits from a friendly error before Terraform touches the API. In this stack, the same fail-fast behaviour already comes for free: a missing `.env` key produces an immediate, clear error from the `dotenv` provider itself (`env[...]` on a nonexistent key errors at plan time), so a parallel `variable` validation layer would duplicate that check.

If your project's Terraform stack has non-secret, non-`.env` inputs that genuinely benefit from `variable`-style validation (an environment name constrained to `dev`/`staging`/`prod`, for example), it's fine to add a `variables.tf` alongside `providers.tf` for those specific inputs — just don't route secrets or `.env`-sourced values through it.

## Per-Worker files: the Worker, its bootstrap deployment, and its bindings

Everything in this section lives in that Worker's own `<worker-name>.tf` file (see "Recommended file layout" above) — the `cloudflare_worker` resource itself, its bootstrap version/deployment, its custom domain, and any D1/KV/R2/Queue resource that belongs exclusively to it.

### Dedicated vs. shared bindings

Before adding a binding-backing resource to a Worker's file, ask: **does any other Worker in this stack also bind to it?**

- **Dedicated** (only this Worker uses it): the resource belongs in this Worker's own file, right alongside the `cloudflare_worker` it serves. This is the common case, and every example in this section assumes it.
- **Shared** (two or more Workers use it): the resource belongs in its own `<shared-binding>.tf` file, never inside either Worker's file. Putting a shared KV namespace inside `chat.tf` just because `chat` was the first Worker to need it is misleading — a future reader deleting or refactoring `chat.tf` has no signal that `api.tf` also depends on a resource declared there, and Terraform's own dependency graph won't save you from a bad guess, since (per "Teardown ordering" below) Worker-to-binding relationships require an explicit `depends_on` that someone has to remember to write correctly for _every_ consuming Worker, not just the one whose file happens to declare the resource.

### Canonical Worker registration

```hcl
resource "cloudflare_worker" "demo" {
  account_id = local.cloudflare_account_id
  name       = local.worker_name

  observability = {
    enabled = true
    logs = {
      enabled            = true
      head_sampling_rate = 1
      invocation_logs    = true
      persist            = true
    }
    traces = {
      enabled            = true
      head_sampling_rate = 0.1
      persist            = true
    }
  }

  subdomain = {
    enabled          = true
    previews_enabled = false
  }
}
```

The `cloudflare_worker` resource **registers** the Worker; `wrangler deploy` later attaches the real code, bindings, and deployment metadata. These are separate concerns — see "Terraform + Wrangler" and "Teardown ordering" below for the implications.

#### Anti-pattern: `cloudflare_workers_script` (legacy v4 resource)

```hcl
# DO NOT use in v5
resource "cloudflare_workers_script" "worker" {
  account_id  = local.cloudflare_account_id
  script_name = "my-worker"
  content     = file("src/worker/dist/index.js")
}
```

`cloudflare_workers_script` is the legacy v4 resource. In the v5 provider, `terraform destroy` does not reliably delete the Worker when using it, and it tries to upload code via Terraform, conflicting with Wrangler's role. `cloudflare_worker` is the v5-native resource and is correctly removed on destroy.

#### Anti-pattern: missing `subdomain` block → perpetual drift

```hcl
# Drifts on every plan
resource "cloudflare_worker" "demo" {
  account_id = local.cloudflare_account_id
  name       = local.worker_name
  # subdomain omitted
}
```

The Cloudflare API always returns a `subdomain` object for a Worker. When the block is absent, the provider sees a diff on every subsequent `plan`/`apply` and tries to "correct" the resource. Set both `enabled` and `previews_enabled` explicitly.

### The undocumented custom-domain prerequisite: a bootstrap version + deployment

**The problem.** `cloudflare_workers_custom_domain` fails with API error `100124` on a brand-new `cloudflare_worker` — Cloudflare will not attach a custom domain to a Worker that has never been deployed. But Wrangler doesn't run until _after_ `terraform apply` finishes (it needs the Terraform outputs to generate `wrangler.jsonc` first — see "Terraform + Wrangler" below). This is a genuine chicken-and-egg problem: the domain needs a deployment, and the real deployment needs the domain's own infrastructure to already be provisioned.

**The fix.** Give the Worker a one-time, permanently inert placeholder version and deployment, purely to satisfy that ordering requirement, and tell Terraform to never touch either resource again:

```hcl
resource "cloudflare_worker_version" "bootstrap" {
  account_id         = local.cloudflare_account_id
  worker_id          = cloudflare_worker.demo.id
  main_module        = "index.js"
  compatibility_date = "2026-07-27" # any past date; frozen once written, see below

  modules = [{
    name         = "index.js"
    content_type = "application/javascript+module"
    content_base64 = base64encode(<<-JS
      export default {
        async fetch() {
          return new Response("Bootstrapping", { status: 503 });
        },
      };
    JS
    )
  }]

  lifecycle {
    ignore_changes = all
  }
}

resource "cloudflare_workers_deployment" "bootstrap" {
  account_id  = local.cloudflare_account_id
  script_name = cloudflare_worker.demo.name
  strategy    = "percentage"

  versions = [{
    version_id = cloudflare_worker_version.bootstrap.id
    percentage = 100
  }]

  lifecycle {
    ignore_changes = all
  }
}

resource "cloudflare_workers_custom_domain" "demo" {
  account_id = local.cloudflare_account_id
  hostname   = local.hostname
  service    = cloudflare_worker.demo.name
  zone_id    = local.cloudflare_zone_id

  depends_on = [cloudflare_workers_deployment.bootstrap]
}
```

Notes:

- `compatibility_date` should be a **fixed literal string**, not `timestamp()` or "today's date" recomputed on every apply — the value itself is irrelevant after the first apply (the placeholder never actually serves traffic, and `ignore_changes = all` freezes the whole resource), but a stable literal avoids a spurious diff on the very first `terraform plan` after writing the resource, before state exists.
- `ignore_changes = all` is safe **permanently**, not just on the first apply: version/deployment objects are immutable historical records. Every later `wrangler deploy` creates its own new version and deployment that Terraform never sees or reverts.
- No npm-script changes are needed for this — it is entirely a Terraform-side fix and is idempotent across every `terraform apply`.
- When you run `wrangler deploy` for the first time, it creates a new version/deployment on top of the bootstrap one. Both are removed together when the Worker itself is destroyed (see "Teardown ordering" below) — you never need to clean up the bootstrap resources separately.

### D1 database

```hcl
resource "cloudflare_d1_database" "demo" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name}-db"

  read_replication = {
    mode = "disabled" # or "auto" for read replicas
  }
}
```

#### Anti-pattern: omitting `read_replication` → perpetual drift

The Cloudflare API always returns a `read_replication` object in the D1 database response. Omitting the block doesn't fail the **first** apply, but every subsequent `terraform apply` sees a diff and (depending on provider version) either performs a spurious update or hard-fails. Include the block with an explicit `mode` from the start.

### Workers KV

```hcl
resource "cloudflare_workers_kv_namespace" "links" {
  account_id = local.cloudflare_account_id
  title      = "${local.worker_name}-links"
}
```

#### Bulk-write token recipe (Workers KV REST API)

Needed only when a Worker (or a script outside the Worker) writes to KV via the REST bulk endpoint rather than the runtime binding:

```hcl
data "cloudflare_account_api_token_permission_groups_list" "kv_write" {
  account_id = local.cloudflare_account_id
  name       = "Workers%20KV%20Storage%20Write"
}

locals {
  kv_write_permission_group_id = one([
    for g in data.cloudflare_account_api_token_permission_groups_list.kv_write.result :
    g.id if g.name == "Workers KV Storage Write"
  ])
}

resource "cloudflare_account_token" "kv_bulk" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name}-kv-bulk"

  policies = [{
    effect = "allow"
    permission_groups = [{
      id = local.kv_write_permission_group_id
    }]
    # Account-scoped — see the design note below.
    resources = jsonencode({
      "com.cloudflare.api.account.${local.cloudflare_account_id}" = "*"
    })
  }]

  depends_on = [cloudflare_workers_kv_namespace.links]
}
```

**Design note: KV permission groups are account-scoped only.** Probing the live API confirms it — `Workers KV Storage Write`/`Read`/`Metadata Read` all report `"scopes": ["com.cloudflare.api.account"]`, with no per-namespace scope. A per-namespace resource form (`...workers_kv_namespace.<id>`) is rejected with 400. Implication: a KV write token grants write access to **every** namespace in the account. Mitigate by using a dedicated account, recreating the token every provision cycle, or documenting the trade-off inline. R2 tokens, by contrast, **do** support per-bucket scoping — see below.

### R2 bucket, S3 credentials, and CORS

```hcl
resource "cloudflare_r2_bucket" "media" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name}-store"
}
```

If a Worker only ever reads/writes R2 through its `env.MEDIA` runtime binding, this one resource is the entire R2 footprint — no token, no S3 credentials, nothing else to provision. Add the S3-compatible token **only** if something outside the Worker (a CI job, a local script, a presigned-upload flow) needs direct R2 access.

#### S3-compatible token recipe

> This recipe is for R2's **S3-compatible API** specifically. The > `empty-r2-bucket` preteardown CLI (`cloudflare-deploy-scripts` skill) uses the plain bearer-token Cloudflare REST API instead and only needs the `Workers R2 Storage Write` account-level permission group — it never needs the access key ID/secret access key pair derived below.

R2's S3-compatible API requires an `(access_key_id, secret_access_key)` pair, not a bearer token. The v5 provider does **not** ship a purpose-built resource for this — the credential pair is derived from a standard `cloudflare_account_token` per the [R2 tokens reference](https://developers.cloudflare.com/r2/api/tokens/):

- Access Key ID = the API token's `id`;
- Secret Access Key = the **SHA-256 hash** of the API token `value`.

This is reproducible with Terraform's built-in functions — no external script or `null_resource` required.

```hcl
data "cloudflare_account_api_token_permission_groups_list" "r2_bucket_write" {
  account_id = local.cloudflare_account_id
  name       = "Workers%20R2%20Storage%20Bucket%20Item%20Write"
}

locals {
  r2_bucket_write_permission_group_id = one([
    for g in data.cloudflare_account_api_token_permission_groups_list.r2_bucket_write.result :
    g.id if g.name == "Workers R2 Storage Bucket Item Write"
  ])
}

resource "cloudflare_account_token" "media_r2" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name}-store-r2"

  policies = [{
    effect = "allow"
    permission_groups = [{
      id = local.r2_bucket_write_permission_group_id
    }]
    # Bucket-scoped. `default` is the jurisdiction segment for buckets
    # created without an explicit `jurisdiction` (EU/FedRAMP use their
    # own prefixes).
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${local.cloudflare_account_id}_default_${cloudflare_r2_bucket.media.name}" = "*"
    })
  }]
}
```

Derive and expose the S3 pair in `outputs.tf`, both marked sensitive:

```hcl
output "r2_access_key_id" {
  description = "R2 S3-compatible access key ID (the token's id)."
  value       = cloudflare_account_token.media_r2.id
  sensitive   = true
}

output "r2_secret_access_key" {
  description = "R2 S3-compatible secret access key (sha256 of the token value)."
  value       = sha256(cloudflare_account_token.media_r2.value)
  sensitive   = true
}
```

#### Anti-pattern: `cloudflare_r2_api_token` (removed in v5)

```hcl
# DOES NOT EXIST in v5 — hard failure on plan
resource "cloudflare_r2_api_token" "r2_token" {}
```

The v4 provider's dedicated R2-S3-token resource was removed in v5. Use the `cloudflare_account_token` + `sha256(...)` recipe above.

#### R2 CORS: now a native Terraform resource

Earlier v5 releases had **no** R2 CORS resource — CORS had to be applied out-of-band with `wrangler r2 bucket cors set`. As of provider `~> 5.22.0`, `cloudflare_r2_bucket_cors` exists and is the preferred way to manage it if you want CORS under the same `terraform apply`/`destroy` lifecycle as the bucket itself:

```hcl
resource "cloudflare_r2_bucket_cors" "media" {
  account_id  = local.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.media.name

  rules = [{
    id = "browser-uploads"
    allowed = {
      methods = ["GET", "PUT", "HEAD"]
      origins = ["https://${local.hostname}"]
      headers = ["Content-Type"]
    }
    max_age_seconds = 3600
  }]
}
```

If you'd rather keep CORS alongside the rest of your `wrangler.jsonc`-era config (or your provider pin predates 5.22), the Wrangler alternative still works and some teams prefer it because it makes CORS a code concern rather than an infrastructure concern:

```jsonc
// infra/r2-cors.json
[
  {
    "allowedOrigins": ["https://your-app.example.com"],
    "allowedMethods": ["GET", "PUT", "HEAD"],
    "allowedHeaders": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
```

```bash
wrangler r2 bucket cors set my-bucket --force \
  --file infra/r2-cors.json \
  --config src/worker/wrangler.jsonc
```

**When CORS applies at all.** Only when a browser makes direct HTTP requests to R2 objects (presigned uploads/downloads, `fetch()` to a presigned URL). If all R2 access is proxied through the Worker binding, skip CORS entirely.

**S3 credentials are not Worker config.** The Worker reads/writes R2 through `env.MEDIA`, which uses the platform's built-in binding auth — no key/secret involved. The `(access_key_id, secret_access_key)` pair exists solely for out-of-band tools. Never put it in `wrangler.jsonc` `vars`.

### Queues

```hcl
resource "cloudflare_queue" "populate" {
  account_id = local.cloudflare_account_id
  queue_name = "${local.worker_name}-populate"
}
```

Queue bindings themselves belong in Wrangler configuration; Terraform only owns the queue resource.

## Teardown ordering: `depends_on` must point _from_ the Worker _to_ its bindings

**The problem.** A Worker's binding to a D1 database, KV namespace, R2 bucket, or Queue is wired entirely by `wrangler deploy` — it lives in `wrangler.jsonc`, and Terraform has **zero visibility** into it. That means Terraform's dependency graph has **no implicit edge at all** between `cloudflare_worker.demo` and, say, `cloudflare_queue.populate`: nothing in either resource's arguments references the other's `id`. With no edge, `terraform destroy` is free to delete them in any order, including concurrently.

Cloudflare's API refuses to delete a D1 database, KV namespace, R2 bucket, or Queue that a live Worker script still has a binding to. If Terraform deletes the queue before (or concurrently with) the Worker, the queue deletion fails with an in-use error, and `terraform destroy` aborts partway through, leaving the stack in a broken, hard-to-recover state.

**The fix.** Add an explicit `depends_on` **on the `cloudflare_worker` resource**, pointing at every binding-backing resource it uses:

```hcl
resource "cloudflare_worker" "demo" {
  account_id = local.cloudflare_account_id
  name       = local.worker_name

  # ... observability, subdomain ...

  depends_on = [
    cloudflare_d1_database.demo,
    cloudflare_r2_bucket.media,
    cloudflare_workers_kv_namespace.links,
    cloudflare_queue.populate,
  ]
}
```

Why this direction, specifically: Terraform destroys resources in **reverse** dependency order. "`cloudflare_worker` depends_on `cloudflare_queue`" creates the queue first, then the Worker (harmless — they don't actually need each other to exist at creation time, but this ordering is also correct); on **destroy**, Terraform reverses that and removes the **Worker first, then the queue**. By the time Terraform attempts to delete the queue, the Worker (and its binding) is already gone, so the delete succeeds.

**This does not replace the preteardown chain.** `depends_on` fixes _ordering_ between Terraform-known resources. It does not make Terraform aware of the wrangler-managed binding itself, and it does nothing about R2 bucket contents (the API still refuses to delete a non-empty bucket) or container/registry resources Wrangler created. You still need:

1. `destroy-containers` (if applicable) — removes container apps/registry images Wrangler created that Terraform can't see.
2. `wrangler delete --force` — removes the Worker's real deployed script and its bindings.
3. `empty-r2-bucket` — empties any R2 bucket before Terraform tries to delete it (see the next section).
4. `terraform destroy` — now safe: the Worker's binding is long gone (step 2), buckets are empty (step 3), and even if some step were skipped, `depends_on` still forces the correct relative order between `cloudflare_worker` and its binding-backing resources.

For the full preteardown chain and npm-script wiring, load the **`cloudflare-deploy-scripts`** skill.

If a disjoint set of Access resources is intentionally owned by
`cf-access-policy`, run `cf-access-policy remove` before Worker deletion and
before `terraform destroy`. Terraform-owned Access resources need no extra
CLI step and remain governed by Terraform's dependency graph. Never add the
CLI removal step for resources declared in `access.tf`.

## R2 buckets: setup and preteardown

Setting up an R2 bucket is the one-resource block shown above (plus, optionally, `cloudflare_r2_bucket_cors` and an S3 token — see "R2 bucket, S3 credentials, and CORS"). The harder half is **tearing it down**: the R2 API refuses to delete a non-empty bucket, and Terraform has no built-in way to empty one.

The toolkit's `empty-r2-bucket` CLI (from `@adrianhall/cloudflare-toolkit`, documented fully in the `cloudflare-deploy-scripts` skill) solves this without requiring the S3-compatible access key ID/secret access key pair at all — it authenticates with the same account API token already in `.env`, using only the `Workers R2 Storage Write` permission group, and reads the bucket name straight out of Terraform state:

```json
{
  "scripts": {
    "preteardown:worker": "wrangler delete --force --config src/worker/wrangler.jsonc",
    "preteardown:r2": "empty-r2-bucket -t infra --env-file .env --yes",
    "preteardown": "run-s preteardown:worker preteardown:r2",
    "teardown": "terraform -chdir=infra destroy -auto-approve"
  }
}
```

Order `preteardown:r2` **after** `preteardown:worker` — if a Worker is still deployed and mid-export when the empty pass runs, it could keep writing new objects into the bucket between the listing and delete passes. Deleting the Worker first removes that race entirely.

Load the **`cloudflare-deploy-scripts`** skill for the complete CLI flag reference, safety guarantees (`empty-r2-bucket` fails closed on a failed or malformed probe — it never deletes from a partial/unknown state), and the rest of the preteardown chain (`destroy-containers`, etc.).

## Cloudflare AI Gateway

An AI Gateway (`cloudflare_ai_gateway`) and its dynamic routes (`cloudflare_ai_gateway_dynamic_routing` — conditional/rate-limit/spend-limit nodes included) are **fully Terraform-manageable**, end to end, once the gotchas below are worked around. Add it to the list of Terraform-owned infrastructure (alongside D1/KV/R2/Queues) rather than reaching for a hand-written provisioning script.

One consequence worth calling out up front: creating a dynamic route (`POST .../routes`, what `cloudflare_ai_gateway_dynamic_routing`'s create does) auto-deploys it. There is no separate `..._deployment` resource, and none is needed — the one `create` call is both the version and its live deployment.

### Gateway resource

```hcl
resource "cloudflare_ai_gateway" "demo" {
  account_id = local.cloudflare_account_id
  # Unlike most Cloudflare resources, `id` here is a user-chosen slug set
  # directly in HCL — it is not computed/generated by the API.
  id = "${local.demo_name}-gateway"

  cache_invalidate_on_update = true
  cache_ttl                  = 0
  collect_logs               = true
  rate_limiting_interval     = 0
  rate_limiting_limit        = 0

  authentication = false

  # Pin all four explicitly — every one of these silently drifts if omitted,
  # see the anti-pattern below.
  log_management          = 10000000
  log_management_strategy = "DELETE_OLDEST" # or "STOP_INSERTING"
  logpush                 = false
  zdr                     = false
}
```

#### Anti-pattern: omitting `log_management`/`log_management_strategy`/`zdr`/`logpush` → perpetual drift

Same failure class as `cloudflare_worker`'s missing `subdomain` block and `cloudflare_d1_database`'s missing `read_replication` block, above. All four fields are `Optional` in the provider schema, but the API silently fills in its own server-side defaults (`10000000` / `"DELETE_OLDEST"` / `false` / `false`) for whichever ones are left unset. Terraform then reads those server-filled values back on the very next `plan` and — because the config still says nothing, i.e. "should be null" — proposes removing them, forever. `terraform plan` never reaches a clean, no-op state after the first `apply` unless all four are pinned explicitly from the start.

### Dynamic routing: `cloudflare_ai_gateway_dynamic_routing`

```hcl
resource "cloudflare_ai_gateway_dynamic_routing" "basic" {
  account_id = local.cloudflare_account_id
  gateway_id = cloudflare_ai_gateway.demo.id
  name       = "${local.demo_name}-basic-route"

  elements = [
    { id = "start", type = "start", outputs = { next = { element_id = "model" } } },
    {
      id   = "model"
      type = "model"
      properties = {
        model                               = "@cf/meta/llama-3.1-8b-instruct"
        ai_gateway_dynamic_routing_provider = "workers-ai" # see the field-name gotcha below
        timeout                             = 60000
        retries                             = 1
      }
      outputs = { success = { element_id = "end" }, fallback = { element_id = "end" } }
    },
    { id = "end", type = "end", outputs = {} },
  ]

  lifecycle {
    ignore_changes = [elements]
  }
}
```

#### Provider limitation: `elements` is not plan-stable after the first apply

`GET .../routes/{id}` does not return the applied route shape as a top-level `elements` field — it nests the identical array one level down, inside the read-only `version.data` attribute. The resource's `Read` does not map that back onto the top-level `elements` attribute, so every `plan` after a clean `apply` sees `elements` read back empty, diffs that against the non-empty config, and — because `elements` is a list attribute, not a map keyed by a stable id — proposes destroying and recreating the route, every single time, with zero config changes.

**Fix**, in the same spirit as the bootstrap-deployment `ignore_changes = all` exception above: add `lifecycle { ignore_changes = [elements] }`, as shown in the example.

**Consequence.** Because `ignore_changes = [elements]` is required for a stable plan, changing a route's shape later (adding a node, changing a model, etc.) does **not** get picked up by a plain `terraform apply` — it requires a deliberate `terraform apply -replace=cloudflare_ai_gateway_dynamic_routing.<name>`.

#### Gotcha: a schema field is renamed between the raw API and this resource's HCL, and the wrong name is silently dropped, not rejected

The raw JSON API's `properties` for a `model` node use `{ model, provider, retries, timeout }` — but this resource's HCL schema for `elements[].properties` has no `provider` attribute at all; it's `ai_gateway_dynamic_routing_provider`. Using the plain `provider` name is **not** caught by `terraform validate`/`plan`, because `elements[].properties` is a flexible/polymorphic object (it has to support the different node types: `start`/`conditional`/`percentage`/`rate`/`model`/`end`, each with a different shape) — an unrecognized key inside it is silently dropped rather than producing a schema error. The plan looks clean; `apply` then fails at the actual API call:

```text
Error: failed to make http request
POST ".../ai-gateway/gateways/.../routes": 400 Bad Request
{"errors":[{"code":7001,"message":"Required","path":["body","elements",1,"properties","provider"]}]}
```

This generalizes beyond this one resource: for any Cloudflare resource whose schema uses a loosely-typed/polymorphic nested object (as opposed to a strictly-typed nested block), `terraform validate` provides **no protection** against a misnamed key — only a real `apply` against the live API surfaces it. Retrieve `terraform providers schema -json` and cross-check attribute names against a real API response for the resource; don't assume the raw REST field names carry over unchanged into HCL.

#### Gotcha: `conditions` is a plain string containing an undocumented, JSON-encoded query object

`elements[].properties.conditions` (on a `conditional`-type node) is typed as a plain HCL `string`, but the value it must contain — not documented in the provider docs or the generated SDK types — is a small Mongo-style query object keyed by dotted metadata path:

```hcl
properties = {
  conditions = jsonencode({
    "metadata.business" = { "$eq" = "leadership" }
  })
}
```

Same lesson the R2/`cloudflare_account_token` sections above make for `resources`/CORS: the schema says `string`, but the API actually expects a JSON-encoded object — use `jsonencode()`, not a raw HCL map.

## Cloudflare Zero Trust Access

This section applies when **Terraform owns Access**. If Access is the only
infrastructure that needs declarative management, the simpler alternative is
`cf-access-policy` from the `cloudflare-deploy-scripts` skill: a typed
`access.config.ts` reconciles the same reusable-policy/application model
through the `cf` CLI without Terraform state. Do not run both models against
the same named resources.

The v5 Access surface uses a **standalone-policy pattern**: policies and applications are independent resources, and the application references its policies by `{ id, precedence }`. The v4-era pattern of embedding `include`/`decision` inline on the application resource silently drops those blocks in v5 — do not use it.

### Single-policy patterns

The two simplest, most common shapes — public bypass and any-authenticated-user:

```hcl
# Fully public: no Access challenge at all.
resource "cloudflare_zero_trust_access_policy" "public" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name} public access"
  decision   = "bypass"

  include = [{
    everyone = {}
  }]
}

resource "cloudflare_zero_trust_access_application" "public" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name} public"
  domain     = local.hostname
  type       = "self_hosted"

  destinations = [{
    type = "public"
    uri  = local.hostname
  }]

  policies = [{
    id         = cloudflare_zero_trust_access_policy.public.id
    precedence = 1
  }]
}
```

```hcl
# Any authenticated user via a configured identity provider.
resource "cloudflare_zero_trust_access_policy" "authenticated_users" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name} any authenticated user"
  decision   = "allow"

  include = [{
    everyone = {}
  }]
}

resource "cloudflare_zero_trust_access_application" "demo" {
  account_id = local.cloudflare_account_id
  name       = local.worker_name
  domain     = local.hostname
  type       = "self_hosted"

  destinations = [{
    type = "public"
    uri  = local.hostname
  }]

  policies = [{
    id         = cloudflare_zero_trust_access_policy.authenticated_users.id
    precedence = 1
  }]
}
```

`decision = "bypass"` vs `decision = "allow"` is the whole difference between "no Access check" and "must authenticate" — everything else in the policy is identical. A third common single-policy shape restricts to one specific identity rather than everyone:

```hcl
resource "cloudflare_zero_trust_access_policy" "admin" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name} administrator"
  decision   = "allow"

  include = [{
    email = {
      email = local.admin_email
    }
  }]
}
```

### Multi-policy pattern: different rules for different paths

A single hostname can carry more than one `cloudflare_zero_trust_access_application`, each scoped to a different path glob via `domain`/`destinations`. Access evaluates the most specific matching application. This is how a demo gives its public pages no challenge while gating an admin or studio sub-path behind authentication:

```hcl
# Public root: no challenge.
resource "cloudflare_zero_trust_access_policy" "public" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name} public access"
  decision   = "bypass"

  include = [{ everyone = {} }]
}

resource "cloudflare_zero_trust_access_application" "public" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name} public library"
  domain     = local.hostname
  type       = "self_hosted"

  destinations = [{
    type = "public"
    uri  = local.hostname
  }]

  policies = [{
    id         = cloudflare_zero_trust_access_policy.public.id
    precedence = 1
  }]
}

# /studio* and /api/studio*: authenticated only.
resource "cloudflare_zero_trust_access_policy" "studio" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name} studio creators"
  decision   = "allow"

  include = [{ everyone = {} }]
}

resource "cloudflare_zero_trust_access_application" "studio" {
  account_id = local.cloudflare_account_id
  name       = "${local.worker_name} studio"
  domain     = "${local.hostname}/studio*"
  type       = "self_hosted"

  destinations = [
    { type = "public", uri = "${local.hostname}/studio*" },
    { type = "public", uri = "${local.hostname}/api/studio*" },
  ]

  policies = [{
    id         = cloudflare_zero_trust_access_policy.studio.id
    precedence = 1
  }]
}
```

Notes:

- Each `destinations` entry is a separate URI pattern Access enforces — list every route (page routes served by the static-assets binding _and_ the matching API routes) that needs the same protection level; a route left out of every application's `destinations` is left unprotected.
- `destinations` supersedes the deprecated `self_hosted_domains` field. Use `destinations` for new code.
- The `admin`/`studio`/`public` naming in these examples matches the role, not the HTTP verb or resource — keep policy and application names descriptive of _who_ gets in, per the naming conventions above.
- For include/exclude/require condition shapes beyond `everyone`/`email` (gsuite, github, okta, saml, ip, geo, etc.), retrieve the `cloudflare_zero_trust_access_policy` provider docs — there are 20+ condition types and the schema evolves.

### Recovery: 404 on destroy after dashboard deletion

`terraform destroy` fails on `cloudflare_zero_trust_access_application` (or `_policy`) with HTTP 404 when the resource was deleted out-of-band (dashboard, or a previous half-completed destroy). Fix: remove the orphan from state rather than chasing the API:

```bash
terraform -chdir=infra state rm cloudflare_zero_trust_access_application.public
terraform -chdir=infra state rm cloudflare_zero_trust_access_policy.public
```

Then re-run `terraform destroy`.

### Anti-pattern: inline policy on the application

```hcl
# DO NOT — v5 silently drops these blocks
resource "cloudflare_zero_trust_access_application" "app" {
  # ...
  decision = "allow"        # v4-era inline policy — ignored in v5
  include {
    email = ["user@example.com"]
  }
}
```

v5 requires the policy to be a separate `cloudflare_zero_trust_access_policy` resource, referenced from the application's `policies` attribute.

## Outputs and secrets flow

### Outputs must be `string` or `number`

When outputs feed into `generate-wrangler` template substitution (the typical bridge between Terraform and `wrangler.jsonc`), only `string` and `number` Terraform output types are supported. Other types (`list`, `map`, `object`, `set`, `tuple`) cause `generate-wrangler` to exit with code 7. Always output individual scalar values, one per binding, each with a `description`:

```hcl
# Correct
output "d1_database_id" {
  description = "D1 database identifier bound to the Worker as DB in wrangler.jsonc."
  value       = cloudflare_d1_database.demo.id
}

# Wrong — list type, unsupported
output "database_ids" {
  value = [cloudflare_d1_database.demo.id]
}
```

For the substitution mechanics and CLI flags, load the
**`cloudflare-deploy-scripts`** skill.

### Secrets flow direction (one-way only)

```
.env  ──►  Terraform inputs            via  data.dotenv.config.env[...]
                  │
                  ▼
        Terraform apply creates
        sensitive resources
        (account tokens, etc.)
                  │
                  ▼
         Sensitive outputs
                  │
                  ▼
  wrangler.jsonc  via  generate-wrangler   (postprovision)
```

- **Inputs** flow `.env` → Terraform (one-way).
- **Outputs** flow Terraform → `wrangler.jsonc` via `generate-wrangler` (one-way).
- The Worker reads its config from `wrangler.jsonc` at deploy time.

#### Anti-pattern: round-tripping Terraform outputs back into `.env`

```bash
# DO NOT — circular dependency
terraform -chdir=infra output -raw kv_bulk_token >> .env
```

The next `apply` re-ingests the appended value via `dotenv`, and the relationship between input and output state becomes ambiguous. It also forces the operator to copy sensitive values by hand after every provision.

**Fix.** Sensitive Terraform-created values are materialised into `wrangler.jsonc` by `generate-wrangler` from a sensitive output, not copied back to `.env`.

## Validating, formatting, and scanning your Terraform

Run these before every commit and in CI, in this order:

```bash
# 1. Format — deterministic, safe to run any time.
terraform -chdir=infra fmt -recursive

# 2. Validate — requires `terraform init` first (providers must be downloaded).
terraform -chdir=infra init -backend=false   # in CI, if not already initialised
terraform -chdir=infra validate

# 3. Lint — provider-agnostic HCL checks (unused locals, deprecated syntax,
#    naming). Init once per project to fetch its plugin config, then run.
tflint --chdir=infra --init
tflint --chdir=infra --recursive

# 4. Security-scan — misconfiguration checks specific to cloud resources.
trivy config infra/
```

Notes on each tool:

- **`terraform fmt -check`** (not `-recursive`, without writing) is the right form for a CI gate that should fail rather than silently rewrite files — reserve `fmt -recursive` for local pre-commit use.
- **`terraform validate`** catches type errors, missing required arguments, and invalid references, but **not** whether a resource attribute is still valid against the live API — it only checks the provider's schema. Combine it with retrieving current docs (see "Retrieval sources" above) rather than treating a clean `validate` as proof the HCL is correct against the API.
- **`tflint`** is provider-agnostic: it won't know Cloudflare-specific semantics (there is no dedicated Cloudflare ruleset as of this writing), but its core ruleset still catches real mistakes — unused `locals`, invalid type conversions, deprecated `count`/`for_each` idioms — that `validate` doesn't.
- **`tfsec` is in maintenance mode.** Its maintainer (Aqua Security) has consolidated Terraform/IaC scanning into [Trivy](https://github.com/aquasecurity/trivy) and is directing new engineering effort there; `tfsec` "will continue to remain available for the time being" but isn't where checks are being added. **Prefer `trivy config`** for new projects. If a project already has `tfsec` wired into CI, migrating isn't urgent, but don't add fresh `tfsec` adoption to a new project.
- Neither `tflint` nor `trivy`/`tfsec` understands the dotenv-sourced `locals` pattern as "this is where secrets live" out of the box — don't rely on either to catch a hardcoded credential; that's still a manual review item (and the reason credentials never appear as literals in this skill's examples in the first place).

Wire all four into the project's own `check`/`format` scripts alongside JavaScript tooling:

```json
{
  "scripts": {
    "check": "run-s check:*",
    "check:infra": "terraform -chdir=infra validate",
    "check:infra:lint": "tflint --chdir=infra --recursive",
    "check:infra:security": "trivy config infra/",
    "format": "run-s format:*",
    "format:infra": "terraform -chdir=infra fmt -recursive"
  }
}
```

`check:infra` (and the two new steps) requires `terraform init` to have already run — chain it after `preprovision`/`deploy:infra:init` in CI, or run `terraform -chdir=infra init -backend=false` as a dedicated CI-only step first.

## Terraform + Wrangler: who owns what

**Terraform owns infrastructure. Wrangler owns application code and bindings.**

This split is deliberate and endorsed by Cloudflare's own [Workers Infrastructure as Code guide](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/): _"you could use just the `cloudflare_worker` resource and seamlessly use Wrangler or your own deployment tools for Versions or Deployments."_

It's tempting to let Wrangler own the Worker registration too, so a single tool drives the whole stack — but that forces you to split your infrastructure provisioning across two disconnected tools instead of one, and you lose Terraform's unified plan/apply/destroy lifecycle for everything else the Worker depends on (D1, KV, R2, Queues, AI Gateway, Access). Keep all infrastructure provisioning in Terraform, and let Wrangler do exactly one job: deploy code and wire it to the infrastructure Terraform already created.

### The full pipeline, in order

1. `terraform -chdir=infra init`
2. `terraform -chdir=infra apply -auto-approve`
3. `generate-wrangler` — substitutes Terraform outputs into
   `wrangler.jsonc.tpl`, producing `wrangler.jsonc`
4. `wrangler types` (via `generate-wrangler-types`) — regenerates
   `worker-configuration.d.ts`
5. `wrangler d1 migrations apply DB --remote` (if D1 is in play) — run
   with `CI=1` in front to suppress Wrangler's interactive confirmation;
   previously-applied migrations are skipped, so this is safe to run on
   every deploy. Keep `--remote` and a separate `--local` variant as two
   distinct, always-explicit scripts (`db:migrate:remote` /
   `db:migrate:local`) — never omit the flag and rely on a default.
6. `vite build` (or your bundler of choice)
7. `wrangler deploy`

Automating all seven steps behind `npm run deploy` matters more than it sounds — it's exactly the kind of multi-step sequence a human reliably gets wrong by hand (skipping the types regeneration, forgetting `-auto-approve`, deploying before migrating). For the npm-script wiring that implements this pipeline (including the `pre`/`post` lifecycle hooks), load the **`cloudflare-deploy-scripts`** skill.

### Anti-pattern: assuming `terraform destroy` alone tears everything down

```jsonc
// package.json — incomplete teardown
"teardown": "terraform -chdir=infra destroy -auto-approve"
```

Without the preteardown chain (container/registry cleanup, `wrangler delete --force`, `empty-r2-bucket`) described above, `terraform destroy` can fail partway through because a bucket is non-empty, a binding is still live, or container resources remain — even with the `depends_on` fix in place, since `depends_on` only orders Terraform-known resources relative to each other, not the wrangler-side state Terraform never created. Always run the full preteardown chain first.

## Quick reference

| Topic                                                  | Section                                             |
| ------------------------------------------------------ | --------------------------------------------------- |
| dotenv ingestion, provider setup, locals               | `providers.tf`: dotenv, provider setup, and locals  |
| Account vs. user tokens, JSON-encoded policies         | Credentials and token model                         |
| HCL formatting/naming conventions                      | Style guide compliance (HashiCorp)                  |
| File-per-Worker layout, dedicated vs. shared bindings  | Recommended file layout / Per-Worker files...       |
| Worker registration + the custom-domain bootstrap fix  | Per-Worker files: the Worker, its bootstrap...      |
| D1 / KV / R2 / Queues resources and tokens             | Per-Worker files: the Worker, its bootstrap...      |
| Worker-before-bindings destroy ordering                | Teardown ordering: `depends_on` must point...       |
| R2 bucket lifecycle and emptying before destroy        | R2 buckets: setup and preteardown                   |
| Gateway drift, dynamic routing `elements`/gotchas      | Cloudflare AI Gateway                               |
| Single- and multi-path Cloudflare Access               | Cloudflare Zero Trust Access                        |
| Scalar-only outputs, one-way secrets flow              | Outputs and secrets flow                            |
| `fmt`/`validate`/`tflint`/Trivy                        | Validating, formatting, and scanning your Terraform |
| Terraform vs. Wrangler ownership, full deploy pipeline | Terraform + Wrangler: who owns what                 |
