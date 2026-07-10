// Hono context-variable types (docs/SPECv2.md §5.5 "Hono Bindings Helpers", §5.9). Only
// `LoggerVariables` is defined here for now — `AuthVariables`/`CloudflareToolkitVariables` land
// with the `cloudflareAccess` issue, since a single merged type would incorrectly claim a
// variable is always set when the corresponding middleware might not be wired at all
// (docs/SPECv2.md §5.5).
import type { Logger } from "../logging/types.js";

/**
 * Context variables set by {@link cloudflareLogger}. Intersect this with your own `Variables`
 * when typing your `Hono` instance so that `c.get("LOGGER")`/`c.var.LOGGER` is statically known:
 *
 * ```ts
 * interface AppVariables extends LoggerVariables {
 *   // Custom variables go here
 * }
 *
 * type AppContext = { Bindings: Env; Variables: AppVariables };
 * ```
 *
 * Matches the exact name already used by `cloudflare-logger` today (docs/SPECv2.md §5.5).
 */
export interface LoggerVariables {
  /** The request-scoped `Logger` set by `cloudflareLogger`. */
  LOGGER: Logger;
}
