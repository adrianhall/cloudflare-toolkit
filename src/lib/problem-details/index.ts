/**
 * @file Public entry point for the `problem-details` subpath: the core RFC 9457 primitives
 * (`ProblemDetailsError`, `problemDetails()`, `createProblemTypeRegistry`, `statusToPhrase`,
 * `statusToSlug`, and their types).
 *
 * Hono-free by design — nothing under this subpath imports `hono`. The Hono-wired
 * `problemDetailsErrorHandler` is exported separately from `@adrianhall/cloudflare-toolkit/hono`.
 */
export { ProblemDetailsError } from "./error.js";
export { problemDetails } from "./factory.js";
export { createProblemTypeRegistry } from "./registry.js";
export { statusToPhrase, statusToSlug } from "./status.js";
export type { ProblemDetails, ProblemDetailsInput } from "./types.js";
