/**
 * @file Hono context-variable types.
 *
 * `AuthVariables`/`LoggerVariables` are kept as two separate, independently composable
 * interfaces rather than one merged type, because either middleware may or may not be wired at
 * all in a given app; a single unconditional type would claim a variable is always set when it
 * might not be. `CloudflareToolkitVariables` is provided as a convenience alias for the common
 * case of using both together.
 */
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
 */
export interface LoggerVariables {
  /** The request-scoped `Logger` set by `cloudflareLogger`. */
  LOGGER: Logger;
}

/**
 * Context variables set by {@link cloudflareAccess} on a successfully authenticated request.
 * Intersect this with your own `Variables` when typing your `Hono` instance so that
 * `c.get("userEmail")`/`c.get("userSub")` are statically known:
 *
 * ```ts
 * interface AppVariables extends AuthVariables {
 *   // Custom variables go here
 * }
 *
 * type AppContext = { Bindings: Env; Variables: AppVariables };
 * ```
 */
export interface AuthVariables {
  /** Authenticated user's email address (from the JWT `email` claim). */
  userEmail: string;
  /** Authenticated user's unique identifier (from the JWT `sub` claim). */
  userSub: string;
}

/**
 * Convenience alias for the common case of using {@link cloudflareAccess} and
 * {@link cloudflareLogger} together:
 *
 * ```ts
 * interface AppVariables extends CloudflareToolkitVariables {
 *   // Custom variables go here
 * }
 * ```
 *
 * Exactly equal to `AuthVariables & LoggerVariables` — {@link AuthVariables} and
 * {@link LoggerVariables} remain separate, independently composable types; this alias does not
 * replace using either on its own.
 */
export type CloudflareToolkitVariables = AuthVariables & LoggerVariables;
