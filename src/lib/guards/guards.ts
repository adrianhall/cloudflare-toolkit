/**
 * @file Testable defensive guards — `throwIfNull`, `valueOrDefault`, `sqlCount` — that let call
 * sites replace inline, ad-hoc defensive branches with a single, individually-tested helper.
 *
 * Depends only on `errors` (for `NullError` and `InvalidShapeError`) — never the reverse.
 */
import { InvalidShapeError, NullError } from "../errors/index.js";

/**
 * Assert that `value` is neither `null` nor `undefined`. A genuine TypeScript assertion function:
 * once called, TypeScript narrows `value` to `NonNullable<T>` for the rest of the calling scope,
 * so callers get type narrowing for free instead of needing a separate `if`/cast.
 *
 * @param value - The value to check.
 * @param message - Human-readable explanation of what was unexpectedly null/undefined. Forwarded
 *   as-is to the thrown {@link NullError}.
 * @throws {NullError} If `value` is `null` or `undefined`.
 */
export function throwIfNull<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
    throw new NullError(message);
  }
}

/**
 * Return `value` unless it is `null`/`undefined`, in which case return `defaultValue` instead.
 * Literally `value ?? defaultValue` — exists purely so lint rules can flag _ad hoc_ `??`
 * fallbacks used defensively while allowing this one blessed, individually-tested helper.
 *
 * @param value - The value to return if defined.
 * @param defaultValue - The fallback returned when `value` is `null`/`undefined`.
 * @returns `value`, or `defaultValue` when `value` is `null`/`undefined`.
 */
export function valueOrDefault<T>(value: T | null | undefined, defaultValue: T): T {
  return value ?? defaultValue;
}

/**
 * Extract a numeric count from a D1 `.first()` result for the `SELECT COUNT(*) AS count FROM t`
 * pattern. Validates that `row` is a non-null object with a numeric `countProperty`; throws
 * {@link NullError} (via {@link throwIfNull}) if `row` itself is
 * `null`/`undefined`, or {@link InvalidShapeError} if `row` is non-null but does not have the
 * expected shape (not an object, or `countProperty` on it missing/not a number) — since the whole
 * point of this guard is "this should never happen — if it does, that's a bug, not a 0".
 *
 * @param row - The value returned by D1's `.first()` — `null` when no rows match, otherwise
 *   whatever shape the query produced. Typed `unknown` because a D1 result is never trustworthy
 *   input.
 * @param countProperty - The property on `row` holding the count. Defaults to `"count"`.
 * @returns The numeric count read from `row[countProperty]`.
 * @throws {NullError} If `row` is `null` or `undefined`.
 * @throws {InvalidShapeError} If `row` is non-null but not an object, or `countProperty` on it is
 *   missing or not a number.
 */
export function sqlCount(row: unknown, countProperty = "count"): number {
  throwIfNull(row, "sqlCount: row is null or undefined (D1 .first() returned no rows)");
  if (typeof row !== "object") {
    throw new InvalidShapeError(`sqlCount: row is not an object (received ${typeof row})`);
  }
  const value = (row as Record<string, unknown>)[countProperty];
  if (typeof value !== "number") {
    throw new InvalidShapeError(`sqlCount: property "${countProperty}" is missing or not a number`);
  }
  return value;
}
