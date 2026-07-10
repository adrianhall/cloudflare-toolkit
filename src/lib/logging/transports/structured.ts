// Structured transport for the logging subpath. Ported from adrianhall/cloudflare-logger's
// `src/transports/structured.ts` (same author, MIT — see docs/SPECv2.md §10; source repo is
// read-only and not modified by this port).
//
// `createStructuredTransport()` emits records as structured payloads intended for Cloudflare
// Workers Logs. Workers Logs automatically extracts and indexes fields from JSON object logs, so
// this transport defaults to object logging (`stringify: false`) rather than string logging.
//
// Payload shape: `{ time, level, message, ...context }`
// Reserved keys (`time`, `level`, `message`) from the record take precedence over identically
// named context keys.
//
// Level-to-method mapping:
//   trace, debug → console.debug
//   info          → console.log
//   warn          → console.warn
//   error, fatal  → console.error
//
// Dogfooding (docs/SPECv2.md §8 rule 8): the `options?.stringify ?? false` fallback below is the
// toolkit's own `valueOrDefault` guard instead of an ad hoc `??`.
import { getConsoleMethod } from "../internal/console.js";
import type { ConsoleLike, ConsoleMethodName } from "../internal/console.js";
import { safeStringify } from "../internal/safe-json.js";
import { valueOrDefault } from "../../guards/index.js";
import type { LogLevel, LogRecord, StructuredTransportOptions, Transport } from "../types.js";

/** Map each log level to the preferred console method name. */
const LEVEL_METHOD: Readonly<Record<LogLevel, ConsoleMethodName>> = {
  trace: "debug",
  debug: "debug",
  info: "log",
  warn: "warn",
  error: "error",
  fatal: "error"
};

/**
 * Create a structured transport for Cloudflare Workers Logs.
 *
 * @param options - Optional stringify flag.
 * @param _console - Injected console-like object (defaults to global `console`). Used in tests.
 * @returns A `Transport` that writes structured payloads to the console.
 */
export function createStructuredTransport(
  options?: StructuredTransportOptions,
  _console: ConsoleLike = console
): Transport {
  const stringify = valueOrDefault(options?.stringify, false);

  return {
    log(record: LogRecord): void {
      const methodName = LEVEL_METHOD[record.level];
      const method = getConsoleMethod(_console, methodName);

      // Build payload: context spread first, then reserved keys override.
      const payload: Record<string, unknown> = {
        ...record.context,
        time: record.time,
        level: record.level,
        message: record.message
      };

      if (stringify) {
        method(safeStringify(payload));
      } else {
        method(payload);
      }
    }
  };
}
