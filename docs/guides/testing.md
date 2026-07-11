# Testing a toolkit-based app

`/testing` provides the pieces needed to write Vitest (or Playwright) assertions against
`cloudflareAccess`-protected routes — signing developer JWTs and building the cookie/header
values the middleware's dev-token bypass expects — without a real Cloudflare Access deployment
anywhere in the loop. This guide covers those helpers plus the
[`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/)
patterns for exercising your Worker in real `workerd`.

For the `vitest.config.ts`/`vite.config.ts` pairing itself — the part that makes `npm run dev`
and `npm run test` agree on the same Worker — see the
[Vite + Vitest configuration guide](/guides/vite-vitest); this guide assumes that config already
exists and focuses on what you write inside the test files themselves.

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

Once `vitest.config.ts` wires up `cloudflareTest()` (see the
[Vite + Vitest configuration guide](/guides/vite-vitest)), your test files run inside real
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

- [Vite + Vitest configuration](/guides/vite-vitest) — the `vitest.config.ts` +
  `wrangler.jsonc` pairing these tests run against.
- [Authentication](/guides/authentication) — what `cloudflareAccess` actually validates, and why
  its dev-token bypass is fail-closed by default.
- [Logging](/guides/logging) — `createCaptureTransport()` in more depth.
