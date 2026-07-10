// Errors barrel (docs/SPECv2.md §5.1, §5.3, §5.9): HTTP error generators + NullError.
// Depends only on `problem-details` — never the reverse.
export {
  badRequest,
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
export { InvalidShapeError } from "./invalid-shape-error.js";
export { NullError } from "./null-error.js";
