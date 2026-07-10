// Problem Details barrel — vendored/ported from adrianhall/hono-problem-details (MIT), a fork of
// paveg/hono-problem-details (MIT) — see THIRD-PARTY-NOTICES.md.
//
// Hono-free by design (docs/SPECv2.md §5.4): nothing under this subpath imports `hono`. Only the
// core RFC 9457 primitives are exported here — the Hono-wired `problemDetailsErrorHandler` is a
// direct re-export from `@adrianhall/cloudflare-toolkit/hono` (a separate subpath/issue), and the
// `zod`/`valibot`/`openapi`/`standard-schema`/`opentelemetry` integrations are not ported at all.
export { ProblemDetailsError } from "./error.js";
export { problemDetails } from "./factory.js";
export { createProblemTypeRegistry } from "./registry.js";
export { statusToPhrase, statusToSlug } from "./status.js";
export type { ProblemDetails, ProblemDetailsInput } from "./types.js";
