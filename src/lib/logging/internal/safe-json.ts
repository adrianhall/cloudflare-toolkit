/**
 * @file Internal safe JSON/string formatting for the logging subpath. Not exported from
 * `src/lib/logging/index.ts`; used by `createConsoleTransport` and `createStructuredTransport`.
 *
 * `safeStringify()` serializes arbitrary values to a compact JSON string while handling the
 * common non-JSON types that appear in structured log context:
 *   - Circular references  → `"[Circular]"`
 *   - `bigint`             → `"<n>n"` (e.g. `42n` → `"42n"`)
 *   - `symbol`             → `"Symbol(description)"`
 *   - `function`           → `"[Function name]"` or `"[Function (anonymous)]"`
 *   - `undefined`          → omitted from objects, `"undefined"` at top level
 */

/**
 * A stable placeholder emitted when `JSON.stringify` itself throws unexpectedly (e.g. a getter
 * that throws mid-serialization after the circular-reference check has passed).
 */
const FALLBACK = "[FormattingError]";

/**
 * Convert a single value to a JSON-safe replacement.
 *
 * Called from the `JSON.stringify` replacer for every value encountered during serialization.
 * Non-JSON-safe primitives (`bigint`, `symbol`, `function`) are converted to descriptive
 * strings. All other values are returned unchanged so that `JSON.stringify` handles them
 * normally.
 *
 * Exported for direct unit testing so the default return path is reachable without going
 * through the full replacer loop.
 *
 * @param value - The raw value at the current key.
 * @returns A JSON-safe replacement value.
 */
export function replaceNonJsonValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "symbol") {
    // Symbol.prototype.toString() returns "Symbol(description)"
    return value.toString();
  }
  if (typeof value === "function") {
    const name = value.name;
    return name ? `[Function ${name}]` : "[Function (anonymous)]";
  }
  return value;
}

/**
 * Serialize `value` to a compact JSON string.
 *
 * Handles:
 * - Circular references (replaced with `"[Circular]"`)
 * - `bigint` (serialized as `"<n>n"`)
 * - `symbol` (serialized as `"Symbol(description)"`)
 * - `function` (serialized as `"[Function name]"`)
 * - `undefined` at the top level (returns `"undefined"`)
 * - Unexpected formatter errors (returns `"[FormattingError]"`)
 *
 * @param value - The value to serialize.
 * @returns A JSON string representation.
 */
export function safeStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  // Track objects seen during this serialization to detect circular refs.
  const seen = new Set<object>();

  try {
    return JSON.stringify(value, function replacer(_key: string, val: unknown): unknown {
      // Handle non-JSON primitives before the circular-ref check so that symbols and functions
      // (which are objects in some host environments) are caught early.
      if (typeof val === "bigint" || typeof val === "symbol" || typeof val === "function") {
        return replaceNonJsonValue(val);
      }

      // Circular reference detection applies to objects and arrays only.
      if (val !== null && typeof val === "object") {
        if (seen.has(val)) {
          return "[Circular]";
        }
        seen.add(val);
      }

      return val;
    });
  } catch {
    // Last-resort fallback: JSON.stringify threw despite the replacer.
    // This can happen when a getter throws during property enumeration.
    return FALLBACK;
  }
}
