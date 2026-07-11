/**
 * @file A private stderr logger for the `generate-wrangler-types` CLI. Not exported from any
 * barrel — this logger is an internal implementation detail of this one CLI, not part of the
 * toolkit's public API surface, and is intentionally a separate, simpler abstraction from the
 * `logging` subpath's `Logger`/`Transport` contract (`src/lib/logging/types.ts`).
 *
 * The split is deliberate, not an oversight: this is a Node-only CLI concern (colored, leveled
 * `stderr` output for a `bin` entry point) rather than the flagship Worker/browser structured
 * logging core, ported verbatim from this toolkit's predecessor CLI tooling. See
 * `docs/specs/SPECv2.md` §12.3 (ARCH-003) for the full rationale.
 *
 * All output is written to `stderr`. Color is applied when `process.stderr.isTTY === true`;
 * otherwise output is plain text. Log line format: `<ISO-UTC-ms> [<level>] <message>`.
 */
import chalk from "chalk";

/**
 * The set of supported log levels, ordered from least to most severe.
 *
 * - `debug` — verbose diagnostic output (enabled with `-v`)
 * - `info` — normal operational messages (default)
 * - `warn` — non-fatal anomalies
 * - `error` — failures that halt or degrade operation
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * A low-level output function that receives a fully-resolved log record.
 *
 * The default sink writes colored (or plain) timestamped lines to `stderr`. Tests inject an
 * in-memory sink to capture and assert on log output without printing to the console.
 *
 * @param level - The severity level of the message.
 * @param message - The plain-text message body.
 */
export type LogSink = (level: LogLevel, message: string) => void;

/**
 * A structured logger with one method per {@link LogLevel}.
 *
 * Messages below the configured minimum level are silently dropped.
 */
export interface Logger {
  /** Emit a `debug`-level message. Dropped unless the logger level is `debug`. */
  debug(message: string): void;
  /** Emit an `info`-level message. */
  info(message: string): void;
  /** Emit a `warn`-level message. */
  warn(message: string): void;
  /** Emit an `error`-level message. */
  error(message: string): void;
}

/**
 * Options accepted by {@link createLogger}.
 */
export interface LoggerOptions {
  /** The minimum severity level that will be forwarded to the sink. */
  level: LogLevel;
  /**
   * Optional custom sink. Defaults to a stderr writer that applies chalk colors when
   * `process.stderr.isTTY` is `true`.
   */
  sink?: LogSink;
}

/** Numeric ordering used to compare {@link LogLevel} values. */
const LOG_LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

/**
 * Applies a chalk color to `line` based on the log level.
 *
 * - `debug` → blue
 * - `info` → green
 * - `warn` → yellow
 * - `error` → red
 *
 * @param level - The log level that determines the color.
 * @param line - The fully-formatted log line to colorize.
 * @returns The colorized string.
 */
function colorize(level: LogLevel, line: string): string {
  switch (level) {
    case "debug":
      return chalk.blue(line);
    case "info":
      return chalk.green(line);
    case "warn":
      return chalk.yellow(line);
    case "error":
      return chalk.red(line);
  }
}

/**
 * Creates the default {@link LogSink} that writes to `process.stderr`.
 *
 * Each line is formatted as `<ISO-UTC-ms> [<level>] <message>`. Color is applied when
 * `process.stderr.isTTY === true`.
 *
 * @returns A `LogSink` that writes to `stderr`.
 */
function createDefaultSink(): LogSink {
  const useColor = process.stderr.isTTY === true;
  return (level: LogLevel, message: string): void => {
    const timestamp = new Date().toISOString();
    const line = `${timestamp} [${level}] ${message}`;
    const output = useColor ? colorize(level, line) : line;
    process.stderr.write(`${output}\n`);
  };
}

/**
 * Creates a {@link Logger} that forwards messages at or above `options.level` to the configured
 * sink.
 *
 * @param options - Logger configuration including the minimum level and an optional custom sink.
 * @returns A {@link Logger} instance.
 */
export function createLogger(options: LoggerOptions): Logger {
  const { level, sink = createDefaultSink() } = options;
  const minOrder = LOG_LEVEL_ORDER[level];

  function log(msgLevel: LogLevel, message: string): void {
    if (LOG_LEVEL_ORDER[msgLevel] >= minOrder) {
      sink(msgLevel, message);
    }
  }

  return {
    debug: (message) => log("debug", message),
    info: (message) => log("info", message),
    warn: (message) => log("warn", message),
    error: (message) => log("error", message)
  };
}
