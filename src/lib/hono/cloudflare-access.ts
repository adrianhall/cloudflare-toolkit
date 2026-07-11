/**
 * @file `cloudflareAccess` — Hono middleware that validates a Cloudflare Access JWT (from the
 * `CF_Authorization` cookie or the `Cf-Access-Jwt-Assertion` header) and populates
 * `AuthVariables` (`userEmail`, `userSub`, ./types.ts) on the Hono context for downstream
 * handlers.
 *
 * Built on this toolkit's own `auth-internal` module for the shared JWT/JWKS/policy primitives
 * (`matchPolicy`, `verifyDevJwt`, `verifyAccessJwt`, `parseCookie`, `JWT_HEADER`,
 * `DEFAULT_DEV_SECRET`). The `logger` option accepts this toolkit's own `Logger`
 * (`../logging/types.js`) — the same contract `cloudflareLogger` (./logger-middleware.ts) uses —
 * and defaults to a silent logger (`createSilentTransport`) when omitted.
 */
import type { Context, MiddlewareHandler } from "hono";
import {
  DEFAULT_DEV_SECRET,
  JWT_HEADER,
  parseCookie,
  verifyAccessJwt,
  verifyDevJwt,
  type VerifiedToken
} from "../auth-internal/jwt.js";
import { matchPolicy } from "../auth-internal/policy.js";
import type { PathPolicy } from "../auth-internal/types.js";
import { createLogger } from "../logging/logger.js";
import { createSilentTransport } from "../logging/transports/silent.js";
import type { Logger } from "../logging/types.js";
import type { AuthVariables } from "./types.js";

/**
 * Worker binding read by {@link cloudflareAccess} when `options.teamDomain` is not supplied.
 */
interface TeamDomainBindings {
  /** Cloudflare Access team domain used to fetch the public JWKS. */
  readonly CLOUDFLARE_TEAM_DOMAIN?: string;
}

/**
 * Options for {@link cloudflareAccess}.
 */
export interface CloudflareAccessOptions {
  /**
   * Path policies evaluated in order (first match wins).
   *
   * - `authenticate: false` — bypass JWT validation entirely.
   * - `authenticate: true` — require a valid JWT (401 if missing/invalid).
   * - No matching policy — behavior is controlled by
   *   {@link CloudflareAccessOptions.defaultAction}.
   *
   * When omitted, every path is subject to {@link CloudflareAccessOptions.defaultAction}.
   *
   * @example
   * ```ts
   * policies: [
   *   { pattern: /^\/api\/version$/, authenticate: false },
   *   { pattern: /^\/api\//, authenticate: true }
   * ]
   * ```
   */
  readonly policies?: PathPolicy[];
  /**
   * What to do when the request path does not match any policy.
   *
   * - `"block"` *(default)* — return 401 if no valid JWT is present.
   * - `"bypass"` — allow the request through without authentication. If a valid JWT is present
   *   it is still verified and `AuthVariables` are still set; otherwise the request continues
   *   with no authenticated user.
   */
  readonly defaultAction?: "block" | "bypass";
  /**
   * Cloudflare Access team domain used to fetch the public JWKS. When omitted, the middleware
   * reads `c.env.CLOUDFLARE_TEAM_DOMAIN` at request time.
   */
  readonly teamDomain?: string;
  /**
   * Application Audience Tag. When provided, the middleware verifies the JWT `aud` claim
   * contains this value. When omitted, audience validation is skipped.
   */
  readonly audience?: string;
  /**
   * Enable HS256 developer-token verification.
   *
   * **Default `false` (fail-closed).** When `false`, {@link cloudflareAccess} verifies the JWT
   * **only** against the Cloudflare Access JWKS — a developer-signed HS256 token (including one
   * signed with the public `DEFAULT_DEV_SECRET`) is rejected. This prevents a deployed Worker
   * from silently trusting forgeable dev tokens.
   *
   * Enable it only in local development, gated on a build-time signal that is statically
   * `false` in production:
   *
   * ```ts
   * app.use(cloudflareAccess({ policies, enableDevTokens: import.meta.env.DEV }));
   * ```
   *
   * When enabled without an explicit {@link CloudflareAccessOptions.devSecret}, the middleware
   * logs a one-time warning that it is verifying with the public default secret.
   */
  readonly enableDevTokens?: boolean;
  /**
   * HMAC secret for validating developer-generated JWTs. Ignored unless
   * {@link CloudflareAccessOptions.enableDevTokens} is `true`. When dev tokens are enabled and
   * this is omitted, the well-known `DEFAULT_DEV_SECRET` is used and a one-time warning is
   * logged — never rely on that for production security.
   */
  readonly devSecret?: string;
  /**
   * Structured logger used for debug/info/warn/error diagnostics. Defaults to a silent logger
   * (nothing is emitted) when omitted.
   */
  readonly logger?: Logger;
}

/** Silent fallback used when `options.logger` is not supplied. */
function createDefaultLogger(): Logger {
  return createLogger({ transport: createSilentTransport() });
}

/**
 * Attempt to verify a JWT.
 *
 * When `enableDevTokens` is `true`, the dev (HS256) secret is tried first as a fast in-process
 * path; otherwise that path is skipped entirely and only Cloudflare Access JWKS verification
 * runs — the fail-closed default.
 *
 * Returns the verified claims or `null`.
 */
async function verifyToken(
  c: Context,
  token: string,
  options: {
    enableDevTokens: boolean;
    devSecret: string;
    audience: string | undefined;
    teamDomainOverride: string | undefined;
    logger: Logger;
  }
): Promise<VerifiedToken | null> {
  // Fast path: dev-signed token. Opt-in only — disabled by default so a deployed Worker never
  // trusts a forgeable HS256 token.
  if (options.enableDevTokens) {
    const devResult = await verifyDevJwt(token, options.devSecret);
    if (devResult) return devResult;
  }

  // Slow path: Cloudflare Access JWKS.
  const bindings = c.env as TeamDomainBindings | undefined;
  const teamDomain = options.teamDomainOverride ?? bindings?.CLOUDFLARE_TEAM_DOMAIN;

  if (!teamDomain) {
    options.logger.error(
      "No team domain configured - set CLOUDFLARE_TEAM_DOMAIN in env or pass teamDomain in options"
    );
    return null;
  }

  return verifyAccessJwt(token, teamDomain, options.audience);
}

/**
 * Create a Hono middleware that validates a Cloudflare Access JWT and sets `AuthVariables`
 * (`userEmail`, `userSub`, ./types.ts) on the Hono context.
 *
 * **Policy evaluation**:
 *
 * | Policy match           | Behavior                                    |
 * | ----------------------- | -------------------------------------------- |
 * | `authenticate: false`  | Bypass — skip JWT validation entirely.       |
 * | `authenticate: true`   | Require — valid JWT or 401.                  |
 * | No matching policy      | Controlled by `defaultAction` (see below).   |
 *
 * **`defaultAction`** (applies when no policy matches):
 *
 * - `"block"` *(default)* — return 401 if no valid JWT is present.
 * - `"bypass"` — allow the request through. If a JWT *is* present and valid, the context
 *   variables are still set; otherwise the request continues with no authenticated user.
 *
 * **Verification order** (when JWT validation is performed):
 *
 * 1. *(Opt-in)* When `enableDevTokens` is `true`, try HMAC verification with the dev secret
 *    (fast, in-process).
 * 2. Verify against the remote JWKS endpoint for the team domain.
 *
 * Developer-token verification is **fail-closed**: it is disabled by default so a deployed
 * Worker never silently trusts a forgeable HS256 token signed with the public
 * `DEFAULT_DEV_SECRET`. Enable it only in local development.
 *
 * @remarks Security-critical: this fail-closed default must be preserved exactly — see the
 * "fail-closed" describe block in `test/workers/hono/cloudflare-access.test.ts`.
 * @param options - Options controlling path policies, the default action for unmatched paths,
 * the Cloudflare Access team domain/audience, dev-token verification, and the logger.
 * @returns A Hono `MiddlewareHandler` parameterised with {@link AuthVariables}, so
 * `c.set("userEmail", …)`/`c.set("userSub", …)` inside this middleware — and `c.get("userEmail")`/
 * `c.get("userSub")` in a consumer's own handlers once composed via `app.use(...)` — are
 * statically checked against {@link AuthVariables} rather than accepted as untyped magic strings.
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { cloudflareAccess, type AuthVariables } from "@adrianhall/cloudflare-toolkit/hono";
 *
 * const app = new Hono<{ Variables: AuthVariables }>();
 * app.use(cloudflareAccess({ policies: [{ pattern: /^\/api\/version$/, authenticate: false }] }));
 * app.get("/api/*", (c) => c.json({ user: c.get("userEmail") }));
 * ```
 */
export function cloudflareAccess(
  options: CloudflareAccessOptions = {}
): MiddlewareHandler<{ Variables: AuthVariables }> {
  const policies = options.policies;
  const defaultAction = options.defaultAction ?? "block";
  const enableDevTokens = options.enableDevTokens ?? false;
  const devSecretProvided = typeof options.devSecret === "string";
  const devSecret = options.devSecret ?? DEFAULT_DEV_SECRET;
  const audience = options.audience;
  const teamDomainOverride = options.teamDomain;
  const log = options.logger ?? createDefaultLogger();

  // Loud, one-time warning: dev-token verification is on but no explicit secret was supplied, so
  // the public DEFAULT_DEV_SECRET is in use. This is only safe on localhost — never in a
  // deployed Worker.
  if (enableDevTokens && !devSecretProvided) {
    log.warn(
      "enableDevTokens is true but no devSecret was provided; verifying HS256 dev tokens "
        + "with the public DEFAULT_DEV_SECRET. This is only safe in local development."
    );
  }

  return async (c, next) => {
    const pathname = new URL(c.req.url).pathname;

    // -----------------------------------------------------------------
    // 1. Evaluate path policies.
    // -----------------------------------------------------------------
    const policyMatch = policies ? matchPolicy(pathname, policies) : undefined;

    if (policyMatch?.authenticate === false) {
      // Explicitly public — skip JWT validation entirely.
      log.debug("Path is public - bypassing auth", { pathname });
      return next();
    }

    // Determine whether auth is *required* for this path.
    //   - Explicit `true` from a policy  → required.
    //   - No matching policy + block      → required.
    //   - No matching policy + bypass     → optional (best-effort).
    const authRequired =
      policyMatch?.authenticate === true
      || (policyMatch === undefined && defaultAction === "block");

    // -----------------------------------------------------------------
    // 2. Extract the token.
    // -----------------------------------------------------------------
    const token = c.req.header(JWT_HEADER) ?? parseCookie(c.req.header("cookie"));

    if (!token) {
      if (authRequired) {
        log.warn("No JWT found in header or cookie");
        return c.json({ error: "Authentication required" }, 401);
      }
      // Optional auth — no token, continue without user info.
      log.debug("No JWT - continuing (bypass)", { pathname });
      return next();
    }

    // -----------------------------------------------------------------
    // 3. Verify the token.
    // -----------------------------------------------------------------
    const result = await verifyToken(c, token, {
      enableDevTokens,
      devSecret,
      audience,
      teamDomainOverride,
      logger: log
    });

    if (result) {
      log.debug("Verified token", { email: result.email });
      c.set("userEmail", result.email);
      c.set("userSub", result.sub);
      return next();
    }

    // -----------------------------------------------------------------
    // 4. Verification failed.
    // -----------------------------------------------------------------
    if (authRequired) {
      log.warn("JWT verification failed");
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    // Optional auth — bad token, continue without user info.
    log.info("JWT invalid - continuing (bypass)", { pathname });
    return next();
  };
}
