# Guides

One guide per functional area, each expanding on the corresponding
[Getting Started](/getting-started) snippet with fuller worked examples:

<div class="guide-panels">

<div class="guide-panel">

### [Authentication](./authentication)

`cloudflareAccess` + `cloudflareAccessPlugin`: path policies, the local-dev token bypass, and why
it's fail-closed by default.

</div>

<div class="guide-panel">

### [Logging](./logging)

`cloudflareLogger` + the `/logging` core, and all five transports.

</div>

<div class="guide-panel">

### [Error Handling](./error-handling)

The HTTP error generators, `problemDetailsErrorHandler`, `notFoundHandler`, and how RFC 9457
problem details show up in a response.

</div>

<div class="guide-panel">

### [Command Line Tools](./cli)

Keeping `worker-configuration.d.ts` fresh with the `generate-wrangler-types` CLI.

</div>

<div class="guide-panel">

### [Testing](./testing)

`/testing` helpers and `@cloudflare/vitest-pool-workers` recipes.

</div>

<div class="guide-panel">

### [Defensive Guards](./defensive-guards)

Why `throwIfNull`, `valueOrDefault`, and `sqlCount` exist.

</div>

</div>

The [`cloudflare-toolkit` Agent Skill](https://www.npmjs.com/package/skills)
(`npx skills add adrianhall/cloudflare-toolkit`) documents the same API surface in a form built
for coding agents, and is kept in sync with the source on every release.
