/**
 * @file `cloudflareAccess` — Hono middleware that validates a Cloudflare Access JWT (from the
 * `CF_Authorization` cookie or the `Cf-Access-Jwt-Assertion` header) and populates
 * `AuthVariables` (`Cloudflare_Access_Identity`, ./types.ts) on the Hono context for downstream
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
import { buildProblemResponse, normalizeProblemDetails } from "../problem-details/utils.js";
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
   * Each policy may also set its own `audience` — see {@link PathPolicy.audience} — so a single
   * middleware instance can protect several path-scoped Cloudflare Access applications on the
   * same hostname, each validated against its own Audience Tag, instead of one flat allowlist
   * shared by every protected path.
   *
   * @example
   * ```ts
   * policies: [
   *   { pattern: /^\/api\/version$/, authenticate: false },
   *   { pattern: /^\/api\/contributor/, authenticate: true, audience: contributorAud },
   *   { pattern: /^\/api\/reviewer/, authenticate: true, audience: reviewerAud },
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
   *   it is still verified and `AuthVariables` is still set; otherwise the request continues
   *   with no authenticated user.
   */
  readonly defaultAction?: "block" | "bypass";
  /**
   * Cloudflare Access team domain used to fetch the public JWKS. When omitted, the middleware
   * reads `c.env.CLOUDFLARE_TEAM_DOMAIN` at request time.
   */
  readonly teamDomain?: string;
  /**
   * Fallback Application Audience Tag. Used to verify the JWT `aud` claim for a request whose
   * matched {@link PathPolicy} does not itself specify an `audience` (including when no policy
   * matches at all and {@link CloudflareAccessOptions.defaultAction} is `"block"`).
   *
   * A matched policy's own `audience` (see {@link PathPolicy.audience}) **overrides** this
   * fallback for that request rather than merging with it — this lets path-specific audiences
   * coexist with one shared fallback for everything else.
   *
   * **When neither this fallback nor the matched policy specify an audience, audience
   * validation is skipped for that request** — the `aud` claim is not checked at all. Every
   * Cloudflare Access application in the same team shares the same JWKS, so without an `aud`
   * check, a JWT that is valid for *any other Access application in the team* is accepted here
   * too (cross-application token replay).
   *
   * Unless {@link CloudflareAccessOptions.enableDevTokens} is `true` (local development), any
   * authenticated request path that could reach verification without an audience configured —
   * either this fallback or a per-policy `audience` — logs a one-time warning at construction
   * time; see {@link cloudflareAccess}'s security remarks.
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
 * Build a `401 Unauthorized` RFC 9457 `application/problem+json` response, matching the shape
 * `problemDetailsErrorHandler` (`./error-handler.js`) and `notFoundHandler` (`./not-found-handler.js`)
 * produce. Built directly via `../problem-details/utils.js` rather than by throwing
 * `unauthorized()` (`@adrianhall/cloudflare-toolkit/errors`), so `cloudflareAccess` returns the
 * correct shape even when a consumer hasn't wired `app.onError(problemDetailsErrorHandler())` —
 * every piece of `/hono` middleware is wired independently (no combined/coordinator middleware).
 *
 * @param detail - Human-readable explanation for this specific 401 occurrence.
 * @returns The resulting `Response`.
 */
function unauthorizedResponse(detail: string): Response {
  return buildProblemResponse(normalizeProblemDetails({ status: 401, detail }));
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
  // trusts a forgeable HS256 token. The same resolved `audience` (matched policy override, or
  // the top-level fallback) is enforced here too, so a dev session minted for one path-scoped
  // Access application is rejected on another's routes exactly like the real JWKS path below.
  if (options.enableDevTokens) {
    const devResult = await verifyDevJwt(token, options.devSecret, options.audience);
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

  return verifyAccessJwt(token, teamDomain, options.audience, options.logger);
}

/**
 * Determine whether some authenticated request path governed by `options` could reach JWT
 * verification with no audience configured at all — i.e. neither a per-policy
 * {@link PathPolicy.audience} nor the top-level {@link CloudflareAccessOptions.audience}
 * fallback — the SEC-001 gap {@link cloudflareAccess} warns about at construction time.
 *
 * A fully audience-covered configuration (every `authenticate: true` policy sets its own
 * `audience`, with `defaultAction: "bypass"` for anything unmatched) has **no** gap and is not
 * warned about, even though the top-level fallback itself is omitted. Conversely, an unmatched
 * path is always a gap when `defaultAction` is `"block"` (the default) and no fallback audience
 * is configured, since that unmatched path still requires authentication with nothing to
 * validate `aud` against — regardless of how completely the *listed* policies cover their own
 * audiences.
 *
 * @param policies - The configured path policies, if any.
 * @param defaultAction - The configured default action for a request matching no policy.
 * @param audience - The configured top-level fallback audience, if any.
 * @returns `true` when at least one authenticated request path could skip audience validation.
 */
function hasAudienceGap(
  policies: PathPolicy[] | undefined,
  defaultAction: "block" | "bypass",
  audience: string | undefined
): boolean {
  if (audience !== undefined) {
    // The fallback covers every policy that doesn't set its own audience, and every unmatched
    // path when defaultAction is "block" — no gap possible.
    return false;
  }

  const unmatchedPathIsAGap = defaultAction === "block";
  if (!policies) {
    return unmatchedPathIsAGap;
  }

  const hasUncoveredPolicy = policies.some(
    (policy) => policy.authenticate && policy.audience === undefined
  );
  return hasUncoveredPolicy || unmatchedPathIsAGap;
}

/**
 * Create a Hono middleware that validates a Cloudflare Access JWT and sets `AuthVariables`
 * (`Cloudflare_Access_Identity`, ./types.ts) on the Hono context.
 *
 * **Policy evaluation**:
 *
 * | Policy match           | Behavior                                    |
 * | ----------------------- | -------------------------------------------- |
 * | `authenticate: false`  | Bypass — skip JWT validation entirely.       |
 * | `authenticate: true`   | Require — valid JWT or 401.                  |
 * | No matching policy      | Controlled by `defaultAction` (see below).   |
 *
 * Every `401` this middleware returns is an RFC 9457 `application/problem+json` response
 * (`{ type, status, title, detail }`), matching `problemDetailsErrorHandler` and
 * `notFoundHandler`'s conventions.
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
 * **Path-specific audiences**: a matched {@link PathPolicy}'s own `audience` overrides
 * {@link CloudflareAccessOptions.audience} for that request, so one middleware instance can
 * protect several path-scoped Cloudflare Access applications on the same hostname — each
 * validated against its own Audience Tag — instead of one flat allowlist that would let a token
 * minted for one application pass audience validation on another application's routes.
 *
 * **Audience validation is opt-in, not fail-closed**: a request whose matched policy (or the
 * top-level fallback, when no policy applies) has no `audience` configured skips the `aud`
 * check for that request and allows cross-application token replay within the same Cloudflare
 * Access team (see {@link CloudflareAccessOptions.audience}'s docs). To surface this without
 * breaking existing deployments, {@link cloudflareAccess} logs a one-time warning at
 * construction time whenever some authenticated request path could still reach verification
 * with no audience configured **and** `enableDevTokens` is not `true` — i.e. in the default,
 * production-shaped configuration. A fully audience-covered policy set (every authenticated
 * policy sets its own `audience`, and `defaultAction` is `"bypass"`) does not trigger this
 * warning even without a top-level fallback. The warning is intentionally silent when
 * `enableDevTokens` is `true`, since that already signals a local-development posture.
 *
 * @remarks Security-critical: this fail-closed default must be preserved exactly — see the
 * "fail-closed" describe block in `test/workers/hono/cloudflare-access.test.ts`.
 * @param options - Options controlling path policies, the default action for unmatched paths,
 * the Cloudflare Access team domain/audience, dev-token verification, and the logger.
 * @returns A Hono `MiddlewareHandler` parameterised with {@link AuthVariables}, so
 * `c.set("Cloudflare_Access_Identity", …)` inside this middleware — and
 * `c.get("Cloudflare_Access_Identity")` in a consumer's own handlers once composed via
 * `app.use(...)` — are
 * statically checked against {@link AuthVariables} rather than accepted as untyped magic strings.
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { cloudflareAccess, type AuthVariables } from "@adrianhall/cloudflare-toolkit/hono";
 *
 * const app = new Hono<{ Variables: AuthVariables }>();
 * app.use(cloudflareAccess({ policies: [{ pattern: /^\/api\/version$/, authenticate: false }] }));
 * app.get("/api/*", (c) => c.json({ user: c.get("Cloudflare_Access_Identity") }));
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

  // Loud, one-time warning: some authenticated request path could reach verification with no
  // audience configured at all (neither a per-policy override nor the top-level fallback), so
  // the JWT `aud` claim is never checked for it — any token valid for another Access application
  // in the same team is accepted there too (cross-application token replay). Silent when
  // enableDevTokens is true, since that already signals a local-development posture where this
  // gap is a non-issue.
  if (!enableDevTokens && hasAudienceGap(policies, defaultAction, audience)) {
    log.warn(
      "No audience was provided for one or more authenticated paths; the JWT 'aud' claim will "
        + "not be validated for those requests. Any Cloudflare Access application in the same "
        + "team can mint a token accepted here (cross-application token replay). Set the "
        + "top-level 'audience' option as a fallback, set 'audience' on each authenticated "
        + "PathPolicy, or set enableDevTokens to silence this warning in local development."
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
    const headerToken = c.req.header(JWT_HEADER);
    const source = headerToken === undefined ? "cookie" : "header";
    const token = headerToken ?? parseCookie(c.req.header("cookie"));

    if (!token) {
      if (authRequired) {
        log.warn("No JWT found in header or cookie");
        return unauthorizedResponse("Authentication required");
      }
      // Optional auth — no token, continue without user info.
      log.debug("No JWT - continuing (bypass)", { pathname });
      return next();
    }

    // -----------------------------------------------------------------
    // 3. Verify the token.
    // -----------------------------------------------------------------
    // A matched policy's own audience overrides the top-level fallback for this request; when
    // neither is set, `resolvedAudience` is `undefined` and `aud` is not checked (see the
    // security remarks on `CloudflareAccessOptions.audience` above).
    const resolvedAudience = policyMatch?.audience ?? audience;
    const result = await verifyToken(c, token, {
      enableDevTokens,
      devSecret,
      audience: resolvedAudience,
      teamDomainOverride,
      logger: log
    });

    if (result) {
      log.debug("Verified token", { email: result.email });
      c.set("Cloudflare_Access_Identity", { source, email: result.email, sub: result.sub });
      return next();
    }

    // -----------------------------------------------------------------
    // 4. Verification failed.
    // -----------------------------------------------------------------
    if (authRequired) {
      log.warn("JWT verification failed");
      return unauthorizedResponse("Invalid or expired token");
    }

    // Optional auth — bad token, continue without user info.
    log.info("JWT invalid - continuing (bypass)", { pathname });
    return next();
  };
}
