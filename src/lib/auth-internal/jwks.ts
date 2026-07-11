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
 * Upper bound on {@link jwksCache}'s size. `teamDomain` is normally static per-deployment
 * config (one, or a handful, of distinct values for the lifetime of a Worker), but nothing
 * prevents a caller from passing a dynamically-sourced value; capping the cache avoids unbounded
 * memory growth in that case. Eviction is FIFO (oldest-inserted entry first, via `Map`'s
 * insertion-order iteration) rather than true LRU — proportionate to how rarely this cache is
 * expected to near its limit at all.
 */
export const MAX_JWKS_CACHE_ENTRIES = 20;

/**
 * Pattern a Cloudflare Access team-domain hostname must match: a single DNS label followed by
 * the literal `cloudflareaccess.com` suffix (e.g. `"my-team.cloudflareaccess.com"`). Matched
 * against `URL.hostname`, which the WHATWG URL parser always normalizes to ASCII-lowercase and
 * which already resolves away userinfo (`user@host`) and path-based host-spoofing tricks, so
 * this single check is sufficient to reject a `teamDomain` that does not genuinely point at
 * Cloudflare Access's own certs host.
 */
const TEAM_DOMAIN_HOST_PATTERN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;

/** Matches a leading URI scheme (e.g. `"http://"`, `"ftp://"`), case-insensitively. */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

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
 * @throws {Error} If `teamDomain` has an explicit non-`https://` scheme (see {@link ensureHttps}),
 *   or if the resulting hostname is not a `*.cloudflareaccess.com` team domain — closing off both
 *   the malformed-URL footgun and the SSRF/JWKS-poisoning surface of a dynamically-sourced
 *   `teamDomain` pointing somewhere unexpected.
 */
export function getRemoteJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  // Normalise: strip trailing slash, ensure https prefix.
  const base = teamDomain.replace(/\/+$/, "");
  const url = ensureHttps(base);
  const certsUrl = new URL(`${url}/cdn-cgi/access/certs`);

  if (!TEAM_DOMAIN_HOST_PATTERN.test(certsUrl.hostname)) {
    throw new Error(`Invalid Cloudflare Access team domain: "${teamDomain}"`);
  }

  let jwks = jwksCache.get(certsUrl.href);
  if (!jwks) {
    if (jwksCache.size >= MAX_JWKS_CACHE_ENTRIES) {
      // `Map` iterates keys in insertion order, so the first key yielded here is the oldest
      // entry. `size >= MAX_JWKS_CACHE_ENTRIES` (checked above) with `MAX_JWKS_CACHE_ENTRIES`
      // fixed at a positive constant guarantees the cache is non-empty, so this loop always runs
      // at least once — no "keys() was empty" branch to guard against.
      for (const oldestKey of jwksCache.keys()) {
        jwksCache.delete(oldestKey);
        break;
      }
    }
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
 *   prepended, but only when `url` has no scheme of its own.
 * @throws {Error} If `url` already has an explicit scheme other than `https://` (e.g.
 *   `"http://..."`, `"ftp://..."`) — such input previously became a malformed URL
 *   (`"https://http://..."`) rather than being upgraded or rejected. Erroring here surfaces the
 *   misconfiguration instead of silently constructing a broken (and, for a userinfo-style value,
 *   potentially misleading) JWKS URL.
 */
export function ensureHttps(url: string): string {
  if (url.startsWith("https://")) {
    return url;
  }
  if (SCHEME_PATTERN.test(url)) {
    throw new Error(`Expected an https:// URL, got: "${url}"`);
  }
  return "https://" + url;
}
