/**
 * @file The core logger implementation. This is the framework-agnostic core that the
 * `cloudflareLogger` Hono middleware wraps — it must never import `hono`.
 *
 * `createLogger()` constructs a `Logger` that:
 *   - Filters records below the configured level before touching context.
 *   - Merges bindings and per-call context into a new object (never mutates input).
 *   - Serializes top-level `Error` values in context before delivering to transport.
 *   - Wraps transport delivery in try/catch so transport failures never escape.
 *   - Supports child loggers that inherit transport, level, clock, and error handler.
 */
import { levelValue } from "./levels.js";
import { serializeError } from "./serialize.js";
import type {
  CreateLoggerOptions,
  LogContext,
  LogLevel,
  LogRecord,
  Logger,
  TransportErrorHandler,
  Transport
} from "./types.js";

/**
 * Internal factory used by both `createLogger` and child loggers.
 *
 * All logger state is captured in the closure; no class is used. Both root loggers and child
 * loggers are created through this function, which keeps the child creation path identical to
 * the root path.
 *
 * @param level - Minimum level to emit.
 * @param transport - Destination for emitted records.
 * @param bindings - Key-value pairs merged into every record's context.
 * @param clock - Produces the timestamp for each record.
 * @param onTransportError - Optional callback for transport failures.
 * @returns A `Logger` bound to the supplied state.
 */
function makeLogger(
  level: LogLevel,
  transport: Transport,
  bindings: LogContext,
  clock: () => Date,
  onTransportError: TransportErrorHandler | undefined
): Logger {
  const currentLevelValue = levelValue(level);

  /**
   * Returns `true` when records at `candidate` severity will be emitted. Used both for the
   * public `isLevelEnabled` method and internally before constructing a record.
   *
   * @param candidate - The level to test against the configured minimum level.
   * @returns `true` when `candidate` is at or above the configured minimum level.
   */
  function isLevelEnabled(candidate: LogLevel): boolean {
    return levelValue(candidate) >= currentLevelValue;
  }

  /**
   * Core emit path shared by all six level methods.
   *
   * Exits immediately when `logLevel` is below the configured minimum so that disabled calls
   * never access the `context` argument. When enabled, merges bindings with per-call context,
   * serializes top-level `Error` values, builds the `LogRecord`, and delivers it to the
   * transport inside a try/catch.
   *
   * @param logLevel - Severity of this record.
   * @param message - Human-readable description of the event.
   * @param context - Optional per-call structured context.
   */
  function emit(logLevel: LogLevel, message: string, context?: LogContext): void {
    if (!isLevelEnabled(logLevel)) {
      return;
    }

    // Merge bindings + call context into a new object. Per-call context wins.
    const merged: LogContext =
      context !== undefined ? { ...bindings, ...context } : { ...bindings };

    // Serialize top-level Error values before delivering to transport.
    const serializedContext: LogContext = {};
    for (const key of Object.keys(merged)) {
      serializedContext[key] = serializeError(merged[key]);
    }

    const record: LogRecord = {
      time: clock().toISOString(),
      level: logLevel,
      levelValue: levelValue(logLevel),
      message,
      context: serializedContext
    };

    try {
      transport.log(record);
    } catch (error) {
      try {
        onTransportError?.(error, record);
      } catch {
        // Logging must not throw into application code.
      }
    }
  }

  return {
    get level(): LogLevel {
      return level;
    },

    isLevelEnabled,

    trace(message: string, context?: LogContext): void {
      emit("trace", message, context);
    },

    debug(message: string, context?: LogContext): void {
      emit("debug", message, context);
    },

    info(message: string, context?: LogContext): void {
      emit("info", message, context);
    },

    warn(message: string, context?: LogContext): void {
      emit("warn", message, context);
    },

    error(message: string, context?: LogContext): void {
      emit("error", message, context);
    },

    fatal(message: string, context?: LogContext): void {
      emit("fatal", message, context);
    },

    child(childBindings: LogContext): Logger {
      // Child inherits parent's transport, level, clock, and error handler.
      // Child bindings are merged: parent bindings + child bindings.
      return makeLogger(
        level,
        transport,
        { ...bindings, ...childBindings },
        clock,
        onTransportError
      );
    }
  };
}

/**
 * Create a new `Logger` with the provided options.
 *
 * - `options.transport` is required.
 * - `options.level` defaults to `"info"`.
 * - `options.clock` defaults to `() => new Date()`.
 * - `options.bindings` are merged into every emitted record.
 * - `options.onTransportError` receives transport errors without crashing the app.
 *
 * @param options - Logger construction options.
 * @returns A new `Logger`.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const {
    transport,
    level = "info",
    bindings = {},
    clock = () => new Date(),
    onTransportError
  } = options;

  return makeLogger(level, transport, bindings, clock, onTransportError);
}
