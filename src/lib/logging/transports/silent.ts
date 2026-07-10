/**
 * @file A no-op transport that discards every record without emitting anything to the console
 * and without throwing. Use it in contexts where logging should be fully suppressed.
 */
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
