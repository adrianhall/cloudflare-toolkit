---
name: cloudflare-toolkit
description: Authoritative usage patterns and anti-patterns for @adrianhall/cloudflare-toolkit — a toolkit of framework-agnostic guards, RFC 9457 problem-details errors, a structured logger, Hono middleware (Cloudflare Access auth, logging, error handling), a Vite plugin that emulates Cloudflare Access in local dev, Vitest testing helpers, and a generate-wrangler-types CLI. Use when writing or reviewing a Hono-based Cloudflare Worker, wiring Cloudflare Access auth for a Worker or its Vite dev server, adding structured logging, throwing/handling RFC 9457 problem-details errors, writing Vitest tests against Access-protected routes, or configuring Vite + Vitest for a Hono/Workers project.
---

# cloudflare-toolkit

`@adrianhall/cloudflare-toolkit` is an npm-installable, ESM-only toolkit of utilities for
building Cloudflare Workers, focused on Hono-based apps. Its core (`guards`, `errors`,
`problem-details`, `logging`) is framework-agnostic and dependency-light; `hono` and `vite`
support live behind their own subpaths so importing them is opt-in.

This skill documents **only this toolkit's own API surface** — see
["Consult sibling skills first"](#consult-sibling-skills-first) below for platform-level
Cloudflare concerns.

## When to use this package

- Throwing/handling HTTP errors as **RFC 9457 problem-details** responses from a Hono Worker —
  use `/errors` + `/hono`'s `problemDetailsErrorHandler`/`notFoundHandler`.
- Protecting Hono routes with **Cloudflare Access** JWT validation, including a safe local-dev
  bypass — use `/hono`'s `cloudflareAccess` paired with `/vite`'s `cloudflareAccessPlugin`.
- **Structured logging** across a Worker, Node script, or browser app, including
  Workers-Logs-friendly output — use `/logging` directly, or `/hono`'s `cloudflareLogger` for a
  request-scoped logger on the Hono context.
- Defensive, individually-tested guards for **D1 `.first()` results** and other
  "this should never happen" branches — use `/guards`.
- Writing **Vitest/Playwright tests** against `cloudflareAccess`-protected routes without a real
  Cloudflare Access deployment — use `/testing`.
- Keeping `worker-configuration.d.ts` fresh without a manual `wrangler types` step — use the
  `generate-wrangler-types` CLI.

## Installation

```sh
npm install @adrianhall/cloudflare-toolkit
```

`hono` is a **required** peer dependency for anything under `/hono`; `vite` is **optional**,
needed only for `/vite`:

```sh
npm install @adrianhall/cloudflare-toolkit hono
npm install @adrianhall/cloudflare-toolkit hono vite  # also using /vite for local dev
```

Install the skill itself into an agent-driven project with:

```sh
npx skills add adrianhall/cloudflare-toolkit
```

The package is npm-native: CI builds `dist/` fresh before every publish, so a plain
`npm install` is all a consumer needs — no build step, no `github:` ref, no committed `dist/`.

## Import rules

```ts
// Framework-agnostic core — safe in a Worker, Node, or browser. Re-exports guards + errors +
// problem-details + logging.
import { badRequest, createLogger, sqlCount, throwIfNull } from "@adrianhall/cloudflare-toolkit";

// Same four areas, importable directly by subpath if you prefer narrower imports.
import { sqlCount } from "@adrianhall/cloudflare-toolkit/guards";
import { notFound } from "@adrianhall/cloudflare-toolkit/errors";
import { problemDetails } from "@adrianhall/cloudflare-toolkit/problem-details";
import { createLogger } from "@adrianhall/cloudflare-toolkit/logging";

// Hono middleware — only import in Hono-based Worker code. Requires the `hono` peer dependency.
import { cloudflareAccess, cloudflareLogger } from "@adrianhall/cloudflare-toolkit/hono";

// Vite plugin — only import in vite.config.ts (Node-only). Requires the `vite` peer dependency.
// Never import this from Worker code.
import { cloudflareAccessPlugin } from "@adrianhall/cloudflare-toolkit/vite";

// Test helpers — only import from Vitest/Playwright test files.
import { signDevJwt } from "@adrianhall/cloudflare-toolkit/testing";
```

- The root entry point (`.`) never re-exports anything from `/hono`, `/vite`, or `/testing` —
  each of those pulls in its own runtime dependency (`hono`, `vite`, Node-only test tooling) and
  stays import-by-subpath-only.
- Never import `/vite` from Worker code that runs in `workerd` — it depends on `node:http` types
  and the `vite` peer dependency.
- Only import `/testing` from test files, not application code — it exists purely to construct
  dev-signed JWTs and cookie headers for assertions.

## Consult sibling skills first

This skill covers **only** `@adrianhall/cloudflare-toolkit`'s own exports. For platform-level
Cloudflare Workers concerns — bindings, KV/D1/R2, Durable Objects, `wrangler.jsonc`, deployment,
CI — consult the sibling skills you likely already have installed instead of expecting this one
to cover them:

- `cloudflare` — general Cloudflare Developer Platform guidance (Workers, storage, AI, Zero
  Trust, networking).
- `wrangler` — the Wrangler CLI itself (deploy, dev, bindings config, secrets).
- `workers-best-practices` — Workers-specific code review and anti-patterns (streaming, global
  state, floating promises, observability).
- `durable-objects` — Durable Object patterns, RPC, alarms, SQLite storage.

If one of those skills isn't installed in your current environment, `npx skills add
adrianhall/<name>` (for `cloudflare`, use the appropriate published skill source for your setup).

## Defensive Guards (`/guards`)

Testable defensive guards that replace inline, ad-hoc `if (!x) throw`/`??` branches with a
single, individually-tested helper — the underlying motivation is keeping 100% branch coverage
achievable without ignore annotations.

### `throwIfNull(value, message)`

Use when a value must not be `null`/`undefined` and you want TypeScript narrowing for free. A
genuine assertion function — after it returns, `value` is narrowed to `NonNullable<T>`.

```ts
import { throwIfNull } from "@adrianhall/cloudflare-toolkit/guards";

const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
throwIfNull(row, `User ${id} not found in a context where it must exist`);
row.email; // narrowed — no longer `T | null`
```

Throws `NullError` (`/errors`) — a `ProblemDetailsError` shaped like `internalServerError()` —
when `value` is `null`/`undefined`.

### `valueOrDefault(value, defaultValue)`

Literally `value ?? defaultValue`. Use this one blessed helper instead of an ad-hoc `??` fallback
so lint rules can flag other defensive `??` usage as suspicious while allowing this one.

```ts
import { valueOrDefault } from "@adrianhall/cloudflare-toolkit/guards";

const level = valueOrDefault(options.level, "info");
```

### `sqlCount(row, countProperty?)`

Use for the D1 `SELECT COUNT(*) AS count FROM t` → `.first<{count:number}>()` pattern, where a
missing/malformed row means a bug, not a legitimate `0`.

```ts
import { sqlCount } from "@adrianhall/cloudflare-toolkit/guards";

const row = await db
  .prepare("SELECT COUNT(*) AS count FROM orders WHERE user_id = ?")
  .bind(userId)
  .first();
const total = sqlCount(row); // number — throws NullError/InvalidShapeError otherwise

// Custom count column:
const row2 = await db.prepare("SELECT COUNT(*) AS n FROM orders").first();
const total2 = sqlCount(row2, "n");
```

Throws `NullError` if `row` is `null`/`undefined` (D1 `.first()` returned no rows), or
`InvalidShapeError` if `row` is non-null but not an object, or `countProperty` is missing/not a
number.

## HTTP Errors (`/errors`)

One generator per supported status code. Every generator has the signature
`(input?: { detail?, type?, instance?, extensions? }) => ProblemDetailsError` and can be thrown
from a plain function, a Durable Object method, or a Hono handler identically — pairing one with
`problemDetailsErrorHandler` (`/hono`) is what turns the throw into an HTTP response.

| Generator                      | Status |
| ------------------------------ | ------ |
| `badRequest(input?)`           | 400    |
| `unauthorized(input?)`         | 401    |
| `forbidden(input?)`            | 403    |
| `notFound(input?)`             | 404    |
| `methodNotAllowed(input?)`     | 405    |
| `gone(input?)`                 | 410    |
| `contentTooLarge(input?)`      | 413    |
| `unsupportedMediaType(input?)` | 415    |
| `unprocessableContent(input?)` | 422    |
| `internalServerError(input?)`  | 500    |
| `notImplemented(input?)`       | 501    |
| `serviceUnavailable(input?)`   | 503    |

```ts
import { Hono } from "hono";
import { notFound, unprocessableContent } from "@adrianhall/cloudflare-toolkit/errors";
import { problemDetailsErrorHandler } from "@adrianhall/cloudflare-toolkit/hono";

const app = new Hono();
app.onError(problemDetailsErrorHandler());

app.get("/orders/:id", async (c) => {
  const order = await findOrder(c.req.param("id"));
  if (!order) {
    throw notFound({ detail: `Order ${c.req.param("id")} does not exist` });
  }
  return c.json(order);
});

app.post("/orders", async (c) => {
  const body = await c.req.json();
  if (!body.sku) {
    throw unprocessableContent({ detail: "sku is required" });
  }
  // ...
});
```

`429 Too Many Requests` is deliberately not included (a platform/rate-limiting concern, not this
toolkit's). `304 Not Modified`, `409 Conflict`, and `412 Precondition Failed` are also not
included in v1 — their useful shape is a future Data Access Patterns concern.

### `NullError` / `InvalidShapeError`

Specialized `internalServerError()`-shaped `ProblemDetailsError` subclasses thrown internally by
`/guards`' `throwIfNull`/`sqlCount`. You rarely construct these directly — they exist so guard
failures have a single, greppable call site — but because both remain `ProblemDetailsError`
instances, `problemDetailsErrorHandler` (`/hono`) handles them uniformly with every other thrown
error, with no special-casing required.

```ts
import { InvalidShapeError, NullError } from "@adrianhall/cloudflare-toolkit/errors";

try {
  doSomethingRisky();
} catch (err) {
  if (err instanceof NullError || err instanceof InvalidShapeError) {
    // A defensive guard tripped — this is a bug, log it distinctly if you want to.
  }
  throw err;
}
```

## Problem Details (`/problem-details`)

The core RFC 9457 Problem Details primitives. **Hono-free by design** — nothing under this
subpath imports `hono`, so it's safe from any runtime. It's a vendored port of
[`adrianhall/hono-problem-details`](https://github.com/adrianhall/hono-problem-details) (itself a
fork of the MIT-licensed `paveg/hono-problem-details`) — see `THIRD-PARTY-NOTICES.md` for the
required upstream license attribution. The Hono-wired handler
(`problemDetailsErrorHandler`) is re-exported separately from `/hono` since it needs Hono's
`Context`/`ErrorHandler` types.

### `problemDetails(input)` / `ProblemDetailsError`

Use directly when you want a custom status/type not covered by an `/errors` generator.

```ts
import { problemDetails } from "@adrianhall/cloudflare-toolkit/problem-details";

throw problemDetails({
  status: 409,
  type: "https://api.example.com/problems/order-conflict",
  title: "Order Conflict",
  detail: `Order ${orderId} already exists`
});
```

Missing `type` defaults to `"about:blank"`; missing `title` is derived from `status` via
`statusToPhrase`. `ProblemDetailsError#getResponse()` builds a standalone
`application/problem+json` `Response` without any Hono handler — useful outside a Hono app (e.g.
a Durable Object's own `fetch`).

### `statusToPhrase(status)` / `statusToSlug(status)`

```ts
import { statusToPhrase, statusToSlug } from "@adrianhall/cloudflare-toolkit/problem-details";

statusToPhrase(404); // "Not Found"
statusToSlug(404); // "not-found" — handy for building a `type` URI from a status code
```

### `createProblemTypeRegistry(definitions)`

Use when an app has a fixed catalog of named problem types it wants type-safe creation for,
rather than constructing ad-hoc `problemDetails()` calls at every throw site.

```ts
import { createProblemTypeRegistry } from "@adrianhall/cloudflare-toolkit/problem-details";

const problems = createProblemTypeRegistry({
  ORDER_CONFLICT: {
    type: "https://api.example.com/problems/order-conflict",
    status: 409,
    title: "Order Conflict"
  }
});

throw problems.create("ORDER_CONFLICT", { detail: "Already exists" });
problems.types(); // ["ORDER_CONFLICT"]
```

### `ProblemDetails` / `ProblemDetailsInput` types

Use when authoring a custom error handler (e.g. `mapError` in `problemDetailsErrorHandler`,
`/hono`) or a `localize` callback that needs to read/patch the standard RFC 9457 fields
(`type`, `status`, `title`, `detail`, `instance`, `extensions`).

## Logging (`/logging`)

The framework-agnostic logger core — synchronous, dependency-free, and never throws into
application code. This is what `/hono`'s `cloudflareLogger` middleware wraps.

### `createLogger(options)`

```ts
import { createLogger, createConsoleTransport } from "@adrianhall/cloudflare-toolkit/logging";

const logger = createLogger({
  level: "info", // minimum level emitted; defaults to "info"
  transport: createConsoleTransport(),
  bindings: { service: "my-worker" }, // merged into every record
  onTransportError(error, record) {
    // called when transport.log() throws; exceptions here are swallowed
  }
});

logger.trace("fine detail"); // suppressed — below "info"
logger.info("server started", { port: 8787 });
logger.warn("slow query", { duration: 1200 });
logger.error("request failed", { err }); // top-level Error values are serialized automatically
```

Child loggers inherit `transport`/`level`/`clock`/`onTransportError` and merge `bindings` on top
of the parent's:

```ts
const requestLog = logger.child({ requestId: crypto.randomUUID() });
requestLog.info("handler started");
```

### `resolveLoggerConfig(environment, runtime)`

Optional policy helper that maps an environment + runtime pair to a ready-to-use
`{ level, transport }` pair, so apps don't have to hand-wire transports per environment.

```ts
import { resolveLoggerConfig, createLogger } from "@adrianhall/cloudflare-toolkit/logging";

const logger = createLogger(resolveLoggerConfig(env.ENVIRONMENT, "worker"));
```

| Environment           | Runtime     | Level   | Transport  |
| --------------------- | ----------- | ------- | ---------- |
| `"test"`              | either      | `trace` | capture    |
| `"development"`       | `"browser"` | `info`  | browser    |
| `"development"`       | `"worker"`  | `debug` | console    |
| `"production"`        | `"browser"` | `warn`  | browser    |
| `"production"`        | `"worker"`  | `warn`  | structured |
| unknown / `undefined` | `"browser"` | `warn`  | browser    |
| unknown / `undefined` | `"worker"`  | `warn`  | structured |

There is no `detectRuntime()` helper — pass `"browser"` or `"worker"` explicitly.

### `serializeError(value)`

Use explicitly for errors that appear in a **nested** context position — the logger only
auto-serializes top-level `Error` values.

```ts
import { serializeError } from "@adrianhall/cloudflare-toolkit/logging";

logger.error("failed", { wrapper: { err: serializeError(new Error("oops")) } });
```

### Transports

| Scenario                | Transport                      |
| ----------------------- | ------------------------------ |
| Vitest tests            | `createCaptureTransport()`     |
| Suppress all output     | `createSilentTransport()`      |
| Browser DevTools        | `createBrowserTransport()`     |
| `wrangler dev` terminal | `createConsoleTransport()`     |
| Cloudflare Workers Logs | `createStructuredTransport()`  |
| Multiple destinations   | `combineTransports(a, b, ...)` |

```ts
import {
  createLogger,
  createCaptureTransport,
  createStructuredTransport,
  combineTransports
} from "@adrianhall/cloudflare-toolkit/logging";

// Vitest — preferred assertion pattern.
const capture = createCaptureTransport();
const logger = createLogger({ level: "trace", transport: capture });
logger.warn("threshold exceeded", { value: 999 });
capture.find("warn"); // readonly LogRecord[] — preferred over filtering `.records` manually

// Cloudflare Workers Logs — objects by default so fields are indexed.
createStructuredTransport(); // { stringify: false } by default
createStructuredTransport({ stringify: true }); // JSON string instead

// Fan out to more than one destination; failures in one transport don't block the others.
const logger2 = createLogger({
  transport: combineTransports(createConsoleTransport(), createStructuredTransport())
});
```

`createCaptureTransport()` also exposes `.records` (a readonly snapshot) and `.clear()`.
`createConsoleTransport({ colors?, timestamp? })` and `createBrowserTransport({ levelStyles? })`
accept formatting options; `createSilentTransport()` takes none and discards everything.

## Hono Middleware (`/hono`)

Four independently-wired middleware/handlers. There is **no** combined/coordinator middleware —
wire each one yourself:

```ts
import { Hono } from "hono";
import {
  cloudflareAccess,
  cloudflareLogger,
  problemDetailsErrorHandler,
  notFoundHandler,
  type CloudflareToolkitVariables
} from "@adrianhall/cloudflare-toolkit/hono";

interface AppVariables extends CloudflareToolkitVariables {
  // Custom variables go here
}

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use(cloudflareLogger());
app.use(
  cloudflareAccess({
    policies: [{ pattern: /^\/api\/version$/, authenticate: false }],
    enableDevTokens: import.meta.env.DEV // never statically `true` in a deployed Worker
  })
);

app.onError(problemDetailsErrorHandler());
app.notFound(notFoundHandler());

app.get("/api/me", (c) => {
  c.get("LOGGER").info("handling /api/me");
  return c.json({ email: c.get("userEmail") });
});

export default app;
```

`Env` is your own wrangler-generated global binding type (produced by
`generate-wrangler-types`, below) — the standard Hono `Bindings` generic, not a
toolkit-specific type.

### `cloudflareAccess(options?)`

Validates a Cloudflare Access JWT (from the `CF_Authorization` cookie or the
`Cf-Access-Jwt-Assertion` header) and sets `AuthVariables` (`userEmail`, `userSub`) on the Hono
context.

- `policies?: PathPolicy[]` — `{ pattern: RegExp, authenticate: boolean }`, evaluated in order,
  first match wins.
- `defaultAction?: "block" | "bypass"` — behavior for a path matching no policy. Defaults to
  `"block"` (401 if no valid JWT).
- `teamDomain?` / `audience?` — Cloudflare Access team domain and Application Audience Tag. When
  omitted, `teamDomain` is read from `c.env.CLOUDFLARE_TEAM_DOMAIN` at request time, and `aud`
  validation is skipped entirely if `audience` is not supplied.

  **Always set `audience` outside local development.** Every Access application in a team shares
  the same JWKS, so without an `aud` check a token minted for _any other Access application in
  the same team_ is accepted here too (cross-application token replay). Unless
  `enableDevTokens` is `true`, omitting `audience` logs a one-time warning at construction time
  for exactly this reason.

- `enableDevTokens?: boolean` — **defaults to `false` (fail-closed)**. When `false`, only real
  Cloudflare Access JWKS verification is attempted; a developer-signed HS256 token is rejected
  even in a deployed Worker. Gate this on a build-time-`false`-in-production signal:

  ```ts
  app.use(cloudflareAccess({ policies, enableDevTokens: import.meta.env.DEV }));
  ```

  Enabling it without an explicit `devSecret` logs a one-time warning that the public
  `DEFAULT_DEV_SECRET` (`/testing`) is in use — safe only on localhost.

- `logger?: Logger` — a `/logging` `Logger` for debug/info/warn/error diagnostics. Defaults to a
  silent logger.

```ts
import { cloudflareAccess, type AuthVariables } from "@adrianhall/cloudflare-toolkit/hono";

const app = new Hono<{ Variables: AuthVariables }>();
app.use(cloudflareAccess({ policies: [{ pattern: /^\/api\/version$/, authenticate: false }] }));
app.get("/api/*", (c) => c.json({ user: c.get("userEmail") }));
```

### `cloudflareLogger(options?)`

Injects a request-scoped `Logger` (`/logging`) into the Hono context as `LOGGER`
(`LoggerVariables`). It does **not** perform automatic request/response trace logging — it only
resolves and attaches the logger for other middleware/handlers to use.

```ts
import { cloudflareLogger, type LoggerVariables } from "@adrianhall/cloudflare-toolkit/hono";

const app = new Hono<{ Variables: LoggerVariables }>();
app.use(cloudflareLogger()); // resolves level/transport via resolveLoggerConfig(env.ENVIRONMENT, "worker")
app.get("/", (c) => {
  c.get("LOGGER").info("handling request");
  return c.text("ok");
});
```

Override the environment/level/transport explicitly (e.g. in tests) via
`cloudflareLogger({ environment, level, transport })`.

### `problemDetailsErrorHandler(options?)`

An `app.onError` handler that converts `ProblemDetailsError`, Hono `HTTPException`, and any other
unhandled exception into an RFC 9457 `application/problem+json` response.

```ts
app.onError(
  problemDetailsErrorHandler({
    typePrefix: "https://api.example.com/problems", // appends a status-derived slug
    autoInstance: true, // populate `instance` from c.req.path when not set explicitly
    includeStack: false // MUST stay false outside local development — see below
  })
);
```

`includeStack` defaults to `false` and is security-sensitive: never set it `true` in a deployed
Worker — the stack is emitted as a top-level `stack` extension member, not folded into `detail`,
but it's still real internal detail you don't want in production responses.

### `notFoundHandler(options?)`

An `app.notFound` handler producing the same RFC 9457 `404` shape that throwing `notFound()`
(`/errors`) through `problemDetailsErrorHandler` would — without requiring a request to actually
throw. `app.notFound()` and `app.onError()` are independent Hono hooks; wiring both is normal and
does **not** double-wrap a 404 response.

```ts
app.notFound(notFoundHandler({ typePrefix: "https://api.example.com/problems" }));
```

### `AuthVariables` / `LoggerVariables` / `CloudflareToolkitVariables`

Two separate, independently composable Hono `Variables` types — because either middleware may or
may not be wired in a given app — plus a convenience alias for using both together:

```ts
import type {
  AuthVariables,
  LoggerVariables,
  CloudflareToolkitVariables
} from "@adrianhall/cloudflare-toolkit/hono";

// Using only cloudflareAccess:
type AppContext1 = { Variables: AuthVariables };

// Using only cloudflareLogger:
type AppContext2 = { Variables: LoggerVariables };

// Using both — equivalent to `AuthVariables & LoggerVariables`:
interface AppVariables extends CloudflareToolkitVariables {
  // Custom variables go here
}
```

## Vite Plugin (`/vite`)

### `cloudflareAccessPlugin(options?)`

A **dev-only** Vite plugin that emulates the Cloudflare Access edge in front of
[`@cloudflare/vite-plugin`](https://www.npmjs.com/package/@cloudflare/vite-plugin). In
production, Cloudflare Access sits at the edge and injects the `Cf-Access-Jwt-Assertion` header
before the request reaches the Worker; during `vite dev` there is no Access in the loop, so this
plugin reproduces that at the Vite connect-middleware layer — the Worker keeps only the
production `cloudflareAccess` middleware, with no separate dev-authentication middleware.

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

Pass the **same** `policies` array you give `cloudflareAccess` in the Worker so dev and
production agree on which paths are protected. Other options: `devSecret` (must match the
Worker's, if overridden there), `users` (selectable identities on the dev login form instead of a
free-text email field), `loginPath` (default `/cdn-cgi/access/login`), `tokenLifetime` (seconds,
default `86400`).

The plugin serves the login form, `/cdn-cgi/access/logout`, and `/cdn-cgi/access/get-identity`
itself, and issues a dev-signed JWT accepted by the Worker's own `cloudflareAccess` (both share
the same `DEFAULT_DEV_SECRET`/verification code internally) — no separate verification logic to
keep in sync.

See ["Vite + Vitest configuration"](#vite--vitest-configuration-for-a-honoworkers-project) below
for a full working pair with `@cloudflare/vite-plugin` and `@cloudflare/vitest-pool-workers`.

## Testing Helpers (`/testing`)

Sign developer JWTs and build the cookie/header values `cloudflareAccess`'s dev-token bypass
expects, for Vitest/Playwright tests against Access-protected routes — without a real Cloudflare
Access deployment.

```ts
import { signDevJwt, JWT_HEADER } from "@adrianhall/cloudflare-toolkit/testing";
import { cloudflareAccess } from "@adrianhall/cloudflare-toolkit/hono";

const app = new Hono();
app.use(cloudflareAccess({ enableDevTokens: true })); // opt-in, test-only

app.get("/api/me", (c) => c.json({ email: c.get("userEmail") }));

const token = await signDevJwt("alice@example.com");
const res = await app.request("/api/me", { headers: { [JWT_HEADER]: token } });
```

Cookie-based auth (mirrors how a browser session actually authenticates):

```ts
import {
  signDevJwt,
  buildCookieHeader,
  clearCookieHeader
} from "@adrianhall/cloudflare-toolkit/testing";

const token = await signDevJwt("alice@example.com", { sub: "user-123", lifetime: 3600 });
const res = await app.request("/api/me", { headers: { cookie: buildCookieHeader(token, false) } });

// Simulate logout:
const loggedOut = await app.request("/api/me", { headers: { cookie: clearCookieHeader() } });
```

`JWT_HEADER` and `COOKIE_NAME` are the exact header/cookie names `cloudflareAccess` reads, so
tests never hardcode magic strings that could drift out of sync.

**Never** enable `enableDevTokens: true` outside test/dev code — it's fail-closed by default for
a reason.

## `generate-wrangler-types` CLI

Regenerates `worker-configuration.d.ts` from `wrangler.jsonc` — but only when the config file has
actually changed, so it's cheap to run on every build.

```jsonc
// package.json
{
  "scripts": {
    "prebuild": "generate-wrangler-types",
    "build": "vite build"
  }
}
```

| Flag            | Meaning                                                                       |
| --------------- | ----------------------------------------------------------------------------- |
| `-c, --config`  | Wrangler config file to watch (default `wrangler.jsonc`)                      |
| `-d, --dir`     | Base directory for resolving relative paths (default `.`)                     |
| `-f, --force`   | Force regeneration even if types are already fresh                            |
| `-o, --output`  | Output `.d.ts` path relative to `--dir` (default `worker-configuration.d.ts`) |
| `-q, --quiet`   | Quiet logging (min level `warn`)                                              |
| `-v, --verbose` | Verbose logging (min level `debug`)                                           |
| `--`            | Everything after this is forwarded verbatim to `wrangler types`               |

```sh
generate-wrangler-types --force
generate-wrangler-types -c wrangler.staging.jsonc -o types/worker-configuration.d.ts
generate-wrangler-types -- --strict-vars=false
```

Exit codes: `0` fresh/success, `1` config file not found, `2` wrangler binary not executable,
`3` `wrangler types` exited non-zero, `6` argument error (e.g. `-v` + `-q` together), `99`
unexpected internal error.

## Vite + Vitest configuration for a Hono/Workers project

This section is deliberately mirrored — not linked-to-instead-of — by the docs site's own
[Vite + Vitest configuration guide](https://adrianhall.github.io/cloudflare-toolkit/guides/vite-vitest):
one copy of this worked example for a coding agent reading this file, one for a human reading the
docs site. If you change the pattern below, update both (see `AGENTS.md`'s architectural rules).

This is a common source of misconfiguration in Hono/Wrangler apps. Consult Cloudflare's own docs
first — they cover the underlying `@cloudflare/vite-plugin` and
`@cloudflare/vitest-pool-workers` APIs this toolkit builds on:

- [Cloudflare Plugin for Vite](https://developers.cloudflare.com/workers/vite-plugin/)
- [Cloudflare Vitest Information](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Reference Samples](https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/)

The pattern below wires one Worker (`wrangler.jsonc`) that is both (a) served locally via
`@cloudflare/vite-plugin` + `cloudflareAccessPlugin`, and (b) exercised in Vitest via
`@cloudflare/vitest-pool-workers` against that **same** config — so `npm run dev` and
`npm run test` agree on bindings, compatibility date, and flags.

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
    // Order matters — see the "Vite Plugin" section above.
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

Note that `cloudflareAccessPlugin` and `/testing`'s `signDevJwt` are two independent ways to get
past `cloudflareAccess` locally: the Vite plugin emulates the **browser** login flow (cookies,
redirects, a login form) for `vite dev`; `/testing` signs a token directly for **Vitest**
assertions against the Worker's `fetch` handler, with no Vite server involved at all. Both must
enable `cloudflareAccess({ enableDevTokens: true, ... })` (or rely on a build-time
`import.meta.env.DEV` gate) for the token they produce to be accepted.

## Anti-patterns

### Do not import `/hono`, `/vite`, or `/testing` from framework-agnostic code

```ts
// BAD — pulls the optional `hono` peer into code that should run anywhere
import { cloudflareLogger } from "@adrianhall/cloudflare-toolkit/hono";

// GOOD — the root entry point (or /logging directly) has no hono/vite dependency
import { createLogger } from "@adrianhall/cloudflare-toolkit";
```

### Do not import `/vite` from Worker code

```ts
// BAD — src/index.ts is Worker code; this depends on `node:http` types and the `vite` peer dep
import { cloudflareAccessPlugin } from "@adrianhall/cloudflare-toolkit/vite";

// GOOD — cloudflareAccessPlugin only ever belongs in vite.config.ts
```

### Do not enable `enableDevTokens` without a build-time production gate

```ts
// BAD — a deployed Worker now trusts a forgeable HS256 token signed with DEFAULT_DEV_SECRET
app.use(cloudflareAccess({ enableDevTokens: true }));

// GOOD — statically `false` once bundled for production
app.use(cloudflareAccess({ enableDevTokens: import.meta.env.DEV }));
```

### Do not set `includeStack: true` outside local development

```ts
// BAD — leaks internal stack traces in production error responses
app.onError(problemDetailsErrorHandler({ includeStack: true }));

// GOOD — the default. Only flip it on behind the same DEV-only gate as enableDevTokens.
app.onError(problemDetailsErrorHandler({ includeStack: import.meta.env.DEV }));
```

### Do not construct a new logger per request

```ts
// BAD — resolves config and allocates a new logger on every single request
app.use(async (c, next) => {
  const logger = createLogger(resolveLoggerConfig(c.env.ENVIRONMENT, "worker"));
  c.set("LOGGER", logger);
  await next();
});

// GOOD — use cloudflareLogger(), which does exactly this once per request but is the
// documented, tested entry point — or construct a base logger once per isolate and .child()
// per request instead of rebuilding from resolveLoggerConfig() each time.
app.use(cloudflareLogger());
```

### Do not skip `cloudflareAccessPlugin` ordering relative to `@cloudflare/vite-plugin`

```ts
// BAD — cloudflare() dispatches into workerd before the Access headers are injected
export default defineConfig({
  plugins: [cloudflare(), cloudflareAccessPlugin({ policies })]
});

// GOOD — cloudflareAccessPlugin() first
export default defineConfig({
  plugins: [cloudflareAccessPlugin({ policies }), cloudflare()]
});
```

### Do not duplicate `problemDetails()` construction instead of using an `/errors` generator

```ts
// BAD — reinvents a generator that already exists
throw problemDetails({ status: 404, title: "Not Found", detail: "..." });

// GOOD — use the matching generator; title/type default correctly and the intent is clearer
throw notFound({ detail: "..." });
```

### Do not assume `app.notFound()` needs `app.onError()` to also fire

```ts
// This is NOT a bug — app.notFound() and app.onError() are independent Hono hooks.
app.notFound(notFoundHandler());
app.onError(problemDetailsErrorHandler());
// A request that falls through to notFoundHandler() never re-enters onError; it does not
// "double wrap" the response.
```

## Out of scope

This skill does not include a migration guide from other Cloudflare Access, structured-logging,
or wrangler-tooling libraries you may have previously used — that mapping is deliberately not
maintained here. If you're migrating an existing consumer of a different Cloudflare
Access/logging/CLI package, read this skill's per-subpath sections above alongside that
package's own docs and adjust your imports manually.
