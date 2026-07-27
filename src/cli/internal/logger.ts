/**
 * @file Private Node-only logger shared by the package's CLI binaries.
 *
 * This intentionally remains separate from the public Worker/browser logging subpath: CLI output
 * is timestamped, colored terminal text written to stderr rather than structured log records.
 */
import chalk from "chalk";

/** Supported CLI log levels, ordered from least to most severe. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Injectable destination for CLI log messages. */
export type LogSink = (level: LogLevel, message: string) => void;

/** Private logger contract used by CLI orchestration and adapters. */
export interface Logger {
  /** Emits a debug message. */
  debug(message: string): void;
  /** Emits an informational message. */
  info(message: string): void;
  /** Emits a warning message. */
  warn(message: string): void;
  /** Emits an error message. */
  error(message: string): void;
}

const LOG_LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

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

function createDefaultSink(): LogSink {
  const useColor = process.stderr.isTTY === true;
  return (level, message) => {
    const line = `${new Date().toISOString()} [${level}] ${message}`;
    process.stderr.write(`${useColor ? colorize(level, line) : line}\n`);
  };
}

/**
 * Creates a CLI logger that forwards messages at or above the selected level.
 *
 * @param options - Minimum level and optional test sink.
 * @param options.level - Minimum severity to emit.
 * @param options.sink - Optional destination used instead of stderr.
 * @returns A leveled CLI logger.
 */
export function createLogger(options: { level: LogLevel; sink?: LogSink }): Logger {
  const { level, sink = createDefaultSink() } = options;
  const minOrder = LOG_LEVEL_ORDER[level];
  const log = (messageLevel: LogLevel, message: string): void => {
    if (LOG_LEVEL_ORDER[messageLevel] >= minOrder) sink(messageLevel, message);
  };
  return {
    debug: (message) => log("debug", message),
    info: (message) => log("info", message),
    warn: (message) => log("warn", message),
    error: (message) => log("error", message)
  };
}
