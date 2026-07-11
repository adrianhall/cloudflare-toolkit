/**
 * @file Public entry point for the `hono` subpath: `problemDetailsErrorHandler`,
 * `notFoundHandler`, `cloudflareLogger`, `cloudflareAccess`, and their context-variable types.
 *
 * There is no combined/coordinator middleware exported — each piece is wired independently by
 * the consumer.
 */
export { problemDetailsErrorHandler } from "./error-handler.js";
export type { ProblemDetailsErrorHandlerOptions } from "./error-handler.js";
export { notFoundHandler } from "./not-found-handler.js";
export type { NotFoundHandlerOptions } from "./not-found-handler.js";
export { cloudflareLogger } from "./logger-middleware.js";
export type { CloudflareLoggerOptions } from "./logger-middleware.js";
export { cloudflareAccess } from "./cloudflare-access.js";
export type { CloudflareAccessOptions } from "./cloudflare-access.js";
export type { AuthVariables, CloudflareToolkitVariables, LoggerVariables } from "./types.js";
// `auth-internal` has no public barrel of its own (per its own file comment) — this re-exports
// just the `PathPolicy` type so `CloudflareAccessOptions.policies` has a linkable API Reference
// page, not the rest of that module's surface.
export type { PathPolicy } from "../auth-internal/types.js";
