# Authentication

[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/) is a great way to put a single authentication layer in front of every app on your team. The problem: Access runs at Cloudflare's edge, not in your local dev server — so the access token your Worker relies on in production simply isn't there when you run `vite dev` or your Vitest suite.

The Cloudflare Toolkit closes that gap with two pieces that share the same policies and the same verification code, so your Worker's authentication code is written once and runs unchanged from local development to production:

- [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md) (`/hono`) — the
  production middleware that validates the Access JWT on every request.
- [`cloudflareAccessPlugin`](/reference/lib/vite/functions/cloudflareAccessPlugin.md) (`/vite`) —
  a dev-only Vite plugin that emulates the Access edge during `vite dev`.

## The problem: Cloudflare Access lives at the edge

In production, Cloudflare Access sits in front of your Worker. It authenticates the user, then injects a signed JWT into every request before that request ever reaches your code. Your Worker's only job is to ensure that the access token is valid.

Locally there is no Cloudflare Access in the loop. `vite dev` serves your app straight from [Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/), which doesn't emulate Cloudflare Access, so no access token is ever injected.

## The mechanism: two halves, one code path

The Cloudflare Toolkit provides two halves of the system. Within your worker, the [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md) middleware makes it easy to validate the token that the Cloudflare Access system provides. Outside the worker, the Cloudflare Toolkit provides the [`cloudflareAccessPlugin`](/reference/lib/vite/functions/cloudflareAccessPlugin.md) for vite, which emulates the functionality of Cloudflare Access, making it simple to emulate any user of the system without complicated authentication logic. Your code goes from development to production seamlessly.

Both halves of the process are built on the same internal JWT/JWKS/policy module and take the same [`PathPolicy`](/reference/lib/hono/interfaces/PathPolicy.md) array, so a session minted locally is accepted by the exact verification code that runs in production.

| Step                       | Production                | Local `vite dev`                    |
| -------------------------- | ------------------------- | ----------------------------------- |
| Authenticates the user     | Cloudflare Access (edge)  | `cloudflareAccessPlugin` login form |
| Signs the JWT              | Cloudflare Access         | `cloudflareAccessPlugin` (dev key)  |
| Injects the request header | Cloudflare Access (edge)  | `cloudflareAccessPlugin` (connect)  |
| Verifies the JWT           | `cloudflareAccess` (JWKS) | `cloudflareAccess` (dev key)        |
| **Your handler code**      | **unchanged**             | **unchanged**                       |

The rest of this guide shows you how to wire each half, then covers configuring both for production and development in [Security hardening](#security-hardening).

## Protecting your Worker

Add [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md) as middleware. It reads the JWT, verifies it, and on success sets two typed context variables typed for every downstream handler:

```ts
import { Hono } from "hono";
import { cloudflareAccess, type AuthVariables } from "@adrianhall/cloudflare-toolkit/hono";

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

app.use(
  cloudflareAccess({
    policies: [
      { pattern: /^\/api\/version$/, authenticate: false },
      { pattern: /^\/api\//, authenticate: true }
    ],
    enableDevTokens: import.meta.env.DEV
  })
);

app.get("/api/version", (c) => c.json({ version: "1.0.0" })); // public
app.get("/api/me", (c) => c.json({ email: c.get("userEmail"), sub: c.get("userSub") })); // protected
```

The `AuthVariables` (and the combined [`CloudflareToolkitVariables`](/reference/lib/hono/type-aliases/CloudflareToolkitVariables.md)) provides the following typed variables within the Hono context:

- `userEmail` — the JWT `email` claim.
- `userSub` — the JWT `sub` claim, a stable per-user identifier ideal for authorization.

Every `401` the middleware returns is itself an RFC 9457 `application/problem+json` response — the same shape [`problemDetailsErrorHandler`](/reference/lib/hono/functions/problemDetailsErrorHandler.md) and [`notFoundHandler`](/reference/lib/hono/functions/notFoundHandler.md) produce, so errors stay uniform across your app (see [Error Handling](/guides/error-handling)).

### Path policies

[`policies`](/reference/lib/hono/interfaces/CloudflareAccessOptions.md#policies) is an ordered [`PathPolicy`](/reference/lib/hono/interfaces/PathPolicy.md) array; the **first match wins**:

- `authenticate: false` — public; skip JWT validation entirely.
- `authenticate: true` — protected; a missing or invalid JWT returns `401`.

For a path that matches **no** policy, [`defaultAction`](/reference/lib/hono/interfaces/CloudflareAccessOptions.md#defaultaction) decides:

- `"block"` _(default)_ — treat it as protected.
- `"bypass"` — let it through unauthenticated. If a valid JWT happens to be present,
  `AuthVariables` are still set.

```ts
app.use(
  cloudflareAccess({
    policies: [{ pattern: /^\/admin\//, authenticate: true }],
    defaultAction: "bypass" // everything outside /admin/ is public by default
  })
);
```

See [`CloudflareAccessOptions`](/reference/lib/hono/interfaces/CloudflareAccessOptions.md) for the full option surface.

## Developing locally

Register [`cloudflareAccessPlugin`](/reference/lib/vite/functions/cloudflareAccessPlugin.md) in `vite.config.ts`, and pass it the **same** policy array you gave the Worker:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareAccessPlugin } from "@adrianhall/cloudflare-toolkit/vite";
import { authPolicies } from "./src/auth-policies";

export default defineConfig({
  plugins: [
    // MUST come before cloudflare() so its connect middleware runs first and can inject the
    // Access headers before the request is dispatched into the Worker.
    cloudflareAccessPlugin({ policies: authPolicies }),
    cloudflare()
  ]
});
```

Define `authPolicies` in its own module and import it into both configs — that single shared array is what keeps dev and production agreeing on which routes are protected (see the [Vite + Vitest guide](/guides/vite-vitest)).

During `vite dev`, visiting a protected route redirects the browser to a login form the plugin serves at [`loginPath`](/reference/lib/vite/interfaces/CloudflareAccessPluginOptions.md#loginpath) (default `/cdn-cgi/access/login`). Submitting it mints a dev-signed JWT and hands you back to your app, now authenticated. The plugin also serves `/cdn-cgi/access/logout` and `/cdn-cgi/access/get-identity`, mirroring the real Access edge endpoints.

By default the login form is a free-text email box. Supply [`users`](/reference/lib/vite/interfaces/CloudflareAccessPluginOptions.md#users) to pick from named accounts instead:

```ts
cloudflareAccessPlugin({
  policies: authPolicies,
  users: [
    { email: "alice@example.com", name: "Alice (admin)" },
    { email: "bob@example.com", name: "Bob (read-only)" }
  ]
});
```

The remaining [`CloudflareAccessPluginOptions`](/reference/lib/vite/interfaces/CloudflareAccessPluginOptions.md):

| Option                                                                                           | Default                 | Purpose                                                 |
| ------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------- |
| [`devSecret`](/reference/lib/vite/interfaces/CloudflareAccessPluginOptions.md#devsecret)         | public dev key          | Must match the Worker's `devSecret` if you overrode it. |
| [`users`](/reference/lib/vite/interfaces/CloudflareAccessPluginOptions.md#users)                 | _(free-text email)_     | Selectable `DevLoginUser` identities on the login form. |
| [`loginPath`](/reference/lib/vite/interfaces/CloudflareAccessPluginOptions.md#loginpath)         | `/cdn-cgi/access/login` | Pathname for the login form.                            |
| [`tokenLifetime`](/reference/lib/vite/interfaces/CloudflareAccessPluginOptions.md#tokenlifetime) | `86400` (24 h)          | Dev JWT lifetime, in seconds.                           |

## Security hardening

Both halves default to safe behavior, but a production deployment and a local dev session want opposite settings for a couple of options. Configure them explicitly.

### In production

- **Set [`audience`](/reference/lib/hono/interfaces/CloudflareAccessOptions.md#audience)** to your Access application's Audience (AUD) Tag — found on the Access Application's **Overview** tab. Every Access app on your team shares one JWKS, so without the `aud` check a token minted for _any_ app on the team is accepted here too.
- **Keep [`enableDevTokens`](/reference/lib/hono/interfaces/CloudflareAccessOptions.md#enabledevtokens) statically `false`.** Gate it on a build-time signal (`import.meta.env.DEV`), never a runtime env var — a deployed Worker with dev tokens on would trust a forgeable HS256 token signed with the public `DEFAULT_DEV_SECRET`. `false` is the default precisely so this fails closed.
- **Provide the team domain** via the `CLOUDFLARE_TEAM_DOMAIN` binding (the [Getting Started](/getting-started) `wrangler.jsonc` pattern) — `cloudflareAccess` reads it at request time to fetch the JWKS — or pass [`teamDomain`](/reference/lib/hono/interfaces/CloudflareAccessOptions.md#teamdomain) explicitly.

```ts
app.use(
  cloudflareAccess({
    policies: authPolicies,
    audience: "4714c1358e65fe4b21c711123456effd",
    enableDevTokens: import.meta.env.DEV // statically false once bundled for production
  })
);
```

### In local development

- **Set `enableDevTokens: import.meta.env.DEV`** so the Worker accepts the dev-signed tokens the Vite plugin (and `/testing`) produce. Leaving [`devSecret`](/reference/lib/hono/interfaces/CloudflareAccessOptions.md#devsecret) unset uses the public dev key and logs a one-time warning — fine on localhost.
- **Match `devSecret` on both sides** _only_ if you override the default: the value passed to [`cloudflareAccess`](/reference/lib/hono/functions/cloudflareAccess.md) and to [`cloudflareAccessPlugin`](/reference/lib/vite/functions/cloudflareAccessPlugin.md) must be identical, or locally-minted tokens won't verify.

### Diagnostics

Pass a [`logger`](/reference/lib/hono/interfaces/CloudflareAccessOptions.md#logger) (a [`Logger`](/reference/lib/logging/index.md#logger)) to surface the warnings above plus per-request debug output. It defaults to silent, so diagnostics are opt-in (see [Logging](/guides/logging)):

```ts
import { createLogger, createConsoleTransport } from "@adrianhall/cloudflare-toolkit/logging";

app.use(
  cloudflareAccess({
    policies: authPolicies,
    logger: createLogger({ level: "warn", transport: createConsoleTransport() })
  })
);
```

## Beyond the browser: testing

[`cloudflareAccessPlugin`](/reference/lib/vite/functions/cloudflareAccessPlugin.md) emulates the **browser** login flow for a human clicking around in `vite dev`. For **Vitest**, `/testing`'s [`signDevJwt`](/reference/lib/testing/functions/signDevJwt.md) signs a token directly — no Vite server involved — so you can call your Worker's `fetch` handler with a ready-made [`JWT_HEADER`](/reference/lib/testing/variables/JWT_HEADER.md):

```ts
import { signDevJwt, JWT_HEADER } from "@adrianhall/cloudflare-toolkit/testing";

const token = await signDevJwt("alice@example.com");
const res = await app.fetch(
  new Request("http://localhost/api/me", { headers: { [JWT_HEADER]: token } }),
  env
);
```

Both paths require `enableDevTokens` on the Worker for the tokens they produce to be accepted. See [Testing](/guides/testing) for
more details.

## See also

- [Error Handling](/guides/error-handling) — the RFC 9457 shape of every `401` this middleware
  returns.
- [Logging](/guides/logging) — the [`Logger`](/reference/lib/logging/index.md#logger) you hand to
  `cloudflareAccess` for its diagnostics.
- [Testing](/guides/testing) — `signDevJwt`, `buildCookieHeader`, and `clearCookieHeader` for
  asserting against Access-protected routes in Vitest.
- [Vite + Vitest configuration](/guides/vite-vitest) — the full `wrangler.jsonc` +
  `vite.config.ts` + `vitest.config.ts` pairing that keeps `npm run dev` and `npm run test`
  agreeing on the same Worker.
