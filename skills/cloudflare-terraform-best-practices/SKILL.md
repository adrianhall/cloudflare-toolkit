---
name: cloudflare-terraform-best-practices
description: Terraform v5 best practices for the Cloudflare provider, organized by Cloudflare service (Workers, D1, Workers KV, R2, Queues, Zero Trust Access). Covers the dotenv-not-TF_VAR_ ingestion pattern, account vs user tokens, JSON-encoded resources, per-service idempotency requirements, the Terraform/Wrangler boundary, and teardown ordering. Load when writing or reviewing Cloudflare infrastructure-as-code.
---

# Cloudflare Terraform Best Practices (v5 provider)

This skill captures the non-obvious rules, idempotency requirements, and
anti-patterns that surface when running the **Cloudflare Terraform v5
provider** (`cloudflare/cloudflare ~> 5.0`) against a real Cloudflare
account. Each section below is the resolution of a real failure mode and
ships with working v5 HCL.

**Scope:** Terraform schema, resource shapes, token model, secrets flow,
teardown ordering. Patterns are grouped by Cloudflare _service_, not by
underlying resource name.

**Out of scope:** CLI tooling that bridges Terraform and Wrangler
(`generate-wrangler`, `generate-wrangler-types`, `destroy-containers`) and npm-script wiring. Those live in the sibling
**`cloudflare-deploy-scripts`** skill.

> The v5 provider made significant breaking changes from v4 — attribute
> names, block shapes, nested syntax (attribute lists `[{ ... }]` instead
> of repeated HCL blocks), and resource responsibilities all changed.
> Several v4 resources have been removed. Do not rely on pre-trained
> knowledge for v5 HCL — always retrieve the docs.

## Retrieval Sources

**Always retrieve the provider docs before writing or reviewing any
`cloudflare_*` resource.** Schemas, required fields, and available
attributes change across releases.

| Source                                | URL                                                                                    | Use for                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Cloudflare v5 provider docs           | `https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs`            | Every `cloudflare_*` resource and data source: schema, required fields, import syntax      |
| Cloudflare v5 provider source (docs/) | `https://github.com/cloudflare/terraform-provider-cloudflare/tree/main/docs/resources` | Same docs in plain markdown — useful when the Registry's JS-rendered UI is awkward to read |
| Cloudflare Workers IaC guide          | `https://developers.cloudflare.com/workers/platform/infrastructure-as-code/`           | Binding types in Terraform, Durable Object migration caveats, version/deployment model     |
| Cloudflare Terraform overview         | `https://developers.cloudflare.com/terraform/`                                         | Provider setup, account permissions, getting started                                       |
| jrhouston/dotenv provider             | `https://registry.terraform.io/providers/jrhouston/dotenv/latest/docs`                 | `dotenv` data source options and file path resolution                                      |
| R2 tokens reference                   | `https://developers.cloudflare.com/r2/api/tokens/`                                     | S3 credential derivation rule for R2                                                       |

When a pre-trained assumption about a resource attribute conflicts with
the live docs, **trust the docs**.

## Provider setup

### `versions.tf`

```hcl
terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    dotenv = {
      source  = "jrhouston/dotenv"
      version = "~> 1.0"
    }
  }
}
```

No backend block is prescribed — choose your own (local, Terraform Cloud,
S3, etc.).

### Credentials and inputs via dotenv (not `TF_VAR_*`)

All Terraform inputs flow through the **`jrhouston/dotenv`** data source.
Credentials live in a `.env` file at the **project root** (not inside
`infra/`).

```hcl
# infra/main.tf
data "dotenv" "env" {
  filename = "../.env"   # relative to the Terraform working directory
}

locals {
  account_id     = data.dotenv.env.env.CLOUDFLARE_ACCOUNT_ID
  workers_domain = data.dotenv.env.env.CLOUDFLARE_WORKERS_DOMAIN
  team_domain    = data.dotenv.env.env.CLOUDFLARE_TEAM_DOMAIN
  idp_id         = data.dotenv.env.env.CLOUDFLARE_IDP_ID
  worker_name    = data.dotenv.env.env.CLOUDFLARE_WORKER_NAME
}

provider "cloudflare" {
  api_token = data.dotenv.env.env.CLOUDFLARE_API_TOKEN
}
```

No `variable {}` blocks are required — every input is in `.env`.

**`.env`** (gitignored):

```
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_WORKERS_DOMAIN=your-subdomain.workers.dev
CLOUDFLARE_TEAM_DOMAIN=your-team.cloudflareaccess.com
CLOUDFLARE_WORKER_NAME=my-worker
# any other project-specific inputs
```

#### Anti-pattern: relying on `TF_VAR_*` env vars from npm scripts

```jsonc
// package.json — DO NOT do this
"provision": "TF_VAR_worker_name=my-worker terraform -chdir=infra apply -auto-approve"
```

**Why it fails.** Terraform's `TF_VAR_<name>` convention only populates
`var.<name>` when the variable is **exported by the shell that invokes
`terraform apply`**. `npm run provision` (and pnpm, yarn equivalents) runs
Terraform in a fresh npm-script shell that does **not** auto-source `.env`.
Even if the operator sourced `.env` in their interactive shell, the value
won't reach Terraform — and Terraform will fall back to its interactive
prompt, breaking `-auto-approve`.

**Fix.** Thread every input through `data.dotenv.env.env.*`. The operator
runs a plain `npm run provision` from any shell with no preparation steps.

## Credentials and token model

This section is cross-cutting — every Cloudflare service that needs an
API token follows the same rules.

### User tokens vs account tokens

The v5 provider exposes **two** distinct token resources. The choice is
not stylistic — it's determined by what kind of credential will run
`terraform apply`.

| Resource / data source                                | Endpoint                                      | Auth required                                                            |
| ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `cloudflare_api_token`                                | `POST /user/tokens`                           | User-level credentials (email + Global API Key, or user-owned API token) |
| `cloudflare_account_token`                            | `POST /accounts/{id}/tokens`                  | Account API token with `Account API Tokens: Edit`                        |
| `cloudflare_api_token_permission_groups_list`         | `GET /user/tokens/permission_groups`          | User-level only                                                          |
| `cloudflare_account_api_token_permission_groups_list` | `GET /accounts/{id}/tokens/permission_groups` | Account API token                                                        |

For a fully-automated stack driven by a single `CLOUDFLARE_API_TOKEN` (an
**account** API token), the answer is always:

- `cloudflare_account_token` for token resources, and
- `cloudflare_account_api_token_permission_groups_list` for the
  permission-groups lookup.

#### Anti-pattern: `cloudflare_api_token` under an account API token

```hcl
# DO NOT — provider is configured with an account API token
resource "cloudflare_api_token" "kv_bulk" {     # user-level resource
  name = "kv-bulk"
  # ...
}
```

Apply fails with HTTP 403 / error code `9109`:

> `"Valid user-level authentication not found"`

The request hits `/user/tokens`, which an account API token is not
authorised to call.

**Fix.** Use `cloudflare_account_token` instead (see the working recipes
in the KV and R2 sections below). The same fix applies to the
permission-groups data source — use the `_account_` form.

### JSON-encoded `resources` block

`policies[].resources` on `cloudflare_account_token` (and
`cloudflare_api_token`) is typed `String`. The Cloudflare API expects a
**JSON object string**. The provider rejects HCL maps.

#### Anti-pattern: writing `resources` as an HCL map

```hcl
# DO NOT — v5 rejects this
resources = {
  "com.cloudflare.api.account.${local.account_id}" = "*"
}
```

#### Correct form

```hcl
resources = jsonencode({
  "com.cloudflare.api.account.${local.account_id}" = "*"
})
```

### URL-encoded `name` filter on the permission-groups data source

The `name` argument on
`data.cloudflare_account_api_token_permission_groups_list` is forwarded
verbatim to the API as a query-string filter. Spaces break the request —
the API contract requires URL encoding.

```hcl
# Correct:
data "cloudflare_account_api_token_permission_groups_list" "kv_write" {
  account_id = local.account_id
  name       = "Workers%20KV%20Storage%20Write"   # URL-encoded
}

# Then extract the id:
locals {
  kv_write_permission_group_id = one([
    for g in data.cloudflare_account_api_token_permission_groups_list.kv_write.result :
    g.id if g.name == "Workers KV Storage Write"
  ])
}
```

Symptom of using the unencoded form: the data source returns zero
results (the filter never matches), and `one(...)` raises an error
because the list is empty.

## Cloudflare Workers

### Canonical example

```hcl
resource "cloudflare_worker" "worker" {
  account_id = local.account_id
  name       = local.worker_name

  observability = {
    enabled            = true
    head_sampling_rate = 1
  }

  subdomain = {
    enabled          = true
    previews_enabled = false
  }
}
```

The `cloudflare_worker` resource **registers** the worker; `wrangler
deploy` later attaches the code, bindings, and deployment metadata. These
are separate concerns — see "Outputs and secrets flow" and "Teardown
ordering" below for the implications.

#### Anti-pattern: `cloudflare_workers_script` (legacy v4 resource)

```hcl
# DO NOT use in v5
resource "cloudflare_workers_script" "worker" {
  account_id  = local.account_id
  script_name = "my-worker"
  content     = file("src/worker/dist/index.js")
}
```

**Why.** `cloudflare_workers_script` is the legacy v4 resource. In the
v5 provider, `terraform destroy` does not reliably delete the Worker
when using `cloudflare_workers_script`. It also tries to upload code via
Terraform, which conflicts with Wrangler's role.

`cloudflare_worker` is the v5-native resource and is correctly removed
on destroy.

#### Anti-pattern: missing `subdomain` block → perpetual drift

```hcl
# Drifts on every plan
resource "cloudflare_worker" "worker" {
  account_id = local.account_id
  name       = local.worker_name
  # subdomain omitted
}
```

The Cloudflare API always returns a `subdomain` object for a worker. When
the block is absent from the Terraform resource, the provider sees a
diff on every subsequent `terraform plan` / `terraform apply` and tries
to "correct" the resource. Setting both `enabled` and `previews_enabled`
explicitly makes the resource idempotent. The values shown above
(`enabled = true`, `previews_enabled = false`) match the wrangler deploy's
default.

## Cloudflare D1

### Canonical example

```hcl
resource "cloudflare_d1_database" "db" {
  account_id = local.account_id
  name       = "${local.worker_name}-db"

  read_replication = {
    mode = "disabled"        # or "auto" if you want read replicas
  }
}
```

#### Anti-pattern: omitting `read_replication` → perpetual drift

```hcl
# Drifts on every plan
resource "cloudflare_d1_database" "db" {
  account_id = local.account_id
  name       = "my-worker-db"
  # read_replication omitted
}
```

The Cloudflare API always returns a `read_replication` object in the D1
database response. When the block is absent, the v5 provider sees a diff
on every subsequent `terraform apply` and attempts to update the
resource. Depending on the provider version, this either produces a
spurious update every run or a hard failure on the second apply.
Including the block with an explicit `mode` makes the resource fully
idempotent.

## Cloudflare Workers KV

### Canonical example

```hcl
resource "cloudflare_workers_kv_namespace" "data" {
  account_id = local.account_id
  title      = "${local.worker_name}-data"
}
```

### Bulk-write token recipe (Workers KV REST API)

When a Worker writes to KV via the REST bulk endpoint (rather than the
runtime KV binding), it needs a bearer token. Create one with the
`Workers KV Storage Write` permission group:

```hcl
data "cloudflare_account_api_token_permission_groups_list" "kv_write" {
  account_id = local.account_id
  name       = "Workers%20KV%20Storage%20Write"   # URL-encoded
}

locals {
  kv_write_permission_group_id = one([
    for g in data.cloudflare_account_api_token_permission_groups_list.kv_write.result :
    g.id if g.name == "Workers KV Storage Write"
  ])
}

resource "cloudflare_account_token" "kv_bulk" {
  account_id = local.account_id
  name       = "${local.worker_name}-kv-bulk"

  policies = [{
    effect = "allow"
    permission_groups = [{
      id = local.kv_write_permission_group_id
    }]
    # Account-scoped: see the design note below.
    resources = jsonencode({
      "com.cloudflare.api.account.${local.account_id}" = "*"
    })
  }]

  depends_on = [cloudflare_workers_kv_namespace.data]
}
```

### Design note: KV permission groups are account-scoped only

Probing the live API confirms it:

```
GET /accounts/{id}/tokens/permission_groups?name=Workers%20KV%20Storage%20Write
{
  "result": [{
    "id":     "f7f0eda5697f475c90846e879bab8666",
    "name":   "Workers KV Storage Write",
    "scopes": ["com.cloudflare.api.account"]   // ← account only
  }]
}
```

The `scopes` array is exhaustive — there is **no per-namespace scope
available** for `Workers KV Storage Write`, `Workers KV Storage Read`,
or `Workers KV Storage Metadata Read`. Attempting a per-namespace
resource form is rejected by the API:

```
POST /accounts/{id}/tokens
400 Bad Request: "com.cloudflare.api.account.<id>.workers_kv_namespace.<id>"
                  is not a supported resource type
```

**Implication.** A `Workers KV Storage Write` token grants write access
to every namespace in the account. Acceptable mitigation strategies:

- Use a dedicated test account so the only sensitive namespace is the
  one you own.
- Recreate the token on every provision cycle so its lifetime tracks
  the stack's lifetime.
- Document the trade-off as an inline comment on the resource so a
  future operator promoting the pattern to production sees it before
  copy/pasting.

For comparison, R2 token permission groups **do** support per-bucket
scoping — see the R2 section below.

## Cloudflare R2

### Bucket

```hcl
resource "cloudflare_r2_bucket" "exports" {
  account_id = local.account_id
  name       = "${local.worker_name}-exports"
}
```

### S3-compatible token recipe

> This recipe is for R2's **S3-compatible API** specifically. The
> `empty-r2-bucket` preteardown CLI (`cloudflare-deploy-scripts` skill)
> uses the plain bearer-token Cloudflare REST API instead and only needs
> the `Workers R2 Storage Write` account-level permission group — it
> never needs the access key ID/secret access key pair derived below.

R2's S3-compatible API requires an `(access_key_id, secret_access_key)`
pair, not a bearer token. The v5 provider does **not** ship a
purpose-built resource for this — the credential pair is derived from a
standard `cloudflare_account_token` per the
[R2 tokens reference](https://developers.cloudflare.com/r2/api/tokens/):

> Access Key ID = the API token's `id`.
> Secret Access Key = the **SHA-256 hash** of the API token `value`.

The derivation is reproducible in Terraform with built-in functions — no
external script or `null_resource` required.

```hcl
data "cloudflare_account_api_token_permission_groups_list" "r2_bucket_write" {
  account_id = local.account_id
  name       = "Workers%20R2%20Storage%20Bucket%20Item%20Write"
}

locals {
  r2_bucket_write_permission_group_id = one([
    for g in data.cloudflare_account_api_token_permission_groups_list.r2_bucket_write.result :
    g.id if g.name == "Workers R2 Storage Bucket Item Write"
  ])
}

resource "cloudflare_account_token" "exports_r2" {
  account_id = local.account_id
  name       = "${local.worker_name}-exports-r2"

  policies = [{
    effect = "allow"
    permission_groups = [{
      id = local.r2_bucket_write_permission_group_id
    }]
    # Bucket-scoped resource form. `default` is the jurisdiction segment
    # for buckets created without an explicit `jurisdiction` (the EU and
    # FedRAMP jurisdictions use their own prefixes).
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${local.account_id}_default_${cloudflare_r2_bucket.exports.name}" = "*"
    })
  }]
}
```

Then in `outputs.tf`, derive the S3 pair and mark both sensitive:

```hcl
output "r2_token_id" {
  value     = cloudflare_account_token.exports_r2.id           # Access Key ID
  sensitive = true
}

output "r2_token_value" {
  value     = sha256(cloudflare_account_token.exports_r2.value) # Secret Access Key
  sensitive = true
}

# Optional. Omit this output for default/automatic placement.
output "r2_jurisdiction" {
  value = "eu" # "eu" or "fedramp"; default is "auto"
}
```

#### Anti-pattern: `cloudflare_r2_api_token` (removed in v5)

```hcl
# DOES NOT EXIST in v5 — hard failure on plan
resource "cloudflare_r2_api_token" "r2_token" {
  # ...
}

output "r2_token_id" {
  value = cloudflare_r2_api_token.r2_token.access_key_id   # ← never resolves
}
```

The v4 provider had a dedicated `cloudflare_r2_api_token` resource that
exposed `access_key_id` and `secret_access_key` directly. The v5
provider rewrote the token surface and **removed** that resource. Use
the `cloudflare_account_token` + `sha256(...)` recipe above instead.

| Resource family | v4                                                             | v5                                                    |
| --------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| User token      | `cloudflare_api_token` (also exposed S3 fields via `r2_token`) | `cloudflare_api_token` (no S3 fields)                 |
| Account token   | —                                                              | `cloudflare_account_token` (no S3 fields)             |
| R2 S3 token     | `cloudflare_r2_api_token`                                      | — _(removed; derive from `cloudflare_account_token`)_ |

### R2 CORS (provider gap → wrangler)

The v5 provider does **not** support R2 CORS policies. Browsers that
make direct HTTP requests to an R2 bucket (presigned uploads/downloads,
HEAD checks) send a CORS pre-flight (`OPTIONS`) request, and R2 rejects
it without an explicit CORS policy on the bucket.

CORS must be applied via the **Wrangler CLI** after the bucket is
provisioned. Create a CORS configuration file:

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

and apply it with a `provision:r2-cors` npm script:

```json
{
  "scripts": {
    "provision:r2-cors": "wrangler r2 bucket cors set my-bucket --file infra/r2-cors.json --force --config src/worker/wrangler.jsonc"
  }
}
```

Run `npm run provision:r2-cors` after `npm run provision` (it requires
`wrangler.jsonc` to exist).

**When this applies.** Any time a web application makes direct HTTP
requests to R2 objects (`fetch()` to a presigned URL, etc.). If all R2
access is proxied through your Worker (the Worker reads/writes R2 via
its binding, and the browser only talks to the Worker), CORS
configuration on the bucket is not required.

### S3 credentials are not Worker config

The Worker reads and writes R2 through its `env.R2_*` binding, which
uses the platform's built-in service-binding auth (no key/secret
involved). The `(access_key_id, secret_access_key)` pair exists solely
for **out-of-band** tools that call the R2 S3 endpoint. Do not put the S3 pair into `wrangler.jsonc`
`vars` — it would be dead config the Worker code never touches, and
broadens the credentials' blast radius unnecessarily.

## Cloudflare Queues

### Canonical example

```hcl
resource "cloudflare_queue" "populate" {
  account_id = local.account_id
  queue_name = "${local.worker_name}-populate"
}
```

Queue bindings belong in Wrangler configuration. This skill does not
claim that the toolkit can unbind queues individually; its supported
teardown workflow deletes the Worker before Terraform destroys queues.

## Cloudflare Zero Trust Access

The v5 Access surface uses a **standalone-policy pattern**: policies and
applications are independent resources, and the application references
its policies by `{ id, precedence }`. The v4-era pattern of embedding
`include` / `decision` inline on the application resource silently drops
those blocks in v5 — do not use it.

### Canonical example

```hcl
# Policy — standalone, no `application_id`, so it can be referenced from
# any number of applications. The v5 schema is attribute-list syntax:
# `include = [{ ... }]`, not repeated HCL `include { ... }` blocks.
resource "cloudflare_zero_trust_access_policy" "allow_idp" {
  account_id = local.account_id
  name       = "${local.worker_name} - Allow IdP users"
  decision   = "allow"

  include = [{
    login_method = {
      id = local.idp_id     # the configured CLOUDFLARE_IDP_ID
    }
  }]
}

# Application — references the policy by id + precedence.
resource "cloudflare_zero_trust_access_application" "app" {
  account_id                = local.account_id
  name                      = local.worker_name
  type                      = "self_hosted"
  session_duration          = "24h"
  allowed_idps              = [local.idp_id]
  auto_redirect_to_identity = true

  destinations = [{
    type = "public"
    uri  = "${local.worker_name}.${local.workers_domain}"
  }]

  policies = [{
    id         = cloudflare_zero_trust_access_policy.allow_idp.id
    precedence = 1
  }]
}
```

Notes:

- `destinations` supersedes the deprecated `self_hosted_domains` field.
  Use `destinations` for new code; `self_hosted_domains` is supported
  through November 21, 2025 and will be removed thereafter.
- Multiple policies can be attached by adding entries to `policies`. The
  `precedence` ordering controls evaluation order (lower runs first).
- For include/exclude/require condition shapes (email, gsuite, github,
  okta, saml, ip, geo, etc.), retrieve the
  `cloudflare_zero_trust_access_policy` provider docs — there are 20+
  condition types and the schema evolves.

### Recovery: 404 on destroy after dashboard deletion

`terraform destroy` fails on `cloudflare_zero_trust_access_application`
(or `cloudflare_zero_trust_access_policy`) with HTTP 404 when the
resource has been deleted out-of-band — typically from the dashboard, or
by a previous half-completed destroy.

**Fix.** Remove the orphan from Terraform state, don't chase the API:

```bash
terraform -chdir=infra state rm cloudflare_zero_trust_access_application.app
terraform -chdir=infra state rm cloudflare_zero_trust_access_policy.allow_idp
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

v5 requires the policy to be a separate `cloudflare_zero_trust_access_policy`
resource, referenced from the application's `policies` attribute.

## Outputs and secrets flow

### Outputs must be `string` or `number`

When outputs feed into `generate-wrangler` template substitution (the
typical bridge between Terraform and `wrangler.jsonc`), only `string`
and `number` Terraform output types are supported. Other types (`list`,
`map`, `object`, `set`, `tuple`) cause `generate-wrangler` to exit with
code 7. Always output individual scalar values, one per binding:

```hcl
# Correct
output "d1_database_id" {
  value = cloudflare_d1_database.db.id
}

# Wrong — list type, unsupported
output "database_ids" {
  value = [cloudflare_d1_database.db.id]
}
```

For the substitution mechanics and CLI flags, load the
**`cloudflare-deploy-scripts`** skill.

### Secrets flow direction (one-way only)

```
.env  ──►  Terraform inputs            via  data.dotenv.env.env.*
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
- **Outputs** flow Terraform → `wrangler.jsonc` via `generate-wrangler`
  (one-way).
- The Worker reads its config from `wrangler.jsonc` at deploy time.

#### Anti-pattern: round-tripping Terraform outputs back into `.env`

```bash
# DO NOT — circular dependency
terraform -chdir=infra output -raw kv_bulk_token >> .env
```

The next `terraform apply` reads `.env`, the dotenv provider re-ingests
the appended value, and the relationship between input and output state
becomes ambiguous. It also forces the operator to copy sensitive values
by hand after every provision.

**Fix.** Sensitive Terraform-created values are materialised into
`wrangler.jsonc` by `generate-wrangler` from a sensitive output, not
copied back to `.env`.

## Teardown ordering

### General principle: anything Wrangler attaches is invisible to Terraform

`@adrianhall/cloudflare-toolkit`'s deployment CLIs deliberately split responsibility:

- **Terraform** creates infrastructure resources: `cloudflare_worker`,
  `cloudflare_queue`, `cloudflare_workers_kv_namespace`,
  `cloudflare_r2_bucket`, `cloudflare_d1_database`, account tokens,
  Access apps and policies.
- **Wrangler** attaches code and configured bindings on top and can also
  create container resources and version-scoped state.

Terraform has **no visibility** into the wrangler-side configuration.
Container apps and registry images plus R2 bucket contents require
explicit cleanup before `terraform destroy` runs.

### Canonical preteardown chain

In dependency order:

1. **Delete container applications and registry images** with
   `destroy-containers` while Worker/container discovery is still
   available.
2. **`wrangler delete --force`** to remove the Worker entirely.
3. **Empty R2 buckets** with `empty-r2-bucket`. The R2 API refuses to
   delete a non-empty bucket. Order this after `wrangler delete` so a
   worker stuck mid-export cannot keep writing objects into the bucket
   between the listing and the delete passes. `empty-r2-bucket -t infra
--env-file .env --yes` reads the `account_id` and `r2_bucket_name`
   Terraform outputs directly and works with only the `Workers R2
Storage Write` account-level permission group — no S3-compatible
   access key ID/secret access key pair required.
4. **`terraform destroy`.** With the wrangler-side state gone and R2
   buckets empty, Terraform can clean up the underlying resources in
   reverse dependency order.

For the container and R2 cleanup CLIs and recommended `preteardown:*` npm script wiring, load the
**`cloudflare-deploy-scripts`** skill.

### Anti-pattern: assuming `terraform destroy` will clean everything

```jsonc
// package.json — incomplete teardown
"teardown": "terraform -chdir=infra destroy -auto-approve"
```

Without the preteardown chain, `terraform destroy` can fail partway through because a bucket is
non-empty or container resources remain. This leaves the stack in a broken state that is painful
to recover by hand. Always wire the dependency-safe `preteardown` chain first.

## Quick reference: file layout

A typical `infra/` directory:

| File          | Purpose                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `versions.tf` | Provider pins: `cloudflare/cloudflare ~> 5.0`, `jrhouston/dotenv ~> 1.0`.              |
| `main.tf`     | Dotenv ingestion, provider configuration, core resources (worker, KV, D1, R2, queues). |
| `access.tf`   | Zero Trust standalone policy + application.                                            |
| `*-token.tf`  | One file per service-specific account token (R2, KV bulk, etc.).                       |
| `outputs.tf`  | Scalar string/number outputs consumed by `generate-wrangler`.                          |
