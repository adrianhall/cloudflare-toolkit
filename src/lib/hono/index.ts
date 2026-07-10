// Hono middleware barrel (docs/SPECv2.md §5.1, §5.5, §5.9). `cloudflareAccess`, `cloudflareLogger`,
// and their `AuthVariables`/`LoggerVariables`/`CloudflareToolkitVariables` types are populated in
// later issues. There is deliberately no combined/coordinator middleware exported — each piece is
// wired independently by the consumer (docs/SPECv2.md §5.5).
export { problemDetailsErrorHandler } from "./error-handler.js";
export type { ProblemDetailsErrorHandlerOptions } from "./error-handler.js";
export { notFoundHandler } from "./not-found-handler.js";
export type { NotFoundHandlerOptions } from "./not-found-handler.js";
