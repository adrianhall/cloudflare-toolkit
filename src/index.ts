// Root barrel (docs/SPECv2.md §5.1): re-exports guards + errors + problem-details + logging
// only. Framework-agnostic — safe to import from any runtime (Worker, Node, browser).
//
// Must NEVER re-export anything from a `hono`/`vite`/`testing` subpath (each pulls in a
// `hono`/`vite`/Node-only runtime dependency and stays import-by-subpath-only) — enforced by
// test/package/index.test.ts, which asserts the exact set of runtime exports below.
export { sqlCount, throwIfNull, valueOrDefault } from "./lib/guards/index.js";

export {
  badRequest,
  forbidden,
  gone,
  internalServerError,
  InvalidShapeError,
  methodNotAllowed,
  notFound,
  notImplemented,
  NullError,
  serviceUnavailable,
  unauthorized,
  unprocessableContent,
  unsupportedMediaType
} from "./lib/errors/index.js";

export {
  createProblemTypeRegistry,
  problemDetails,
  ProblemDetailsError,
  statusToPhrase,
  statusToSlug
} from "./lib/problem-details/index.js";
export type { ProblemDetails, ProblemDetailsInput } from "./lib/problem-details/index.js";

export {
  combineTransports,
  createBrowserTransport,
  createCaptureTransport,
  createConsoleTransport,
  createLogger,
  createSilentTransport,
  createStructuredTransport,
  resolveLoggerConfig,
  serializeError
} from "./lib/logging/index.js";
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
} from "./lib/logging/index.js";
