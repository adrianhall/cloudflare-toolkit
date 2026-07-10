/**
 * @file Public entry point for the `logging` subpath: `createLogger`, `resolveLoggerConfig`,
 * the built-in transports, and the logging types. This is the framework-agnostic logger core
 * that the `cloudflareLogger` Hono middleware (`@adrianhall/cloudflare-toolkit/hono`) wraps.
 *
 * Zero `hono` dependency anywhere under this subpath — safe to import from any runtime (Worker,
 * Node, browser).
 */
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
