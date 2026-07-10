/**
 * @file Remote JWKS management for Cloudflare Access JWT verification.
 *
 * Only Web-standard APIs (`jose`, `URL`, `Map`) are used, so this module is both Worker-safe
 * (for `hono/`) and Node-safe (for `vite/`). Kept in its own module so tests can mock
 * `getRemoteJwks` and supply a local key set instead of hitting the real Cloudflare Access certs
 * endpoint.
 */
import { createRemoteJWKSet } from "jose";

/** Remote JWKS cache keyed by team-domain URL. */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Return (or create-and-cache) a remote JWKS function for the given Cloudflare Access team
 * domain.
 *
 * @param teamDomain - The Cloudflare Access team domain (e.g. `"my-team.cloudflareaccess.com"`).
 *   A missing `https://` prefix is added automatically, and a trailing slash is stripped, so
 *   `"my-team.cloudflareaccess.com"`, `"my-team.cloudflareaccess.com/"`, and
 *   `"https://my-team.cloudflareaccess.com"` all resolve to the same cache entry.
 * @returns The `jose` remote JWK set function for `${teamDomain}/cdn-cgi/access/certs`, cached
 *   across calls for the same normalized domain.
 */
export function getRemoteJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  // Normalise: strip trailing slash, ensure https prefix.
  const base = teamDomain.replace(/\/+$/, "");
  const url = ensureHttps(base);
  const certsUrl = new URL(`${url}/cdn-cgi/access/certs`);

  let jwks = jwksCache.get(certsUrl.href);
  if (!jwks) {
    jwks = createRemoteJWKSet(certsUrl);
    jwksCache.set(certsUrl.href, jwks);
  }
  return jwks;
}

/**
 * Ensures the base URL for the JWKS endpoint is HTTPS.
 *
 * @param url - The base URL to check.
 * @returns The URL unchanged if it already starts with `https://`; otherwise `https://` is
 *   prepended verbatim (an existing `http://` prefix is not replaced, only prefixed).
 */
export function ensureHttps(url: string): string {
  return url.startsWith("https://") ? url : "https://" + url;
}
