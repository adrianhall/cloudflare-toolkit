/**
 * @file Public entry point for the `testing` subpath: helpers for signing developer tokens and
 * building the cookie/header values `cloudflareAccess`'s dev-token bypass expects, for use in
 * Vitest/Playwright tests against Access-protected routes.
 *
 * Not re-exported from the root barrel (see `src/index.ts`). Does not re-export the rest of
 * `auth-internal`'s surface (`verifyDevJwt`/`verifyAccessJwt`/`parseCookie`/`matchPolicy`/
 * `DEFAULT_DEV_SECRET`/etc.) — those are verification/policy internals a test author signing a
 * token has no need to call directly.
 *
 * @example
 * ```ts
 * import { signDevJwt, JWT_HEADER } from "@adrianhall/cloudflare-toolkit/testing";
 *
 * const token = await signDevJwt("alice@example.com");
 * const res = await app.fetch(
 *   new Request("http://localhost/api/me", { headers: { [JWT_HEADER]: token } }),
 *   env
 * );
 * ```
 */
export {
  signDevJwt,
  buildCookieHeader,
  clearCookieHeader,
  JWT_HEADER,
  COOKIE_NAME
} from "../auth-internal/jwt.js";
