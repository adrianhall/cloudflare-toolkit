/**
 * @file Shared types for the auth-internal module: the developer-JWT payload shape, path
 * policies, and policy-match results used by `jwt.ts`/`policy.ts`.
 *
 * This module has no public barrel export — it is consumed only via relative imports from
 * `hono/` and `vite/`.
 */

/**
 * Subset of the Cloudflare Access JWT payload that `signDevJwt` (`./jwt.js`) cares about when
 * constructing a developer-signed token.
 *
 * @internal
 */
export interface AccessJwtPayload {
  /** User email. */
  email: string;
  /** Subject (unique user identifier). */
  sub: string;
  /** Issuer URL. */
  iss: string;
  /** Audience (application audience tag). */
  aud?: string | string[];
  /** Issued-at timestamp. */
  iat: number;
  /** Expiry timestamp. */
  exp: number;
  /**
   * Token type. Cloudflare Access sets this to `"app"`. The developer-signed path sets it to
   * `"dev"` so that a consuming middleware can choose the correct verification strategy.
   */
  type?: string;
}

/**
 * A single path-matching rule used to decide whether a request requires authentication.
 *
 * Policies are evaluated in order; the **first match wins**.
 */
export interface PathPolicy {
  /** Regular expression tested against the request pathname. */
  pattern: RegExp;
  /**
   * `true`  - the matching path requires authentication.
   * `false` - the matching path is public / anonymous.
   */
  authenticate: boolean;
  /**
   * Controls the response when an unauthenticated request hits this path in a consuming
   * dev-emulation layer (e.g. `cloudflareAccessPlugin`):
   *
   * - `true` *(default)* — redirect to a login form. Appropriate for page routes where the
   *   browser should navigate to a login UI.
   * - `false` — return 401 instead of redirecting. Appropriate for API routes.
   *
   * Only meaningful when `authenticate` is `true`.
   */
  redirect?: boolean;
}

/**
 * Result of evaluating a request pathname against a {@link PathPolicy} array via `matchPolicy`
 * (`./policy.js`).
 */
export interface PolicyMatch {
  /** Whether the matching policy requires authentication. */
  authenticate: boolean;
  /**
   * Whether a consuming dev-emulation layer should redirect (`true`) or return 401 (`false`) for
   * unauthenticated requests. Defaults to `true` when the original {@link PathPolicy} did not
   * specify a value.
   */
  redirect: boolean;
}
