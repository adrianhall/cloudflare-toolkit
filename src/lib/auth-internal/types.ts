// Shared types for the auth-internal module (docs/SPECv2.md §5.9, §9). Ported from
// adrianhall/cloudflare-auth's `src/types.ts` (same author, MIT — see docs/SPECv2.md §10; source
// repo is read-only and not modified by this port) — only the slice needed by `jwt.ts`/
// `policy.ts` is carried over. `Logger`, `CloudflareAccessSettings`, and `DeveloperAuthSettings`
// are intentionally NOT ported here: they belong to the `hono/cloudflare-access.ts` (#13) and
// `vite/plugin.ts` (#14) issues that consume this module, not to the module itself.
//
// This module has no public barrel export (docs/SPECv2.md §5.9) — it is consumed only via
// relative imports from `hono/` and `vite/` in later issues.

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
   * dev-emulation layer (e.g. `cloudflareAccessPlugin`, #14):
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
