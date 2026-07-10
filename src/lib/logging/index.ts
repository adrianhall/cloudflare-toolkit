// Logging barrel (docs/SPECv2.md §5.1, §5.9): createLogger, resolveLoggerConfig, transports,
// logging types — the framework-agnostic logger core that the `cloudflareLogger` Hono
// middleware (a later issue, `@adrianhall/cloudflare-toolkit/hono`) wraps. Ported from
// adrianhall/cloudflare-logger (same author, MIT — see docs/SPECv2.md §10; source repo is
// read-only and not modified by this port). React-specific exports
// (`adrianhall/cloudflare-logger/react`) are deliberately not carried over (docs/SPECv2.md §4).
//
// Zero `hono` dependency anywhere under this subpath — safe to import from any runtime (Worker,
// Node, browser).
export { createLogger } from "./logger.js";
export { resolveLoggerConfig } from "./resolve.js";
export { serializeError } from "./serialize.js";
export { createBrowserTransport } from "./transports/browser.js";
export { createCaptureTransport } from "./transports/capture.js";
export { combineTransports } from "./transports/combine.js";
export { createConsoleTransport } from "./transports/console.js";
export { createSilentTransport } from "./transports/silent.js";
export { createStructuredTransport } from "./transports/structured.js";

export type {
  BrowserTransportOptions,
  CaptureTransport,
  ConsoleTransportOptions,
  CreateLoggerOptions,
  Environment,
  Logger,
  LogContext,
  LogLevel,
  LogRecord,
  ResolvedLoggerConfig,
  Runtime,
  StructuredTransportOptions,
  Transport,
  TransportErrorHandler
} from "./types.js";
