// HTTP error generators (docs/SPECv2.md §5.3): one function per row of the generator table.
// Every generator uniformly has the signature `(input?: Omit<ProblemDetailsInput, "status">) =>
// ProblemDetailsError` — each fixes its own `status` and forwards `detail`/`type`/`instance`/
// `extensions` untouched via `problemDetails()`; `title` auto-derives from `status`
// (`normalizeProblemDetails`, ../problem-details/utils.ts) unless the caller explicitly overrides
// it. These are plain functions, not framework-specific: throwing one inside a plain function, a
// Durable Object method, or a Hono handler all work identically — only the vendored
// `problemDetailsErrorHandler` (`@adrianhall/cloudflare-toolkit/hono`, a later issue) turns the
// throw into an HTTP response.
//
// `429 Too Many Requests` is deliberately not included (a Cloudflare Workers platform concern,
// not this toolkit's). `304 Not Modified`, `409 Conflict`, and `412 Precondition Failed` are also
// deliberately not included in v1 — see docs/SPECv2.md §4/§5.3.
import { problemDetails } from "../problem-details/factory.js";
import type { ProblemDetailsError } from "../problem-details/error.js";
import type { ProblemDetailsInput } from "../problem-details/types.js";

/**
 * Input shared by every HTTP error generator: a {@link ProblemDetailsInput} without `status`,
 * since each generator supplies its own fixed status code.
 */
export type HttpErrorInput<T extends Record<string, unknown> = Record<string, unknown>> = Omit<
  ProblemDetailsInput<T>,
  "status"
>;

/**
 * Create a `400 Bad Request` {@link ProblemDetailsError}.
 *
 * @param input - Optional problem details fields (`detail`, `type`, `instance`, `extensions`).
 * @returns A `400`-status {@link ProblemDetailsError} ready to `throw`.
 */
export function badRequest(input?: HttpErrorInput): ProblemDetailsError {
  return problemDetails({ ...input, status: 400 });
}

/**
 * Create a `401 Unauthorized` {@link ProblemDetailsError}.
 *
 * @param input - Optional problem details fields (`detail`, `type`, `instance`, `extensions`).
 * @returns A `401`-status {@link ProblemDetailsError} ready to `throw`.
 */
export function unauthorized(input?: HttpErrorInput): ProblemDetailsError {
  return problemDetails({ ...input, status: 401 });
}

/**
 * Create a `403 Forbidden` {@link ProblemDetailsError}.
 *
 * @param input - Optional problem details fields (`detail`, `type`, `instance`, `extensions`).
 * @returns A `403`-status {@link ProblemDetailsError} ready to `throw`.
 */
export function forbidden(input?: HttpErrorInput): ProblemDetailsError {
  return problemDetails({ ...input, status: 403 });
}

/**
 * Create a `404 Not Found` {@link ProblemDetailsError}.
 *
 * @param input - Optional problem details fields (`detail`, `type`, `instance`, `extensions`).
 * @returns A `404`-status {@link ProblemDetailsError} ready to `throw`.
 */
export function notFound(input?: HttpErrorInput): ProblemDetailsError {
  return problemDetails({ ...input, status: 404 });
}

/**
 * Create a `405 Method Not Allowed` {@link ProblemDetailsError}.
 *
 * @param input - Optional problem details fields (`detail`, `type`, `instance`, `extensions`).
 * @returns A `405`-status {@link ProblemDetailsError} ready to `throw`.
 */
export function methodNotAllowed(input?: HttpErrorInput): ProblemDetailsError {
  return problemDetails({ ...input, status: 405 });
}

/**
 * Create a `410 Gone` {@link ProblemDetailsError}.
 *
 * @param input - Optional problem details fields (`detail`, `type`, `instance`, `extensions`).
 * @returns A `410`-status {@link ProblemDetailsError} ready to `throw`.
 */
export function gone(input?: HttpErrorInput): ProblemDetailsError {
  return problemDetails({ ...input, status: 410 });
}

/**
 * Create a `415 Unsupported Media Type` {@link ProblemDetailsError}.
 *
 * @param input - Optional problem details fields (`detail`, `type`, `instance`, `extensions`).
 * @returns A `415`-status {@link ProblemDetailsError} ready to `throw`.
 */
export function unsupportedMediaType(input?: HttpErrorInput): ProblemDetailsError {
  return problemDetails({ ...input, status: 415 });
}

/**
 * Create a `422 Unprocessable Content` {@link ProblemDetailsError}.
 *
 * @param input - Optional problem details fields (`detail`, `type`, `instance`, `extensions`).
 * @returns A `422`-status {@link ProblemDetailsError} ready to `throw`.
 */
export function unprocessableContent(input?: HttpErrorInput): ProblemDetailsError {
  return problemDetails({ ...input, status: 422 });
}

/**
 * Create a `500 Internal Server Error` {@link ProblemDetailsError}.
 *
 * @param input - Optional problem details fields (`detail`, `type`, `instance`, `extensions`).
 * @returns A `500`-status {@link ProblemDetailsError} ready to `throw`.
 */
export function internalServerError(input?: HttpErrorInput): ProblemDetailsError {
  return problemDetails({ ...input, status: 500 });
}

/**
 * Create a `501 Not Implemented` {@link ProblemDetailsError}.
 *
 * @param input - Optional problem details fields (`detail`, `type`, `instance`, `extensions`).
 * @returns A `501`-status {@link ProblemDetailsError} ready to `throw`.
 */
export function notImplemented(input?: HttpErrorInput): ProblemDetailsError {
  return problemDetails({ ...input, status: 501 });
}

/**
 * Create a `503 Service Unavailable` {@link ProblemDetailsError}.
 *
 * @param input - Optional problem details fields (`detail`, `type`, `instance`, `extensions`).
 * @returns A `503`-status {@link ProblemDetailsError} ready to `throw`.
 */
export function serviceUnavailable(input?: HttpErrorInput): ProblemDetailsError {
  return problemDetails({ ...input, status: 503 });
}
