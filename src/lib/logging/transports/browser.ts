/**
 * @file A transport that formats records for browser DevTools using `%c` styled level badges.
 *
 * `createBrowserTransport()` maps severity levels to appropriate console methods and passes the
 * context object as a separate argument when non-empty, so DevTools can expand it interactively.
 *
 * Level-to-method mapping:
 *   trace, debug → console.debug
 *   info          → console.info
 *   warn          → console.warn
 *   error, fatal  → console.error
 */
import { getConsoleMethod } from "../internal/console.js";
import type { ConsoleLike, ConsoleMethodName } from "../internal/console.js";
import type { BrowserTransportOptions, LogLevel, LogRecord, Transport } from "../types.js";

/** Default CSS badge styles keyed by level. */
const DEFAULT_STYLES: Readonly<Record<LogLevel, string>> = {
  trace: "color: #9ca3af; font-weight: bold",
  debug: "color: #6b7280; font-weight: bold",
  info: "color: #3b82f6; font-weight: bold",
  warn: "color: #f59e0b; font-weight: bold",
  error: "color: #ef4444; font-weight: bold",
  fatal: "color: #dc2626; font-weight: bold; text-decoration: underline"
};

/** Map each log level to the preferred console method name. */
const LEVEL_METHOD: Readonly<Record<LogLevel, ConsoleMethodName>> = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  fatal: "error"
};

/**
 * Create a browser transport optimized for DevTools output.
 *
 * @param options - Optional level style overrides.
 * @param _console - Injected console-like object (defaults to global `console`). Used in tests.
 * @returns A `Transport` that writes styled records to the browser console.
 */
export function createBrowserTransport(
  options?: BrowserTransportOptions,
  _console: ConsoleLike = console
): Transport {
  const levelStyles: Readonly<Record<LogLevel, string>> = {
    ...DEFAULT_STYLES,
    ...options?.levelStyles
  };

  return {
    log(record: LogRecord): void {
      const methodName = LEVEL_METHOD[record.level];
      const method = getConsoleMethod(_console, methodName);
      const style = levelStyles[record.level];
      const badge = record.level.toUpperCase();

      const hasContext = Object.keys(record.context).length > 0;

      if (hasContext) {
        method(`%c${badge}`, style, record.message, record.context);
      } else {
        method(`%c${badge}`, style, record.message);
      }
    }
  };
}
