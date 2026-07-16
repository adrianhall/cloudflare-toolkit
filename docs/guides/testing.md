# Testing a toolkit-based app

`/testing` provides the pieces needed to write Vitest (or Playwright) assertions against
`cloudflareAccess`-protected routes — signing developer JWTs and building the cookie/header
values the middleware's dev-token bypass expects — without a real Cloudflare Access deployment
anywhere in the loop. This guide covers the `vite.config.ts`/`vitest.config.ts` pairing that makes
`npm run dev` and `npm run test` agree on the same Worker, those `/testing` helpers, and the
[`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/)
patterns for exercising your Worker in real `workerd`.

## Vite + Vitest configuration for a Hono/Workers project

Getting `@cloudflare/vite-plugin` and `@cloudflare/vitest-pool-workers` to agree with each other —
so that `npm run dev` and `npm run test` exercise the **same** Worker, with the same bindings and
compatibility settings — is a common source of misconfiguration in Hono/Wrangler apps. Consult
Cloudflare's own documentation first — they cover the underlying `@cloudflare/vite-plugin` and
`@cloudflare/vitest-pool-workers` APIs this toolkit builds on top of:

- [Cloudflare Plugin for Vite](https://developers.cloudflare.com/workers/vite-plugin/)
- [Cloudflare Vitest Information](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Reference Samples](https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/)

The example below wires a single Worker (`wrangler.jsonc`) that is both (a) served locally via
`@cloudflare/vite-plugin` + `cloudflareAccessPlugin` (see the [Authentication
guide](/guides/authentication)'s "Developing locally" section for that half in depth), and (b)
exercised in Vitest via `@cloudflare/vitest-pool-workers` against that **same** config — so
`npm run dev` and `npm run test` never silently drift apart on bindings, compatibility date, or
flags:

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
    // Order matters — see the Authentication guide's "Developing locally" section. This must
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

`cloudflareAccessPlugin` and `/testing`'s `signDevJwt` are two independent ways to get past
`cloudflareAccess` locally, for two different situations:

- **`cloudflareAccessPlugin`** emulates the **browser** login flow (cookies, redirects, a login
  form) for `vite dev` — a human clicking around in a browser.
- **`/testing`'s `signDevJwt`** signs a token directly for **Vitest** assertions against the
  Worker's `fetch` handler — no Vite server involved at all, as in the test file above.

Both require `cloudflareAccess({ enableDevTokens: true, ... })` (or a build-time
`import.meta.env.DEV` gate) for the token they produce to be accepted — see the [Authentication
guide](/guides/authentication) for why that flag is fail-closed by default.

This worked example is deliberately mirrored — not linked-to-instead-of — in the [`cloudflare-toolkit`
Agent Skill](https://github.com/adrianhall/cloudflare-toolkit/blob/main/skills/cloudflare-toolkit/SKILL.md#vite--vitest-configuration-for-a-honoworkers-project)'s
own "Vite + Vitest configuration" section: one copy for a human reading the docs site, one for a
coding agent working in your editor. If you change the pattern above, update both — see
`AGENTS.md`'s architectural rules for why these two are deliberately duplicated rather than one
linking to the other.

## `/testing` helpers

| Export                               | Purpose                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `signDevJwt(email, options?)`        | Sign a developer JWT accepted by `cloudflareAccess({ enableDevTokens: true })`.                 |
| `JWT_HEADER`                         | The exact header name (`cf-access-jwt-assertion`) `cloudflareAccess` reads a bearer token from. |
| `buildCookieHeader(token, isSecure)` | Build a `Cookie` header value carrying the token as a browser session would.                    |
| `clearCookieHeader()`                | Build a `Cookie` header value that clears the session (simulates logout).                       |
| `COOKIE_NAME`                        | The exact cookie name (`CF_Authorization`) `cloudflareAccess` reads.                            |

`enableDevTokens: true` must be opted into on `cloudflareAccess` for any of these to be accepted
— see the [Authentication guide](/guides/authentication)'s fail-closed default. **Never** enable
it outside test/dev code.

### Header-based auth (the direct path)

```ts
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

`signDevJwt`'s second argument accepts overrides: `secret` (must match the Worker's `devSecret`,
if it overrode the default), `lifetime` (seconds, default `86400`), and `sub` (pin a stable
subject claim instead of a random one per call):

```ts
const token = await signDevJwt("alice@example.com", { sub: "user-123", lifetime: 3600 });
```

### Cookie-based auth (mirrors an actual browser session)

```ts
import {
  signDevJwt,
  buildCookieHeader,
  clearCookieHeader
} from "@adrianhall/cloudflare-toolkit/testing";

const token = await signDevJwt("alice@example.com");
const res = await worker.fetch(
  new Request("http://localhost/api/me", { headers: { cookie: buildCookieHeader(token, false) } }),
  env
);

// Simulate logout and confirm the route is protected again:
const loggedOut = await worker.fetch(
  new Request("http://localhost/api/me", { headers: { cookie: clearCookieHeader() } }),
  env
);
expect(loggedOut.status).toBe(401);
```

`buildCookieHeader`'s second argument (`isSecure`) controls whether the `Secure` attribute is
added — pass `false` for `http://localhost` tests, matching how a real browser would omit it over
plain HTTP.

`JWT_HEADER` and `COOKIE_NAME` exist so tests never hardcode the header/cookie name as a magic
string that could silently drift out of sync with what `cloudflareAccess` actually reads.

## Asserting on log output

Combine `/testing` with `/logging`'s capture transport (see the
[Logging guide](/guides/logging)) to assert on what your handlers logged during a request,
instead of only on the HTTP response:

```ts
import { createCaptureTransport } from "@adrianhall/cloudflare-toolkit/logging";
import { cloudflareLogger } from "@adrianhall/cloudflare-toolkit/hono";

const capture = createCaptureTransport();
app.use(cloudflareLogger({ level: "trace", transport: capture }));

// ...make a request through `app.fetch(...)` or `worker.fetch(...)`...

expect(capture.find("warn")).toHaveLength(0); // nothing unexpected was logged
```

## `@cloudflare/vitest-pool-workers` recipes

Once `vitest.config.ts` wires up `cloudflareTest()` (see [Vite + Vitest configuration
above](#vite-vitest-configuration-for-a-hono-workers-project)), your test files run inside real
`workerd`, with access to two additional runtime-provided modules:

- **`cloudflare:test`** — `createExecutionContext()` / `waitOnExecutionContext(ctx)`, for
  exercising the full `(request, env, ctx)` fetch-handler signature and waiting for any
  `ctx.waitUntil(...)` promises to settle before asserting on side effects:

  ```ts
  import { env } from "cloudflare:workers";
  import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
  import { it, expect } from "vitest";
  import worker from "../src/index";

  it("waits for background work before asserting", async () => {
    const request = new Request("http://localhost/api/me");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
  });
  ```

- **`cloudflare:workers`** — `env` (typed via an ambient `ProvidedEnv` module augmentation,
  matching your `wrangler.jsonc` bindings) for reading/writing real bindings (KV, D1, etc.)
  directly in a test, without going through a request at all:

  ```ts
  import { env } from "cloudflare:workers";
  import { it, expect } from "vitest";

  it("uses a binding directly", async () => {
    await env.MY_KV.put("key", "value");
    expect(await env.MY_KV.get("key")).toBe("value");
  });
  ```

For anything beyond this — D1 migrations, Pages `ASSETS` bindings, multi-Worker setups — see
Cloudflare's own [Reference Samples](https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/)
and [Test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)
pages; this toolkit doesn't wrap or replace any of that runtime surface.

## See also

- [Authentication](/guides/authentication) — what `cloudflareAccess` actually validates, why its
  dev-token bypass is fail-closed by default, and the `cloudflareAccessPlugin`/`vite.config.ts`
  half of the pairing above.
- [Logging](/guides/logging) — `createCaptureTransport()` in more depth.
