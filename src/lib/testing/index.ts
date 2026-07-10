// Testing helpers barrel (docs/SPECv2.md §5.1, §5.9, issue #15). Ported from
// adrianhall/cloudflare-auth's `src/testing.ts` (same author, MIT — see docs/SPECv2.md §10;
// source repo is read-only and not modified by this port), unchanged: a thin, deliberately
// minimal re-export over this toolkit's own `auth-internal` module (#12) rather than a
// toolkit-authored wrapper — `signDevJwt`/`buildCookieHeader`/`clearCookieHeader` already
// produce exactly the token/cookie shapes `cloudflareAccess`'s dev-token bypass
// (../hono/cloudflare-access.ts, #13) expects, so there is nothing to add here beyond a stable,
// public name for consumers writing Vitest/Playwright tests against Access-protected routes.
//
// Deliberately NOT re-exported from the root barrel (docs/SPECv2.md §5.1) — see src/index.ts —
// and deliberately does NOT re-export the rest of `auth-internal`'s surface
// (`verifyDevJwt`/`verifyAccessJwt`/`parseCookie`/`matchPolicy`/`DEFAULT_DEV_SECRET`/etc.): those
// are verification/policy internals that a test author signing a token has no need to call
// directly, matching upstream's own testing.ts export list exactly.
//
// @example
// ```ts
// import { signDevJwt, JWT_HEADER } from "@adrianhall/cloudflare-toolkit/testing";
//
// const token = await signDevJwt("alice@example.com");
// const res = await app.fetch(
//   new Request("http://localhost/api/me", { headers: { [JWT_HEADER]: token } }),
//   env
// );
// ```
export {
  signDevJwt,
  buildCookieHeader,
  clearCookieHeader,
  JWT_HEADER,
  COOKIE_NAME
} from "../auth-internal/jwt.js";
