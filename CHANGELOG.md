# @adrianhall/cloudflare-toolkit

## Next release

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
