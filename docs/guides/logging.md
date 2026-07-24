# Logging

The Cloudflare Toolkit contains [a framework-agnostic, dependency-free structured logger](/reference/lib/logging/) that is designed so that logging itself never throws into application code. The toolkit also includes a middleware for Hono that attaches a request-scoped logger to the Hono context.

## Typical usage

### In a Hono API app

Use the [Hono middleware](#configuring-hono-for-logging) immediately after creating your Hono app to inject a logger into your Hono context:

```ts
const app = new Hono<{ Bindings: Env; Variables: CloudflareToolkitVariables }>();

app.use(cloudflareLogger());
// logger is available as ctx.var.LOGGER
```

### In a SPA

Initialize the logger and use it wherever needed:

```ts
const logger = createLogger(resolveLoggerConfig("development", "browser"));
```

### Using a Logger

Once you have a logger, you can log messages with structured content easily.

```ts
logger.info("I'm an info message with some data", { data: 1234, err: new Error("An error") });
```

## The core logger

The core logger is defined by the [`Logger`](/reference/lib/logging/index.md#logger) interface:

```ts
/**
 * There are six types of log level, ordered.
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * You can add additional context to each log message.
 */
export type LogContext = Record<string, unknown>;

/**
 * The core logger definition.
 */
export interface Logger {
  trace(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;

  /**
   * Return a new logger that inherits this logger's transport, level, clock, and error handler,
   * with `bindings` merged on top of the parent's bindings. The parent logger is not affected.
   */
  child(bindings: LogContext): Logger;

  /**
   * The minimum severity level this logger will emit.
   */
  readonly level: LogLevel;

  /**
   * Returns `true` when records at `level` will be emitted by this logger.
   */
  isLevelEnabled(level: LogLevel): boolean;
}
```

There are **six** severity levels, in increasing order:

- `trace`
- `debug`
- `info`
- `warn`
- `error`
- `fatal`

A log record is emitted only when its level is at or above the logger's configured `level`.

### Creating a Logger

Use [`createLogger(options)`](/reference/lib/logging/index.md#createlogger) to create a logger:

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

The options are:

- `level` - the minimum log level; defaults to `info`.
- `transport` - must be provided.
- `bindings` - an object that is merged into the `LogContext` of every record. This is empty by default.
- `onTransportError` - called when logging would throw an error. By default, this is unused.

The logger is guaranteed not to throw. All thrown errors are swallowed by the toolkit. The `onTransportError()` provides a "last-chance" to capture the error and do something with it.

### Transports

There are six transports available:

- [`createBrowserTransport()`](/reference/lib/logging/index.md#createbrowsertransport) - for formatting messages suitable for typical browser DevTools environments.
- [`createCaptureTransport()`](/reference/lib/logging/index.md#createcapturetransport) - for capturing logs during testing.
- [`createConsoleTransport()`](/reference/lib/logging/index.md#createconsoletransport) - a security-focused console transport.
- [`createSilentTransport()`](/reference/lib/logging/index.md#createsilenttransport) - to ensure that nothing is logged (typically during testing).
- [`createStructuredTransport()`](/reference/lib/logging/index.md#createstructuredtransport) - for formatting messages suitable for Cloudflare Workers Logs.
- [`combineTransports()`](/reference/lib/logging/index.md#combinetransports) - for combining multiple transports together.

Each of these has options associated with them. Review the [API Reference](/reference/lib/logging/) for more details on the specifics of each transport.

### Logging messages

Use the logger functions to log messages:

```ts
logger.trace("fine detail");
logger.debug("cache miss", { key });
logger.info("server started", { port: 8787 });
logger.warn("slow query", { duration: 1200 });
logger.error("request failed", { err });
logger.fatal("unrecoverable state", { reason: "config missing" });
```

Every call accepts an optional structured context object as its second argument. A top-level `Error` value in that context (e.g. `{ err }` above) is serialized automatically; for an `Error` nested deeper in the context tree, serialize it explicitly with [`serializeError`](/reference/lib/logging/index.md#serializeerror):

```ts
import { serializeError } from "@adrianhall/cloudflare-toolkit/logging";

// At the top level, errors are serialized automatically
logger.error("failed", { err: new Error("oops") });
// When nested, you need to serialize yourself
logger.error("failed", { wrapper: { err: serializeError(new Error("oops")) } });
```

`logger.isLevelEnabled("debug")` lets you skip building an expensive context object when a level wouldn't be emitted anyway; `logger.level` reads back the configured minimum level.

### Child loggers

`logger.child(bindings)` returns a new `Logger` that inherits the parent's `transport`, `level`, `clock`, and `onTransportError`, and **merges** its own `bindings` on top of the parent's — handy for attaching a per-request identifier without re-specifying the whole configuration:

```ts
const requestLog = logger.child({ requestId: crypto.randomUUID() });
requestLog.info("handler started"); // includes both `service` and `requestId` in context
```

## Building loggers using the environment

You can quickly create a suitable logger given an `environment` and `runtime` pair. Different pairs produce different transports:

| Environment           | Runtime     | Level   | Transport  |
| --------------------- | ----------- | ------- | ---------- |
| `"test"`              | either      | `trace` | capture    |
| `"development"`       | `"browser"` | `info`  | browser    |
| `"development"`       | `"worker"`  | `debug` | console    |
| `"production"`        | `"browser"` | `warn`  | browser    |
| `"production"`        | `"worker"`  | `warn`  | structured |
| unknown / `undefined` | `"browser"` | `warn`  | browser    |
| unknown / `undefined` | `"worker"`  | `warn`  | structured |

To create a logger, use [`resolveLoggerConfig()`](/reference/lib/logging/index.md#resolveloggerconfig) combined with [`createLogger`](/reference/lib/logging/index.md#createlogger):

```ts
import { resolveLoggerConfig, createLogger } from "@adrianhall/cloudflare-toolkit/logging";

const logger = createLogger(resolveLoggerConfig(env.ENVIRONMENT, "worker"));
```

Any environment string that isn't `"test"` or `"development"` — including `undefined` — falls through to the `"production"` row. Each call to `resolveLoggerConfig()` constructs a **fresh** transport instance. This is mostly a consideration during test isolation if you call it more than once with the same arguments.

## Configuring Hono for logging

We also distribute a Hono middleware that injects a request-scoped [`Logger`](/reference/lib/logging/index.md#logger) into the Hono context as the `LOGGER` variable. This is typed via [`LoggerVariables`](/reference/lib/hono/interfaces/LoggerVariables.md) or by the combined [`CloudflareToolkitVariables`](/reference/lib/hono/type-aliases/CloudflareToolkitVariables.md). It does **not** perform automatic request/response trace logging.

```ts
import { Hono } from "hono";
import { cloudflareLogger, type LoggerVariables } from "@adrianhall/cloudflare-toolkit/hono";

const app = new Hono<{ Bindings: Env; Variables: LoggerVariables }>();

app.use(cloudflareLogger());

app.get("/", (ctx) => {
  // Typed version
  ctx.var.LOGGER.info("handling request", { path: c.req.path });
  // Untyped version
  ctx.get("LOGGER").info("handling request", { path: c.req.path });
  return c.text("ok");
});
```

The default middleware uses the value of the `ENVIRONMENT` environment variable and the `worker` runtime. You can also override the environment, level, or transport explicitly by passing the logger options to the middleware:

```ts
import { createCaptureTransport } from "@adrianhall/cloudflare-toolkit/logging";

const capture = createCaptureTransport();
app.use(cloudflareLogger({ level: "trace", transport: capture }));
```

### Overriding the level with a `LOG_LEVEL` binding

For operational control without a redeploy of code, the middleware also honors a `LOG_LEVEL` Worker binding (`c.env.LOG_LEVEL`). The minimum level is resolved in this order of precedence:

1. `options.level` — the value passed to `cloudflareLogger({ level })`, when supplied.
2. `c.env.LOG_LEVEL` — when it is one of the six recognized levels (`trace`, `debug`, `info`, `warn`, `error`, `fatal`). Matching is **case-insensitive**, so `"INFO"` and `"info"` are equivalent.
3. The environment-resolved default from `resolveLoggerConfig(env.ENVIRONMENT, "worker")`.

If `LOG_LEVEL` is set to a value that is not a recognized level, it is ignored — a `console.warn` is emitted and the middleware falls back to the environment-resolved default. If `LOG_LEVEL` is not set at all, the existing behavior is unchanged.

```jsonc
// wrangler.jsonc
{
  "vars": {
    "ENVIRONMENT": "production",
    "LOG_LEVEL": "debug" // temporarily raise verbosity in production
  }
}
```

## See also

- [Testing](/guides/testing) — using `createCaptureTransport()` to assert on log output emitted during a Vitest request, including logs from `cloudflareAccess`'s own diagnostics.
- [Authentication](/guides/authentication) — passing a `Logger` to `cloudflareAccess` for its audience/dev-secret warnings.
