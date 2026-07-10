// Internal helper for the logging subpath. Ported from adrianhall/cloudflare-logger's
// `src/defensive-guards.ts` (same author, MIT — see docs/SPECv2.md §10; source repo is
// read-only and not modified by this port), renamed to `optional-field.ts` to avoid confusion
// with this toolkit's own `src/lib/guards` subpath (docs/SPECv2.md §5.2) — `optionalField` is a
// different, logging-internal helper, not one of the toolkit's public defensive guards.
//
// Not exported from `src/lib/logging/index.ts`.

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
