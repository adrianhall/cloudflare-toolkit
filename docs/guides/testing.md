# Testing a toolkit-based app

Say your Worker has an API route protected by [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md) (see [Authentication](/guides/authentication)). You want a Vitest test that hits that route and checks the response. There's just one problem: [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md) is waiting for a signed JWT that only the real Cloudflare Access edge normally produces, and your test runner is nowhere near that edge.

This guide covers signing a developer JWT and attaching it to a request the way `cloudflareAccess`'s dev-token bypass expects, the `vite.config.ts`/`vitest.config.ts` pairing that keeps `npm run dev` and `npm run test` running the exact same Worker, and the [`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/) APIs for exercising that Worker in real `workerd`.

## The problem: your test runner isn't the Access edge

In production, Cloudflare Access authenticates the user and hands your Worker a signed JWT before the request ever reaches your code. [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md) just verifies it. Locally, `vite dev` solves this with [`cloudflareAccessPlugin`](/guides/authentication#developing-locally) — a plugin that emulates the login flow in the browser. But a Vitest test doesn't run in a browser at all; it calls your Worker's `fetch` handler directly. There's no page to click a login form on, and no connect middleware in the loop to inject a header.

That leaves two bad options: turn off authentication for tests (which you may rely on for RBAC), or point tests at a live Access team domain (slow, flaky, and it needs real credentials your CI probably doesn't have).

## The mechanism: sign the token yourself

The Cloudflare Toolkit contains utilities your vitest test suite can use: [`signDevJwt`](/reference/lib/testing/functions/signDevJwt.md) signs a JWT using the
same dev-key path [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md)'s [`enableDevTokens`](/reference/lib/hono/interfaces/CloudflareAccessOptions.md#enabledevtokens) option accepts — no browser, no Vite dev server, no network call to a team domain. You attach the result to a `Request` as a header or cookie and call `worker.fetch()` directly. The same verification code that runs in production checks the token; it just happens to be a token you minted a moment ago in the test file itself.

This is the same trick [`cloudflareAccessPlugin`](/reference/lib/vite/functions/cloudflareAccessPlugin.md) uses for `vite dev`, aimed at a different
audience:

|                        | [`cloudflareAccessPlugin`](/reference/lib/vite/functions/cloudflareAccessPlugin.md) (`/vite`) | [`signDevJwt`](/reference/lib/testing/functions/signDevJwt.md) (`/testing`) |
| ---------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Who's on the other end | A human clicking around in a browser                                                          | A Vitest assertion calling `fetch` directly                                 |
| What it produces       | A login form, then cookies + redirects                                                        | A ready-to-attach JWT string                                                |
| Where it runs          | Inside `vite dev`'s connect middleware                                                        | Inside your test file, no server involved                                   |

Both require `enableDevTokens: true` on the Worker (or a build-time `import.meta.env.DEV` gate — see [Authentication](/guides/authentication)'s fail-closed default) for the tokens they produce to be accepted. **Never** enable it outside test/dev code.

## Vite + Vitest configuration for a Hono/Workers project

Getting `@cloudflare/vite-plugin` and `@cloudflare/vitest-pool-workers` to agree with each other — so that `npm run dev` and `npm run test` exercise the **same** Worker, with the same bindings and compatibility settings — is a common source of misconfiguration in Hono/Wrangler apps. Consult [Cloudflare's own documentation](https://developers.cloudflare.com/workers/testing/vitest-integration/) first — they cover the underlying `@cloudflare/vite-plugin` and `@cloudflare/vitest-pool-workers` APIs this toolkit builds on top of:

- [Cloudflare Plugin for Vite](https://developers.cloudflare.com/workers/vite-plugin/)
- [Cloudflare Vitest Information](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Reference Samples](https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/)

Here's a single Worker (`wrangler.jsonc`) wired two ways: served locally via `@cloudflare/vite-plugin` + [`cloudflareAccessPlugin`](/reference/lib/vite/functions/cloudflareAccessPlugin.md) (see [Authentication](/guides/authentication)'s "Developing locally" section for that half in depth), and exercised in Vitest via `@cloudflare/vitest-pool-workers` against that **same** config. Point both at one `wrangler.jsonc` and `npm run dev`/`npm run test` can never silently drift apart on bindings, compatibility date, or flags:

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
  plugins: [cloudflareAccessPlugin({ policies: authPolicies }), cloudflare()]
});
```

```ts
// vitest.config.ts — tests running the same Worker in real workerd
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" }
    })
  ],
  test: {
    include: ["test/**/*.test.ts"]
  }
});
```

Notice `authPolicies` is imported into both `vite.config.ts` above and the Worker itself (see [Getting Started](/getting-started)) from one shared module. Define it once, import it twice — that's what keeps dev and production from quietly disagreeing about which routes require authentication.

## Testing Access-protected routes with `/testing`

| Export                                                                                        | Purpose                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`signDevJwt(email, options?)`](/reference/lib/testing/functions/signDevJwt.md)               | Sign a developer JWT accepted by [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md)({ enableDevTokens: true }).                 |
| [`JWT_HEADER`](/reference/lib/testing/variables/JWT_HEADER.md)                                | The exact header name (`cf-access-jwt-assertion`) [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md) reads a bearer token from. |
| [`buildCookieHeader(token, isSecure)`](/reference/lib/testing/functions/buildCookieHeader.md) | Build a `Cookie` header value carrying the token as a browser session would.                                                                         |
| [`clearCookieHeader()`](/reference/lib/testing/functions/clearCookieHeader.md)                | Build a `Cookie` header value that clears the session (simulates logout).                                                                            |
| [`COOKIE_NAME`](/reference/lib/testing/variables/COOKIE_NAME.md)                              | The exact cookie name (`CF_Authorization`) [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md) reads.                            |

[`JWT_HEADER`](/reference/lib/testing/variables/JWT_HEADER.md) and [`COOKIE_NAME`](/reference/lib/testing/variables/COOKIE_NAME.md) exist so a test never hardcodes the header or cookie name as a magic string that could quietly drift out of sync with what [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md) actually reads. Import them instead of typing `"cf-access-jwt-assertion"` or `"CF_Authorization"` yourself.

Pick header-based or cookie-based auth depending on what you're testing.

### Header-based auth (the direct path)

Reach for this first. It's the shortest path from "I need an authenticated request" to an assertion:

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

[`signDevJwt`](/reference/lib/testing/functions/signDevJwt.md)'s second argument accepts overrides when the default won't do: `secret` (must match the Worker's `devSecret`, if it overrode the default), `lifetime` (seconds, default `86400`), and `sub` (pin a stable subject claim instead of a random one per call — handy if a test asserts on `Cloudflare_Access_Identity.sub` specifically):

```ts
const token = await signDevJwt("alice@example.com", { sub: "user-123", lifetime: 3600 });
```

### Cookie-based auth (mirrors an actual browser session)

Reach for this when the thing you're testing actually depends on cookie behavior — a logout flow, for instance, where you need to prove the session was cleared and the route is protected again:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  signDevJwt,
  buildCookieHeader,
  clearCookieHeader
} from "@adrianhall/cloudflare-toolkit/testing";
import worker from "../src/index";

describe("cookie-based auth", () => {
  it("allows logout", async () => {
    const token = await signDevJwt("alice@example.com");
    const res = await worker.fetch(
      new Request("http://localhost/api/me", {
        headers: { cookie: buildCookieHeader(token, false) }
      }),
      env
    );

    // Simulate logout and confirm the route is protected again:
    const loggedOut = await worker.fetch(
      new Request("http://localhost/api/me", { headers: { cookie: clearCookieHeader() } }),
      env
    );
    expect(loggedOut.status).toBe(401);
  });
});
```

[`buildCookieHeader`](/reference/lib/testing/functions/buildCookieHeader.md)'s second argument (`isSecure`) controls whether the `Secure` attribute is added. Pass `false` for `http://localhost` tests — that matches how a real browser omits `Secure` over plain HTTP too.

## Asserting on log output

Sometimes the response body alone doesn't tell you what you need to know — you also want to know what the handler _logged_ while producing it. Cloudflare Toolkit contains a logging framework that can capture logs when testing using [`createCaptureTransport`](/reference/index/functions/createCaptureTransport.md).

```ts
import { createCaptureTransport } from "@adrianhall/cloudflare-toolkit/logging";
import { cloudflareLogger } from "@adrianhall/cloudflare-toolkit/hono";

const capture = createCaptureTransport();
app.use(cloudflareLogger({ level: "trace", transport: capture }));

// ...make a request through `app.fetch(...)` or `worker.fetch(...)`...

expect(capture.find("warn")).toHaveLength(0); // nothing unexpected was logged
```

## Running your Worker in real `workerd`

Everything so far calls `worker.fetch(request, env)` directly. Once `vitest.config.ts` wires up `cloudflareTest()`, your test files run inside real `workerd` itself, with two additional runtime-provided modules available for the cases where a plain `fetch()` call isn't enough:

- **`cloudflare:test`** provides `createExecutionContext()` and`waitOnExecutionContext(ctx)`. Reach for these when your handler kicks off background work with `ctx.waitUntil(...)` — without waiting on the context, your test can pass before that work has actually finished, hiding a bug in it:

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

- **`cloudflare:workers`** provides `env`, typed via an ambient `ProvidedEnv` module augmentation that matches your `wrangler.jsonc` bindings. Use this when you want to read or write a binding (KV or D1, for example) without going through a request at all:

  ```ts
  import { env } from "cloudflare:workers";
  import { it, expect } from "vitest";

  it("uses a binding directly", async () => {
    await env.MY_KV.put("key", "value");
    expect(await env.MY_KV.get("key")).toBe("value");
  });
  ```

For anything beyond this — D1 migrations, Pages `ASSETS` bindings, multi-Worker setups — go straight to Cloudflare's own [Reference Samples](https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/) and [Test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/) pages. This toolkit doesn't wrap or replace any of that runtime surface — it only solves the Access-token problem `@cloudflare/vitest-pool-workers` doesn't try to.

## See also

- [Authentication](/guides/authentication) — what [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md) actually validates, why its dev-token bypass is fail-closed by default, and the [`cloudflareAccessPlugin`](/reference/lib/vite/functions/cloudflareAccessPlugin.md)/`vite.config.ts` half of the pairing above.
- [Logging](/guides/logging) — [`createCaptureTransport()`](/reference/index/functions/createCaptureTransport.md) in more depth.
