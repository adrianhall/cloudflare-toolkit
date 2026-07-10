// Silent transport for the logging subpath. Ported from adrianhall/cloudflare-logger's
// `src/transports/silent.ts` (same author, MIT — see docs/SPECv2.md §10; source repo is
// read-only and not modified by this port).
//
// `createSilentTransport()` discards every record without emitting anything to the console and
// without throwing. Use it as a no-op transport in contexts where logging should be fully
// suppressed.
import type { Transport } from "../types.js";

/**
 * Create a silent transport that discards all records.
 *
 * @returns A `Transport` that does nothing.
 */
export function createSilentTransport(): Transport {
  return {
    log(): void {
      // Intentionally empty — records are dropped without side effects.
    }
  };
}
