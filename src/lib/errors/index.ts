/**
 * @file Public entry point for the `errors` subpath: HTTP error generators, plus the
 * `NullError`/`InvalidShapeError` guard-failure types.
 *
 * Depends only on `problem-details` — never the reverse.
 */
export {
  badRequest,
  contentTooLarge,
  forbidden,
  gone,
  internalServerError,
  methodNotAllowed,
  notFound,
  notImplemented,
  serviceUnavailable,
  unauthorized,
  unprocessableContent,
  unsupportedMediaType
} from "./generators.js";
export type { HttpErrorInput } from "./generators.js";
export { InvalidShapeError } from "./invalid-shape-error.js";
export { NullError } from "./null-error.js";
