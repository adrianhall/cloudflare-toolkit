// Hono middleware barrel (docs/SPECv2.md §5.1, §5.5, §5.9). There is deliberately no combined/
// coordinator middleware exported — each of the four pieces is wired independently by the
// consumer (docs/SPECv2.md §5.5).
export { problemDetailsErrorHandler } from "./error-handler.js";
export type { ProblemDetailsErrorHandlerOptions } from "./error-handler.js";
export { notFoundHandler } from "./not-found-handler.js";
export type { NotFoundHandlerOptions } from "./not-found-handler.js";
export { cloudflareLogger } from "./logger-middleware.js";
export type { CloudflareLoggerOptions } from "./logger-middleware.js";
export { cloudflareAccess } from "./cloudflare-access.js";
export type { CloudflareAccessOptions } from "./cloudflare-access.js";
export type { AuthVariables, CloudflareToolkitVariables, LoggerVariables } from "./types.js";
