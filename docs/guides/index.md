# Guides

One guide per functional area, each expanding on the corresponding
[Getting Started](/getting-started) snippet with fuller worked examples:

- [Authentication](/guides/authentication) — `cloudflareAccess` + `cloudflareAccessPlugin`: path
  policies, the local-dev token bypass, and why it's fail-closed by default.
- [Logging](/guides/logging) — `cloudflareLogger` + the `/logging` core, and all five
  transports.
- [Error Handling](/guides/error-handling) — the HTTP error generators,
  `problemDetailsErrorHandler`, `notFoundHandler`, and how RFC 9457 problem details show up in a
  response.
- [Defensive Guards](/guides/defensive-guards) — why `throwIfNull`, `valueOrDefault`, and
  `sqlCount` exist.
- [The `generate-wrangler-types` CLI](/guides/cli) — keeping `worker-configuration.d.ts` fresh.
- [Testing a toolkit-based app](/guides/testing) — `/testing` helpers and
  `@cloudflare/vitest-pool-workers` recipes.
- [Vite + Vitest configuration for a Hono/Workers project](/guides/vite-vitest) — pairing
  `@cloudflare/vite-plugin` and `@cloudflare/vitest-pool-workers` against the same Worker.

The [`cloudflare-toolkit` Agent Skill](https://www.npmjs.com/package/skills)
(`npx skills add adrianhall/cloudflare-toolkit`) documents the same API surface in a form built
for coding agents, and is kept in sync with the source on every release.
