/**
 * @file An internal helper for the logging subpath — not one of the toolkit's public defensive
 * guards (`src/lib/guards`) and not exported from `src/lib/logging/index.ts`.
 */

/**
 * Returns `{ [prop]: o[prop] }` when `prop` is an own property of `o` with a non-`undefined`
 * value, otherwise returns `{}`.
 *
 * Intended for safely spreading optional fields onto plain objects without introducing
 * `undefined`-valued keys:
 *
 * ```ts
 * const result = {
 *   name: err.name,
 *   ...optionalField(err, "stack"),
 * };
 * ```
 *
 * @param o - The object to read `prop` from.
 * @param prop - The property to conditionally include.
 * @returns `{ [prop]: o[prop] }` when defined, otherwise `{}`.
 */
export function optionalField<T extends object>(
  o: T,
  prop: keyof T
): Partial<Pick<T, typeof prop>> {
  return o[prop] !== undefined ? ({ [prop]: o[prop] } as Partial<Pick<T, typeof prop>>) : {};
}
