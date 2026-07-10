// Numeric level weights for the logging subpath. Ported from adrianhall/cloudflare-logger's
// `src/levels.ts` (same author, MIT — see docs/SPECv2.md §10; source repo is read-only and not
// modified by this port).
//
// `LOG_LEVELS` and `levelValue()` are internal implementation details — not exported from
// `src/lib/logging/index.ts`. Numeric values are stable for the emitted `LogRecord.levelValue`
// field.
import type { LogLevel } from "./types.js";

/**
 * Stable numeric weights for each log level.
 *
 * A record is emitted when: `LOG_LEVELS[record.level] >= LOG_LEVELS[logger.level]`
 */
export const LOG_LEVELS: Readonly<Record<LogLevel, number>> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
};

/**
 * Return the numeric weight for `level`.
 *
 * Throws a `TypeError` for any value that is not a recognized `LogLevel`. TypeScript consumers
 * should rely on the `LogLevel` union type and never reach this error path under normal usage.
 * Deliberately not swapped for `throwIfNull` (docs/SPECv2.md §8 rule 8): this throws a
 * `TypeError` for an unrecognized string, not a `null`/`undefined` guard, so swapping it would
 * change the thrown error type.
 *
 * @param level - The level to look up.
 * @returns The numeric weight for `level`.
 * @throws {TypeError} If `level` is not one of the six recognized `LogLevel` values.
 */
export function levelValue(level: LogLevel): number {
  const value = LOG_LEVELS[level];
  if (value === undefined) {
    throw new TypeError(
      `Unknown log level: ${String(level)}. Expected one of: ${Object.keys(LOG_LEVELS).join(", ")}`
    );
  }
  return value;
}
