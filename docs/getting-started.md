# Getting Started

This page walks through wiring `@adrianhall/cloudflare-toolkit` into a minimal Hono + Vite +
Workers app, end to end: install, `wrangler.jsonc`, the Worker itself, and local dev via
[`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/).

For a deeper dive into any single piece — [authentication](/guides/authentication),
[logging](/guides/logging), [error handling](/guides/error-handling),
[guards](/guides/defensive-guards), [the CLI](/guides/cli), or [testing](/guides/testing) — see
the [Guides](/guides/) section. For every exported symbol's full signature, see the
[API Reference](/reference/).

## Install

```sh
npm install @adrianhall/cloudflare-toolkit hono
npm install --save-dev vite @cloudflare/vite-plugin wrangler
```

`vite` is an optional peer dependency of this toolkit — only required if you use the
`@adrianhall/cloudflare-toolkit/vite` subpath (`cloudflareAccessPlugin`), as this example does.

If you're using a coding agent (Claude Code, Cursor, opencode, etc.), install the companion
[Agent Skill](https://www.npmjs.com/package/skills) so it knows every export in this package:

```sh
npx skills add adrianhall/cloudflare-toolkit
```

## `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "vars": {
    "ENVIRONMENT": "development",
    "CLOUDFLARE_TEAM_DOMAIN": "my-team.cloudflareaccess.com"
  }
}
```

Run `generate-wrangler-types` (installed as part of this package's `bin`) to keep a
`worker-configuration.d.ts` in sync with this file — see the
[`generate-wrangler-types` guide](/guides/cli) for the full CLI reference.

## The Worker

`src/index.ts` wires all four independent `hono`-subpath middleware/handlers. There is no
combined/coordinator middleware — each is wired explicitly:

```ts
import { Hono } from "hono";
import {
  cloudflareAccess,
  cloudflareLogger,
  problemDetailsErrorHandler,
  notFoundHandler,
  type CloudflareToolkitVariables
} from "@adrianhall/cloudflare-toolkit/hono";
import { notFound } from "@adrianhall/cloudflare-toolkit/errors";

interface AppVariables extends CloudflareToolkitVariables {
  // Add your own Hono context variables here.
}

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Structured logging: attaches a request-scoped Logger to the context.
app.use(cloudflareLogger());

// Cloudflare Access enforcement: /api/version is public, everything else under /api requires a
// valid Access JWT. `enableDevTokens` is gated on a build-time DEV flag — never statically
// `true` in a deployed Worker.
app.use(
  cloudflareAccess({
    policies: [
      { pattern: /^\/api\/version$/, authenticate: false },
      { pattern: /^\/api\//, authenticate: true }
    ],
    enableDevTokens: import.meta.env.DEV
  })
);

app.onError(problemDetailsErrorHandler());
app.notFound(notFoundHandler());

app.get("/api/version", (c) => c.json({ version: "1.0.0" }));

app.get("/api/me", (c) => {
  c.get("LOGGER").info("handling /api/me");
  return c.json({ email: c.get("userEmail") });
});

app.get("/api/widgets/:id", (c) => {
  const widget = findWidget(c.req.param("id"));
  if (!widget) {
    throw notFound({ detail: `No widget with id ${c.req.param("id")}` });
  }
  return c.json(widget);
});

export default app;
```

`Env` above is your own wrangler-generated global binding type (produced by
`generate-wrangler-types`) — the standard Hono `Bindings` generic, not a toolkit-specific type.

## Local development

During `vite dev` there is no real Cloudflare Access sitting in front of the Worker, so
`cloudflareAccessPlugin` emulates it at the Vite connect-middleware layer — the Worker above keeps
only the production `cloudflareAccess` middleware, with no separate dev-only authentication path:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareAccessPlugin } from "@adrianhall/cloudflare-toolkit/vite";

export default defineConfig({
  plugins: [
    // Must come before cloudflare() so its connect middleware runs first and can inject the
    // Access headers before the request reaches the Worker runtime.
    cloudflareAccessPlugin({
      policies: [
        { pattern: /^\/api\/version$/, authenticate: false },
        { pattern: /^\/api\//, authenticate: true }
      ]
    }),
    cloudflare()
  ]
});
```

Then:

```sh
npm run dev
```

Visiting a policy-protected route in the browser during `vite dev` redirects to a local login
form that mints a dev-signed token accepted by the same `cloudflareAccess` middleware running in
the Worker — no real Cloudflare Access deployment required to develop locally.

## Next steps

- [Guides](/guides/) — one per functional area (authentication, logging, error handling,
  defensive guards, the CLI, testing, Vite/Vitest configuration).
- [API Reference](/reference/) — every exported symbol, generated from source.
- [Changelog](/changelog) — what shipped in each release.
