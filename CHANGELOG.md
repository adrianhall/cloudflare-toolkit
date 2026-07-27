# @adrianhall/cloudflare-toolkit

## 2.1.0

### Minor Changes

- 0ab0f5e: `cloudflareLogger` now honors a `LOG_LEVEL` Worker binding (`c.env.LOG_LEVEL`) to set the minimum
  log level. It accepts any of the six levels (`trace`/`debug`/`info`/`warn`/`error`/`fatal`,
  case-insensitive) and sits below an explicit `options.level` but above the
  `resolveLoggerConfig(env.ENVIRONMENT, "worker")` default. A value that is set but unrecognized is
  ignored with a `console.warn`, and an unset binding preserves the previous behavior.

## 2.0.0

### Major Changes

- cad6fcd: Replace the Cloudflare Access user context variables with a namespaced identity object that includes its credential source.

## 1.0.2

### Patch Changes

- 8c6453c: Improved documentation across the project with enhanced clarity, examples, and organization.

## 1.0.1

### Patch Changes

- 125077c: Add `contentTooLarge` (413) to the framework-agnostic root entry point's re-exports. It was added
  to `@adrianhall/cloudflare-toolkit/errors` after the root barrel was originally wired and was
  never backfilled — every other error generator was already re-exported from
  `@adrianhall/cloudflare-toolkit`.

  Also adds the corresponding `contentTooLarge(input?)` | `413` row to `skills/cloudflare-toolkit/SKILL.md`'s
  HTTP Errors table, which previously omitted it as well.

## 1.0.0

### Major Changes

- 6149b53: First stable release of `@adrianhall/cloudflare-toolkit`, published via automated npm OIDC Trusted Publishing.

### Patch Changes

- 8745a07: Export public-signature types that were referenced by a subpath's public API but not themselves
  exported, causing TypeDoc's generated API Reference to render them as unlinkable plain text
  instead of a page:

  - `PathPolicy` — now exported from both `/hono` and `/vite` (used by
    `CloudflareAccessOptions.policies` and `CloudflareAccessPluginOptions.policies`)
  - `HttpErrorInput` — now exported from `/errors` (the shared `input?` parameter type on every
    HTTP error generator)
  - `DevLoginUser` — now exported from `/vite` (used by `CloudflareAccessPluginOptions.users`)
  - `ProblemTypeDefinition`, `ProblemTypeRegistry`, and `CreateOptions` — now exported from
    `/problem-details` (the parameter/return shapes of `createProblemTypeRegistry()` and its
    returned registry's `create()` method)

  These are type-only additions with no runtime behavior change.
