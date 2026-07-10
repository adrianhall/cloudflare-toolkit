/**
 * @file A transport that accumulates log records in memory without writing to the console.
 *
 * `createCaptureTransport()` is intended for use in Vitest tests where assertions need to
 * inspect emitted records deterministically. Use `.find(level)` as the preferred assertion
 * helper for level-specific record checks rather than filtering `.records` manually.
 */
import type { CaptureTransport, LogLevel, LogRecord } from "../types.js";

/**
 * Create a capture transport that stores records in memory.
 *
 * @returns A `CaptureTransport` with `.records`, `.clear()`, and `.find()`.
 */
export function createCaptureTransport(): CaptureTransport {
  let internal: LogRecord[] = [];

  return {
    log(record: LogRecord): void {
      internal.push(record);
    },

    get records(): readonly LogRecord[] {
      // Return a shallow copy so callers cannot mutate internal storage.
      return internal.slice();
    },

    clear(): void {
      internal = [];
    },

    find(level: LogLevel): readonly LogRecord[] {
      return internal.filter((r) => r.level === level);
    }
  };
}
