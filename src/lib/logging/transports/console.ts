/**
 * @file A transport that formats records as human-readable single-line output intended for
 * terminal environments including `wrangler dev`.
 *
 * `createConsoleTransport()` supports optional ANSI color codes and configurable timestamp
 * formats.
 *
 * Level-to-method mapping:
 *   trace, debug, info  → console.log
 *   warn, error, fatal  → console.error
 *
 * Output format:
 *   [timestamp] LEVEL  message [{"key":"value"}]
 */
import { getConsoleMethod } from "../internal/console.js";
import type { ConsoleLike } from "../internal/console.js";
import { safeStringify } from "../internal/safe-json.js";
import { valueOrDefault } from "../../guards/index.js";
import type { ConsoleTransportOptions, LogLevel, LogRecord, Transport } from "../types.js";

// ---------------------------------------------------------------------------
// ANSI color codes
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";

/** Map each level to its ANSI color code. */
const LEVEL_COLOR: Readonly<Record<LogLevel, string>> = {
  trace: "\x1b[90m", // dark gray
  debug: "\x1b[37m", // white
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
  fatal: "\x1b[35m" // magenta
};

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/**
 * Extract an `HH:MM:SS` time string from an ISO 8601 timestamp. Falls back to the first 8
 * characters if the expected `T` separator is absent.
 *
 * Exported for direct unit testing of the fallback branch.
 *
 * @param isoString - An ISO 8601 timestamp string.
 * @returns The `HH:MM:SS` portion, or the first 8 characters if no `T` separator is found.
 */
export function extractTime(isoString: string): string {
  const tIndex = isoString.indexOf("T");
  if (tIndex === -1) {
    return isoString.slice(0, 8);
  }
  return isoString.slice(tIndex + 1, tIndex + 9);
}

// ---------------------------------------------------------------------------
// Level label helpers
// ---------------------------------------------------------------------------

/** Fixed-width (5 chars) uppercase level labels. */
const LEVEL_LABEL: Readonly<Record<LogLevel, string>> = {
  trace: "TRACE",
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
  fatal: "FATAL"
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a console transport for terminal/wrangler dev output.
 *
 * @param options - Timestamp and color options.
 * @param _console - Injected console-like object (defaults to global `console`). Used in tests.
 * @returns A `Transport` that writes formatted lines to the terminal.
 */
export function createConsoleTransport(
  options?: ConsoleTransportOptions,
  _console: ConsoleLike = console
): Transport {
  const colors = valueOrDefault(options?.colors, true);
  const timestamp = valueOrDefault(options?.timestamp, "time");

  return {
    log(record: LogRecord): void {
      // Choose sink: warn/error/fatal → stderr, rest → stdout.
      const isError =
        record.level === "warn" || record.level === "error" || record.level === "fatal";
      const method = getConsoleMethod(_console, isError ? "error" : "log");

      // Build the line parts.
      const parts: string[] = [];

      // Timestamp prefix.
      if (timestamp === "time") {
        const ts = extractTime(record.time);
        parts.push(colors ? `\x1b[90m${ts}${RESET}` : ts);
      } else if (timestamp === "iso") {
        parts.push(colors ? `\x1b[90m${record.time}${RESET}` : record.time);
      }

      // Level label.
      const label = LEVEL_LABEL[record.level];
      if (colors) {
        const color = LEVEL_COLOR[record.level];
        parts.push(`${color}${label}${RESET}`);
      } else {
        parts.push(label);
      }

      // Message.
      parts.push(record.message);

      // Context (compact safe JSON, omitted when empty).
      const hasContext = Object.keys(record.context).length > 0;
      if (hasContext) {
        parts.push(safeStringify(record.context));
      }

      method(parts.join(" "));
    }
  };
}
