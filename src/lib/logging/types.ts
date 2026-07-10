/**
 * @file Core public types for the logging subpath.
 *
 * These types form the stable public contract for the logging core. Numeric level values are
 * fixed once released; the string `LogLevel` union is the primary API surface for TypeScript
 * consumers.
 */

/**
 * The six severity levels supported by the logger, ordered from lowest to highest: `trace <
 * debug < info < warn < error < fatal`.
 *
 * Numeric weights are exposed on `LogRecord.levelValue`.
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Arbitrary structured key-value pairs attached to a log record.
 *
 * Values may be any JSON-compatible type. Top-level `Error` values are serialized to plain
 * objects by the logger before transport delivery.
 */
export type LogContext = Record<string, unknown>;

/**
 * An immutable, fully-resolved log record delivered to transports.
 *
 * The logger creates exactly one record per enabled log call. Transports receive the record
 * after level filtering and context serialization.
 */
export interface LogRecord {
  /** ISO 8601 timestamp produced by the logger's clock at emit time. */
  readonly time: string;
  /** String severity level of this record. */
  readonly level: LogLevel;
  /** Numeric weight of `level`. */
  readonly levelValue: number;
  /** Human-readable description of the event. */
  readonly message: string;
  /** Merged bindings and per-call context. Top-level `Error` values have been serialized. */
  readonly context: LogContext;
}

/**
 * The minimum interface a transport must implement.
 *
 * `log` is called synchronously for every record that passes level filtering. Built-in
 * transports must not throw; the logger wraps all transport calls in try/catch and routes
 * failures through `onTransportError`.
 */
export interface Transport {
  /** Deliver `record` to the transport's destination. */
  log(record: LogRecord): void;
}

/**
 * Optional callback invoked when a transport's `log` method throws.
 *
 * Receives the thrown value and the record that triggered the failure. Any exception thrown by
 * this callback is silently swallowed by the logger.
 */
export type TransportErrorHandler = (error: unknown, record: LogRecord) => void;

/**
 * Options accepted by `createLogger`.
 */
export interface CreateLoggerOptions {
  /**
   * Minimum severity level to emit. Records below this level are dropped before context is
   * accessed. Defaults to `"info"`.
   */
  readonly level?: LogLevel;
  /** Transport to receive emitted records. Required. */
  readonly transport: Transport;
  /**
   * Key-value pairs merged into every record's context. Per-call context wins on key collision.
   * Defaults to `{}`.
   */
  readonly bindings?: LogContext;
  /**
   * Clock used to produce `record.time`. Defaults to `() => new Date()`. Override in tests for
   * deterministic timestamps.
   */
  readonly clock?: () => Date;
  /**
   * Called when the transport throws. Receives the error and the record that triggered it.
   * Exceptions thrown by this callback are swallowed.
   */
  readonly onTransportError?: TransportErrorHandler;
}

/**
 * The public logging interface returned by `createLogger` and `child`.
 *
 * Each level method checks `isLevelEnabled` before touching the context argument, so disabled
 * calls impose no observable side effects.
 */
export interface Logger {
  /** Emit a `trace`-level record. No-op when `trace` is below the configured level. */
  trace(message: string, context?: LogContext): void;
  /** Emit a `debug`-level record. No-op when `debug` is below the configured level. */
  debug(message: string, context?: LogContext): void;
  /** Emit an `info`-level record. No-op when `info` is below the configured level. */
  info(message: string, context?: LogContext): void;
  /** Emit a `warn`-level record. No-op when `warn` is below the configured level. */
  warn(message: string, context?: LogContext): void;
  /** Emit an `error`-level record. No-op when `error` is below the configured level. */
  error(message: string, context?: LogContext): void;
  /** Emit a `fatal`-level record. No-op when `fatal` is below the configured level. */
  fatal(message: string, context?: LogContext): void;
  /**
   * Return a new logger that inherits this logger's transport, level, clock, and error handler,
   * with `bindings` merged on top of the parent's bindings. The parent logger is not affected.
   */
  child(bindings: LogContext): Logger;
  /** The minimum severity level this logger will emit. */
  readonly level: LogLevel;
  /** Returns `true` when records at `level` will be emitted by this logger. */
  isLevelEnabled(level: LogLevel): boolean;
}

/**
 * Environment hint for `resolveLoggerConfig`.
 * The `(string & {})` tail keeps the type open for custom environment names while preserving
 * autocomplete for the well-known values.
 */
export type Environment = "test" | "development" | "production" | (string & {});

/** Runtime hint for `resolveLoggerConfig`. */
export type Runtime = "browser" | "worker";

/** Output of `resolveLoggerConfig`. */
export interface ResolvedLoggerConfig {
  /** Minimum severity level selected for the environment and runtime. */
  readonly level: LogLevel;
  /** Transport selected for the environment and runtime. */
  readonly transport: Transport;
}

/**
 * Options for `createBrowserTransport`.
 * `levelStyles` allows overriding the CSS style string applied to the level badge for any subset
 * of levels.
 */
export interface BrowserTransportOptions {
  /**
   * CSS style strings applied to the level badge via `%c` in `console` calls. Provide only the
   * levels you want to override; unspecified levels use the transport's built-in defaults.
   */
  readonly levelStyles?: Partial<Record<LogLevel, string>>;
}

/** Options for `createConsoleTransport`. */
export interface ConsoleTransportOptions {
  /**
   * Whether to emit ANSI color codes in the output. Defaults to `true`. Set to `false` for CI
   * environments or when piping output to a file.
   */
  readonly colors?: boolean;
  /**
   * Controls the timestamp prefix on each line.
   *
   * - `"time"` — concise `HH:MM:SS` derived from `record.time` (default).
   * - `"iso"` — full ISO 8601 string from `record.time`.
   * - `false` — no timestamp.
   */
  readonly timestamp?: "time" | "iso" | false;
}

/** Options for `createStructuredTransport`. */
export interface StructuredTransportOptions {
  /**
   * When `true`, serializes the payload to a JSON string before passing it to the console
   * method. When `false` (default), passes a plain object so that Cloudflare Workers Logs can
   * extract and index individual fields.
   */
  readonly stringify?: boolean;
}

/**
 * `CaptureTransport` extends `Transport` with test-ergonomic helpers.
 *
 * `.find(level)` is the preferred way to assert on records at a specific level in tests; it
 * avoids iterating `.records` manually.
 */
export interface CaptureTransport extends Transport {
  /**
   * Read-only ordered list of all records received since the last `clear()`. Returns an
   * immutable snapshot; mutating the returned value does not affect internal storage.
   */
  readonly records: readonly LogRecord[];
  /** Remove all stored records. */
  clear(): void;
  /**
   * Return all stored records whose `level` matches `level`.
   *
   * Preferred over filtering `.records` manually in test assertions.
   */
  find(level: LogLevel): readonly LogRecord[];
}
