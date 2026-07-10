// Capture transport for the logging subpath. Ported from adrianhall/cloudflare-logger's
// `src/transports/capture.ts` (same author, MIT — see docs/SPECv2.md §10; source repo is
// read-only and not modified by this port).
//
// `createCaptureTransport()` accumulates log records in memory without writing to the console.
// It is intended for use in Vitest tests where assertions need to inspect emitted records
// deterministically.
//
// Use `.find(level)` as the preferred assertion helper for level-specific record checks rather
// than filtering `.records` manually.
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
