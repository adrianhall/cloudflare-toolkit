/**
 * @file Public entry point for the `guards` subpath: `throwIfNull`, `valueOrDefault`, `sqlCount`.
 *
 * Depends only on `errors` (for `NullError`) — never the reverse.
 */
export { sqlCount, throwIfNull, valueOrDefault } from "./guards.js";
