---
"@adrianhall/cloudflare-toolkit": patch
---

Export public-signature types that were referenced by a subpath's public API but not themselves
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
