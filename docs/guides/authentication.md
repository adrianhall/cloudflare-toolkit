# Authentication

`@adrianhall/cloudflare-toolkit` protects a Hono Worker with **Cloudflare Access** JWT
validation, and gives you a safe way to develop against those same protected routes locally,
without a real Cloudflare Access deployment sitting in front of your machine.

Two pieces work together:

- [`cloudflareAccess`](#cloudflareaccess-in-production) (`/hono`) — production JWT validation,
  wired into your Worker.
- [`cloudflareAccessPlugin`](#local-development-with-cloudflareaccessplugin) (`/vite`) — a
  dev-only Vite plugin that emulates the Cloudflare Access edge during `vite dev`, so the Worker
  never needs a separate dev-only authentication path.

Both are built on the same internal JWT/JWKS/policy module, so a session created by the Vite
plugin locally is accepted by the exact same verification code that runs in production — see the
[Vite + Vitest guide](/guides/vite-vitest) for the full wiring between the two.

## `cloudflareAccess` in production

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

On a successful verification, `cloudflareAccess` sets two context variables — typed by
`AuthVariables` — for every downstream handler to read: `userEmail` (the JWT `email` claim) and
`userSub` (the JWT `sub` claim). Every `401` it returns is itself an RFC 9457
`application/problem+json` response, the same shape `problemDetailsErrorHandler` and
`notFoundHandler` produce — see the [Error Handling guide](/guides/error-handling).

### Path policies and the default action

`policies` is an ordered array of `{ pattern: RegExp, authenticate: boolean }` — **first match
wins**:

- `authenticate: false` — bypass JWT validation entirely for matching paths.
- `authenticate: true` — require a valid JWT; a missing/invalid one returns `401`.

For any path that matches **no** policy, `defaultAction` decides what happens:

- `"block"` _(default)_ — return `401` if no valid JWT is present.
- `"bypass"` — let the request through. If a valid JWT happens to be present, `AuthVariables` are
  still set; otherwise the request continues unauthenticated.

```ts
app.use(
  cloudflareAccess({
    policies: [{ pattern: /^\/admin\//, authenticate: true }],
    defaultAction: "bypass" // everything outside /admin/ is public by default
  })
);
```

### Team domain and audience

`teamDomain` is your Cloudflare Access team's domain, used to fetch its public JWKS. When
omitted, `cloudflareAccess` reads `c.env.CLOUDFLARE_TEAM_DOMAIN` at request time — the pattern
shown in the [Getting Started](/getting-started) `wrangler.jsonc` example, so most apps never
need to pass it explicitly.

`audience` is your Access Application's Audience (AUD) Tag. **Set it outside local
development.** Every Cloudflare Access application on the same team shares the same JWKS, so
without an `aud` check, a JWT that's valid for _any other_ Access application in your team is
accepted here too — a cross-application token replay risk. Unless `enableDevTokens` is `true`,
omitting `audience` logs a one-time warning at construction time for exactly this reason:

```ts
app.use(
  cloudflareAccess({
    policies: [{ pattern: /^\/api\//, authenticate: true }],
    audience: "4714c1358e65fe4b21c711123456effd" // find this on the Access Application's Overview tab
  })
);
```

### The local-dev token bypass — and why it's fail-closed by default

`enableDevTokens` controls whether `cloudflareAccess` will additionally accept a
developer-signed HS256 token (as opposed to only real Cloudflare Access JWKS-verified tokens).
**It defaults to `false`.** This is a deliberate fail-closed default: a deployed Worker that
somehow ends up with `enableDevTokens` statically `true` would silently trust a forgeable HS256
token — including one signed with the well-known public `DEFAULT_DEV_SECRET` from `/testing`.

Always gate it on a build-time signal that resolves to `false` in a production build, never a
runtime environment variable that could be misconfigured at deploy time:

```ts
app.use(
  cloudflareAccess({
    policies,
    enableDevTokens: import.meta.env.DEV // statically false once bundled for production
  })
);
```

When dev tokens are enabled without an explicit `devSecret`, `cloudflareAccess` logs a one-time
warning that it's verifying against the public `DEFAULT_DEV_SECRET` — safe only on localhost.

### Logging

Pass `logger` (a `/logging` `Logger` — see the [Logging guide](/guides/logging)) to get
debug/info/warn/error diagnostics from `cloudflareAccess` itself, such as the audience and
dev-secret warnings above. It defaults to a silent logger, so these diagnostics are opt-in:

```ts
import { createLogger, createConsoleTransport } from "@adrianhall/cloudflare-toolkit/logging";

app.use(
  cloudflareAccess({
    policies,
    logger: createLogger({ level: "warn", transport: createConsoleTransport() })
  })
);
```

## Local development with `cloudflareAccessPlugin`

In production, Cloudflare Access sits at the edge and injects the `Cf-Access-Jwt-Assertion`
header before your request ever reaches the Worker. During `vite dev` there's no Access in that
loop, so `cloudflareAccessPlugin` reproduces the same behavior at Vite's connect-middleware layer
— the Worker keeps **only** the production `cloudflareAccess` middleware above, with no
separate, dev-only authentication path to maintain or accidentally ship.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareAccessPlugin } from "@adrianhall/cloudflare-toolkit/vite";
import { authPolicies } from "./src/auth-policies";

export default defineConfig({
  plugins: [
    // MUST come before cloudflare() so its connect middleware runs first and can inject the
    // Access headers before the request is dispatched into the Worker runtime.
    cloudflareAccessPlugin({ policies: authPolicies }),
    cloudflare()
  ]
});
```

Pass the **same** `policies` array you gave `cloudflareAccess` in the Worker (`authPolicies`
above is shared between both configs) so dev and production agree on which paths are protected.

Visiting a policy-protected route in the browser during `vite dev` redirects to a login form
served by the plugin itself, at `loginPath` (default `/cdn-cgi/access/login`). Submitting it
mints a dev-signed JWT — accepted by the Worker's own `cloudflareAccess` because both sides share
the same `DEFAULT_DEV_SECRET`/verification code internally, with no separate verification logic
to keep in sync. The plugin also serves `/cdn-cgi/access/logout` and
`/cdn-cgi/access/get-identity`, mirroring the real Cloudflare Access edge endpoints.

Other `CloudflareAccessPluginOptions`:

| Option          | Default                    | Purpose                                                                                                   |
| --------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `devSecret`     | `DEFAULT_DEV_SECRET`       | Must match the Worker's `devSecret`, if you overrode it there.                                            |
| `users`         | _(none — free-text email)_ | Selectable identities (`{ email, name?, sub? }`) rendered on the login form instead of a free-text input. |
| `loginPath`     | `/cdn-cgi/access/login`    | Pathname for the login form.                                                                              |
| `tokenLifetime` | `86400` (24 h)             | Dev JWT lifetime, in seconds.                                                                             |

```ts
cloudflareAccessPlugin({
  policies: authPolicies,
  users: [
    { email: "alice@example.com", name: "Alice (admin)" },
    { email: "bob@example.com", name: "Bob (read-only)" }
  ]
});
```

Both `enableDevTokens: true` on the Worker side and `cloudflareAccessPlugin` on the Vite side are
independent ways to get past `cloudflareAccess` locally — the plugin emulates the **browser**
login flow for `vite dev`; `/testing`'s `signDevJwt` (covered in the
[Testing guide](/guides/testing)) signs a token directly for **Vitest** assertions against the
Worker's `fetch` handler, with no Vite server involved at all.

## See also

- [Error Handling](/guides/error-handling) — the RFC 9457 shape of every `401`/`404` this
  middleware and its siblings produce.
- [Testing](/guides/testing) — `signDevJwt`, `buildCookieHeader`, and `clearCookieHeader` for
  asserting against Access-protected routes in Vitest.
- [Vite + Vitest configuration](/guides/vite-vitest) — the full `wrangler.jsonc` +
  `vite.config.ts` + `vitest.config.ts` pairing that keeps `npm run dev` and `npm run test`
  agreeing on the same Worker.
