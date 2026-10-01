# @adrianhall/cloudflare-toolkit

## Next release

- 56f2d09 (patch): Widened the optional `cf` peer dependency from `>=0.6.0 <1` to `>=0.6.0 <2 || >=1.0.0-0 <2`, so `cf` 1.0 prereleases (e.g. `1.0.0-beta.6`) and stable 1.x releases satisfy it without a peer-dependency warning, while still excluding 2.x.

## 2.6.0

- 1be6e0d (minor): Added `readTerraformOutputs`/`requireTerraformOutputs` to `@adrianhall/cloudflare-toolkit/vite` for bridging `terraform output -json` into a `cloudflare.config.ts` file (the `cf` CLI/`defineWorker` era successor to `generate-wrangler --terraform`), and documented the pattern in the `cloudflare-terraform-best-practices` skill.
- 5431835 (minor): Added the `cf-inventory` CLI for deterministic, fail-closed inventory and deletion-readiness assessment across Cloudflare Developer Platform resources.
- 3a81593 (patch): Widened the `cf` peer dependency from `^0.6.0` to `>=0.6.0 <1` and marked it optional, so consumers who don't invoke `cf-access-policy` are no longer forced to install `cf` or bypass npm's strict peer-dependency resolution when using current `cf` releases (e.g. `0.10.0`).

## 2.5.1

- 634360f (patch): Fixed `cf-access-policy` Access discovery incorrectly treating a successful `cross-spawn` result with `error: null` as a launch failure, causing `Cannot read properties of null (reading 'message')` even when the underlying `cf` command succeeded.

## 2.5.0

- 3174aa2 (minor): Added the `cf-access-policy` CLI for reconciling reusable Cloudflare Access policies and self-hosted applications from a typed `access.config.ts`, plus the root `defineAccessConfig` helper and configuration types.
- 4f1d2a8 (minor): Added `preconditionFailed` (412) and `preconditionRequired` (428) HTTP error generators to `@adrianhall/cloudflare-toolkit/errors`, matching the signature/shape of every other generator.

## 2.4.0

- 400fbae (minor): Added path-specific audience checking to the cloudflareAccess() middleware.

## 2.3.0

- 59fca9e (minor): Added `empty-r2-bucket` CLI command to empty an R2 bucket using an undocumented dashboard API

## 2.2.1

- 72d5a52 (patch): Updated release pipeline so that it no longer requires two pull requests.

## 2.2.0

- 950a368 (minor): Add Terraform-to-Wrangler generation and a fail-closed container preteardown CLI, including deployment documentation and Terraform Agent Skills.

## 2.1.0

- 0ab0f5e (minor): `cloudflareLogger` now honors a `LOG_LEVEL` Worker binding (`c.env.LOG_LEVEL`) to set the minimum log level. It accepts any of the six levels (`trace`/`debug`/`info`/`warn`/`error`/`fatal`, case-insensitive) and sits below an explicit `options.level` but above the `resolveLoggerConfig(env.ENVIRONMENT, "worker")` default. A value that is set but unrecognized is ignored with a `console.warn`, and an unset binding preserves the previous behavior.

## 2.0.0

- cad6fcd (major): Replace the Cloudflare Access user context variables with a namespaced identity object that includes its credential source.

## 1.0.2

- 8c6453c (patch): Improved documentation across the project with enhanced clarity, examples, and organization.

## 1.0.1

- 125077c (patch): Add `contentTooLarge` (413) to the framework-agnostic root entry point's re-exports. It was added to `@adrianhall/cloudflare-toolkit/errors` after the root barrel was originally wired and was never backfilled — every other error generator was already re-exported from `@adrianhall/cloudflare-toolkit`.

  Also adds the corresponding `contentTooLarge(input?)` | `413` row to `skills/cloudflare-toolkit/SKILL.md`'s HTTP Errors table, which previously omitted it as well.

## 1.0.0

- 6149b53 (major): First stable release of `@adrianhall/cloudflare-toolkit`, published via automated npm OIDC Trusted Publishing.
- 8745a07 (patch): Export public-signature types that were referenced by a subpath's public API but not themselves exported, causing TypeDoc's generated API Reference to render them as unlinkable plain text instead of a page:

  - `PathPolicy` — now exported from both `/hono` and `/vite` (used by `CloudflareAccessOptions.policies` and `CloudflareAccessPluginOptions.policies`)
  - `HttpErrorInput` — now exported from `/errors` (the shared `input?` parameter type on every HTTP error generator)
  - `DevLoginUser` — now exported from `/vite` (used by `CloudflareAccessPluginOptions.users`)
  - `ProblemTypeDefinition`, `ProblemTypeRegistry`, and `CreateOptions` — now exported from `/problem-details` (the parameter/return shapes of `createProblemTypeRegistry()` and its returned registry's `create()` method)

  These are type-only additions with no runtime behavior change.
