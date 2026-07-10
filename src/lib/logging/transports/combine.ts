// Combine transport for the logging subpath. Ported from adrianhall/cloudflare-logger's
// `src/transports/combine.ts` (same author, MIT — see docs/SPECv2.md §10; source repo is
// read-only and not modified by this port).
//
// `combineTransports()` fans out each record to multiple child transports in declaration order.
// It attempts every child even when an earlier one throws, then re-throws the collected failures
// so the logger-level try/catch can route them through `onTransportError`.
//
// Failure semantics:
//   - One child throws  → that error is re-thrown after all children run.
//   - Multiple children throw → an `AggregateError` is thrown after all children run.
//   - No child throws   → returns normally.
import type { LogRecord, Transport } from "../types.js";

/**
 * Create a transport that forwards records to each of the supplied transports.
 *
 * @param transports - One or more transports to receive every record.
 * @returns A combined `Transport`.
 */
export function combineTransports(...transports: readonly Transport[]): Transport {
  return {
    log(record: LogRecord): void {
      const errors: unknown[] = [];

      for (const transport of transports) {
        try {
          transport.log(record);
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length === 1) {
        throw errors[0];
      }
      if (errors.length > 1) {
        throw new AggregateError(errors, "Multiple transports failed");
      }
    }
  };
}
