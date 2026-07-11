# Vite + Vitest configuration for a Hono/Workers project

Getting `@cloudflare/vite-plugin` and `@cloudflare/vitest-pool-workers` to agree with each other
— so that `npm run dev` and `npm run test` exercise the **same** Worker, with the same bindings
and compatibility settings — is a common source of misconfiguration in Hono/Wrangler apps. This
page and the
[`cloudflare-toolkit` Agent Skill](https://github.com/adrianhall/cloudflare-toolkit/blob/main/skills/cloudflare-toolkit/SKILL.md#vite--vitest-configuration-for-a-honoworkers-project)'s
own "Vite + Vitest configuration" section intentionally carry the **same** worked example — one
written for a human reading the docs site, the other for a coding agent working in your editor —
so whichever one you're reading, you're seeing the current, correct pattern.

Consult Cloudflare's own documentation first — they cover the underlying `@cloudflare/vite-plugin`
and `@cloudflare/vitest-pool-workers` APIs this toolkit builds on top of:

- [Cloudflare Plugin for Vite](https://developers.cloudflare.com/workers/vite-plugin/)
- [Cloudflare Vitest Information](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Reference Samples](https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/)

## The pattern: one `wrangler.jsonc`, read by both dev and test

The example below wires a single Worker (`wrangler.jsonc`) that is both (a) served locally via
`@cloudflare/vite-plugin` + `cloudflareAccessPlugin` (see the
[Authentication guide](/guides/authentication)), and (b) exercised in Vitest via
`@cloudflare/vitest-pool-workers` against that **same** config — so `npm run dev` and
`npm run test` never silently drift apart on bindings, compatibility date, or flags.

```jsonc
// wrangler.jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "vars": {
    "CLOUDFLARE_TEAM_DOMAIN": "my-team.cloudflareaccess.com"
  }
}
```

```ts
// vite.config.ts — local dev server
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareAccessPlugin } from "@adrianhall/cloudflare-toolkit/vite";
import { authPolicies } from "./src/auth-policies";

export default defineConfig({
  plugins: [
    // Order matters — see the Authentication guide's "Local development" section. This must
    // come before cloudflare() so its connect middleware runs first.
    cloudflareAccessPlugin({ policies: authPolicies }),
    cloudflare() // reads ./wrangler.jsonc by default
  ]
});
```

```ts
// vitest.config.ts — tests running the same Worker in real workerd
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    // cloudflareTest() owns the runner pool and sets the Workers test environment itself —
    // never set `test.environment` alongside it.
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" } // same config the dev server reads
    })
  ],
  test: {
    include: ["test/**/*.test.ts"]
  }
});
```

```ts
// test/me.test.ts — cloudflareAccess exercised via /testing, no Vite plugin involved
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { signDevJwt, JWT_HEADER } from "@adrianhall/cloudflare-toolkit/testing";
import worker from "../src/index";

describe("GET /api/me", () => {
  it("returns the authenticated user", async () => {
    const token = await signDevJwt("alice@example.com");
    const request = new Request("http://localhost/api/me", {
      headers: { [JWT_HEADER]: token }
    });
    const response = await worker.fetch(request, env);
    expect(await response.json()).toMatchObject({ email: "alice@example.com" });
  });
});
```

`authPolicies` is a single shared array passed to both `cloudflareAccessPlugin` (above) and
`cloudflareAccess` in your Worker (see [Getting Started](/getting-started)) — defining it once
in its own module and importing it from both configs is what keeps dev and production from
silently drifting apart on which routes require authentication.

## Why two independent bypasses exist

`cloudflareAccessPlugin` and `/testing`'s `signDevJwt` are two independent ways to get past
`cloudflareAccess` locally, for two different situations:

- **`cloudflareAccessPlugin`** emulates the **browser** login flow (cookies, redirects, a login
  form) for `vite dev` — a human clicking around in a browser.
- **`/testing`'s `signDevJwt`** signs a token directly for **Vitest** assertions against the
  Worker's `fetch` handler — no Vite server involved at all, as in the test file above.

Both require `cloudflareAccess({ enableDevTokens: true, ... })` (or a build-time
`import.meta.env.DEV` gate) for the token they produce to be accepted — see the
[Authentication guide](/guides/authentication) for why that flag is fail-closed by default, and
the [Testing guide](/guides/testing) for more `/testing` helpers and `@cloudflare/vitest-pool-workers`
recipes beyond this config-focused example.

## Keeping this page and the Agent Skill in sync

If you're changing this worked example — a new Cloudflare Vite/Vitest API, a different
recommended flag, a bug in the sample code — update **both** copies:

- This page (`docs/guides/vite-vitest.md`)
- The [`cloudflare-toolkit` Agent Skill](https://github.com/adrianhall/cloudflare-toolkit/blob/main/skills/cloudflare-toolkit/SKILL.md)'s
  "Vite + Vitest configuration for a Hono/Workers project" section

See `AGENTS.md`'s architectural-rules section for why these two are deliberately duplicated
rather than one linking to the other for the actual code.

## See also

- [Authentication](/guides/authentication) — `cloudflareAccess` and `cloudflareAccessPlugin` in
  depth.
- [Testing](/guides/testing) — the `/testing` helpers and `cloudflare:test`/`cloudflare:workers`
  recipes used inside the test file above.
