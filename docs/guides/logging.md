# Logging

`/logging` is a framework-agnostic, dependency-free structured logger — synchronous, and
designed so that logging itself **never throws into application code**. `cloudflareLogger`
(`/hono`) wraps this core to attach a request-scoped logger to the Hono context; everything else
in this guide works identically in a Worker, a Node script, or a browser app.

## `createLogger(options)`

```ts
import { createLogger, createConsoleTransport } from "@adrianhall/cloudflare-toolkit/logging";

const logger = createLogger({
  level: "info", // minimum level emitted; defaults to "info"
  transport: createConsoleTransport(),
  bindings: { service: "my-worker" }, // merged into every record
  onTransportError(error, record) {
    // Called when transport.log() throws. Exceptions thrown from here are swallowed too —
    // logging is never allowed to crash the caller.
  }
});
```

There are **six** severity levels, in increasing order:
`trace < debug < info < warn < error < fatal`. A record is emitted only when its level is at or
above the logger's configured `level`:

```ts
logger.trace("fine detail"); // suppressed — below "info"
logger.debug("cache miss", { key });
logger.info("server started", { port: 8787 });
logger.warn("slow query", { duration: 1200 });
logger.error("request failed", { err }); // top-level Error values are serialized automatically
logger.fatal("unrecoverable state", { reason: "config missing" });
```

Every call accepts an optional structured context object as its second argument. A top-level
`Error` value in that context (e.g. `{ err }` above) is serialized automatically; for an `Error`
nested deeper in the context tree, serialize it explicitly with `serializeError` (below).

`logger.isLevelEnabled("debug")` lets you skip building an expensive context object when a level
wouldn't be emitted anyway; `logger.level` reads back the configured minimum level.

### Child loggers

`logger.child(bindings)` returns a new `Logger` that inherits the parent's `transport`, `level`,
`clock`, and `onTransportError`, and **merges** its own `bindings` on top of the parent's — handy
for attaching a per-request identifier without re-specifying the whole configuration:

```ts
const requestLog = logger.child({ requestId: crypto.randomUUID() });
requestLog.info("handler started"); // includes both `service` and `requestId` in context
```

## `resolveLoggerConfig(environment, runtime)`

An optional policy helper that maps an `environment` + `runtime` pair to a ready-to-use
`{ level, transport }` pair, so most apps don't have to hand-wire transports per environment:

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

Any environment string that isn't `"test"` or `"development"` — including `undefined` — falls
through to the `"production"` row. There is no `detectRuntime()` helper: pass `"browser"` or
`"worker"` explicitly, since your build already knows which one it's targeting. Each call to
`resolveLoggerConfig` constructs a **fresh** transport instance, which matters for test
isolation if you call it more than once with the same arguments.

## `serializeError(value)`

Use this explicitly for an error that appears **nested** inside a context object, rather than as
a top-level value — the logger only auto-serializes top-level `Error` values:

```ts
import { serializeError } from "@adrianhall/cloudflare-toolkit/logging";

logger.error("failed", { wrapper: { err: serializeError(new Error("oops")) } });
```

## Transports

A transport is just `{ log(record: LogRecord): void }`. Pick the one matching where the output
should go:

| Scenario                         | Transport                             |
| -------------------------------- | ------------------------------------- |
| Vitest tests (assert on records) | `createCaptureTransport()`            |
| Suppress all output              | `createSilentTransport()`             |
| Browser DevTools                 | `createBrowserTransport(options?)`    |
| `wrangler dev` terminal          | `createConsoleTransport(options?)`    |
| Cloudflare Workers Logs          | `createStructuredTransport(options?)` |
| Multiple destinations at once    | `combineTransports(a, b, ...)`        |

```ts
import {
  createLogger,
  createCaptureTransport,
  createStructuredTransport,
  createConsoleTransport,
  combineTransports
} from "@adrianhall/cloudflare-toolkit/logging";

// Vitest — preferred assertion pattern.
const capture = createCaptureTransport();
const logger = createLogger({ level: "trace", transport: capture });
logger.warn("threshold exceeded", { value: 999 });
capture.find("warn"); // readonly LogRecord[] — prefer this over filtering `.records` manually
capture.clear(); // reset between test cases

// Cloudflare Workers Logs — object payloads by default so fields are indexed.
createStructuredTransport(); // { time, level, message, ...context } as an object
createStructuredTransport({ stringify: true }); // same shape, JSON-stringified

// Console output with an ISO timestamp instead of the default HH:MM:SS.
createConsoleTransport({ colors: true, timestamp: "iso" });

// Fan out to more than one destination; one transport throwing doesn't block the others —
// combineTransports re-throws after every child has run, so onTransportError still fires once.
const logger2 = createLogger({
  transport: combineTransports(createConsoleTransport(), createStructuredTransport())
});
```

`createCaptureTransport()` also exposes a readonly `.records` snapshot for cases `.find()`
doesn't cover. `createConsoleTransport({ colors?: boolean, timestamp?: "time" | "iso" | false })`
and `createBrowserTransport({ levelStyles?: Partial<Record<LogLevel, string>> })` accept
formatting overrides; `createSilentTransport()` takes no options and discards everything.

## `cloudflareLogger` — the Hono middleware

Injects a request-scoped `Logger` into the Hono context as `LOGGER` (typed via
`LoggerVariables`). It does **not** perform automatic request/response trace logging on its own
— it only resolves and attaches the logger for your other middleware/handlers to use:

```ts
import { Hono } from "hono";
import { cloudflareLogger, type LoggerVariables } from "@adrianhall/cloudflare-toolkit/hono";

const app = new Hono<{ Bindings: Env; Variables: LoggerVariables }>();

// Resolves { level, transport } via resolveLoggerConfig(c.env.ENVIRONMENT, "worker") per request.
app.use(cloudflareLogger());

app.get("/", (c) => {
  c.get("LOGGER").info("handling request", { path: c.req.path });
  return c.text("ok");
});
```

Override the environment, level, or transport explicitly — e.g. so every test run uses a capture
transport regardless of `ENVIRONMENT` — via `cloudflareLogger({ environment, level, transport })`:

```ts
import { createCaptureTransport } from "@adrianhall/cloudflare-toolkit/logging";

const capture = createCaptureTransport();
app.use(cloudflareLogger({ level: "trace", transport: capture }));
```

## See also

- [Testing](/guides/testing) — using `createCaptureTransport()` to assert on log output emitted
  during a Vitest request, including logs from `cloudflareAccess`'s own diagnostics.
- [Authentication](/guides/authentication) — passing a `Logger` to `cloudflareAccess` for its
  audience/dev-secret warnings.
