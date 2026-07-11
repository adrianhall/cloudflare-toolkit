# Guides

Coming soon.

This section will hold one guide per functional area, each expanding on the corresponding
[Getting Started](/getting-started) snippet with fuller worked examples:

- Authentication (`cloudflareAccess` + `cloudflareAccessPlugin`)
- Logging (`cloudflareLogger` + the `/logging` core)
- Error Handling (the HTTP error generators, `problemDetailsErrorHandler`, `notFoundHandler`)
- Defensive Guards (`throwIfNull`, `valueOrDefault`, `sqlCount`)
- The `generate-wrangler-types` CLI
- Testing a toolkit-based app (`/testing` helpers, `@cloudflare/vitest-pool-workers` recipes)
- Vite + Vitest configuration for a Hono/Workers project

In the meantime, the [`cloudflare-toolkit` Agent Skill](https://www.npmjs.com/package/skills)
(`npx skills add adrianhall/cloudflare-toolkit`) already documents every export in depth and is
kept in sync with the source on every release.
