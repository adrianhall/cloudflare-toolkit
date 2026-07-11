/**
 * @file JWT helpers for the Cloudflare Access authentication internals: signing and verifying
 * developer tokens, verifying real Cloudflare Access tokens, and reading/writing the
 * authorization cookie.
 *
 * Uses `jose` v6 for all cryptographic operations and only Web-standard APIs
 * (`crypto.randomUUID`, `TextEncoder`) otherwise, so this module is both Worker-safe (for
 * `hono/cloudflare-access.ts`) and Node-safe (for `vite/plugin.ts`).
 */
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import type { JWTPayload } from "jose";
import type { AccessJwtPayload } from "./types.js";
import { getRemoteJwks, normalizeTeamDomain } from "./jwks.js";
import type { Logger } from "../logging/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Well-known HMAC secret used by default for signing and verifying developer-generated JWTs.
 *
 * **This is NOT a real secret.** It only protects the local-dev login flow running on
 * `localhost` and must never be relied on for production security.
 */
export const DEFAULT_DEV_SECRET = "cloudflare-access-dev-secret-do-not-use-in-production";

/** Algorithm used for developer-signed JWTs. */
const DEV_ALG = "HS256";

/** Name of the cookie that stores the JWT. */
export const COOKIE_NAME = "CF_Authorization";

/** Header containing the JWT (set by Cloudflare Access). */
export const JWT_HEADER = "cf-access-jwt-assertion";

/** Header containing the authenticated user's email. */
export const EMAIL_HEADER = "cf-access-authenticated-user-email";

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/** Encode a string secret into a `CryptoKey`-compatible `Uint8Array`. */
function secretToBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Sign (developer mode only)
// ---------------------------------------------------------------------------

/**
 * Generate a subject identifier for a developer-signed JWT.
 *
 * Returns a random UUID so that the `sub` claim matches the shape of a real Cloudflare Access
 * subject (a UUID) and satisfies strict downstream validators (e.g. `[A-Za-z0-9-]`). Real
 * Access subjects are stable per-user; dev subjects are stable for the life of an issued token
 * (and can be pinned via the `sub` option).
 */
function generateDevSub(): string {
  return crypto.randomUUID();
}

/**
 * Create a signed JWT that mimics a Cloudflare Access token.
 *
 * The `type` claim is set to `"dev"` so that the verification layer can distinguish
 * locally-issued tokens from real Access tokens.
 *
 * @param email - The user's email address (becomes the `email` claim).
 * @param options - Optional overrides.
 * @param options.secret - HMAC signing secret (default {@link DEFAULT_DEV_SECRET}).
 * @param options.lifetime - Token lifetime in seconds (default `86400` / 24 h).
 * @param options.sub - Subject claim. When provided it is used **verbatim**; when omitted a
 *   random UUID is generated (matching the shape of a real Cloudflare Access `sub`) instead of
 *   an email-derived value.
 */
export async function signDevJwt(
  email: string,
  options: { secret?: string; lifetime?: number; sub?: string } = {}
): Promise<string> {
  const secret = options.secret ?? DEFAULT_DEV_SECRET;
  const lifetime = options.lifetime ?? 86_400; // 24 h

  const now = Math.floor(Date.now() / 1000);
  const sub = options.sub ?? generateDevSub();

  return new SignJWT({
    email,
    sub,
    type: "dev",
    iss: "dev-authentication"
  } satisfies Omit<AccessJwtPayload, "iat" | "exp">)
    .setProtectedHeader({ alg: DEV_ALG })
    .setIssuedAt(now)
    .setExpirationTime(now + lifetime)
    .sign(secretToBytes(secret));
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/** Result of a successful JWT verification. */
export interface VerifiedToken {
  /** Authenticated user's email address (from the JWT `email` claim). */
  email: string;
  /** Authenticated user's unique identifier (from the JWT `sub` claim). */
  sub: string;
}

/**
 * Attempt to verify a JWT as a developer-signed token.
 *
 * Returns `null` if verification fails (wrong key, expired, missing claims, etc.) — the caller
 * can then fall back to Cloudflare JWKS verification.
 */
export async function verifyDevJwt(
  token: string,
  secret: string = DEFAULT_DEV_SECRET
): Promise<VerifiedToken | null> {
  try {
    const { payload } = await jwtVerify(token, secretToBytes(secret), {
      algorithms: [DEV_ALG]
    });
    return extractClaims(payload);
  } catch {
    return null;
  }
}

/**
 * `jose` error classes that only occur once a JWKS was successfully fetched and a real
 * cryptographic/claims verification attempt against the token was made — i.e. the token itself
 * is what failed, not the JWKS transport.
 *
 * `JWKSNoMatchingKey` is included because `createRemoteJWKSet` already retries a JWKS reload
 * once (subject to a cooldown) before finally throwing it — a final throw means the token's
 * `kid` genuinely doesn't match even after a fresh key fetch, not merely a stale local cache.
 */
const TOKEN_VALIDATION_ERRORS = [
  joseErrors.JWSSignatureVerificationFailed,
  joseErrors.JWTExpired,
  joseErrors.JWTClaimValidationFailed,
  joseErrors.JOSEAlgNotAllowed,
  joseErrors.JWTInvalid,
  joseErrors.JWSInvalid,
  joseErrors.JWKSNoMatchingKey
] as const;

/**
 * Classify a caught `verifyAccessJwt` failure as `"invalid"` (the token itself failed
 * cryptographic or claims validation) or `"network"` (a JWKS transport/config/infra problem),
 * for the `cause` field attached to the diagnostic log record.
 *
 * Conservatively biased toward `"network"`: only the specific {@link TOKEN_VALIDATION_ERRORS}
 * classes are treated as `"invalid"`. Everything else — plain fetch/DNS errors (not a
 * `JOSEError` at all, since `getRemoteJwks`'s underlying fetch failures propagate unwrapped),
 * `JWKSTimeout`, and JWKS-structure errors such as `JWKSInvalid`/`JWKSMultipleMatchingKeys` — is
 * classified as `"network"`, because misclassifying a real outage as "just an invalid token" is
 * the exact debuggability gap this diagnostic exists to close.
 *
 * @param err - The value caught from the `jwtVerify`/`getRemoteJwks` call.
 * @returns `"invalid"` when `err` is one of {@link TOKEN_VALIDATION_ERRORS}; `"network"`
 *   otherwise.
 */
function classifyVerificationFailure(err: unknown): "network" | "invalid" {
  const isTokenValidationError = TOKEN_VALIDATION_ERRORS.some(
    (ErrorClass) => err instanceof ErrorClass
  );
  return isTokenValidationError ? "invalid" : "network";
}

/**
 * Verify a JWT against Cloudflare Access's remote JWKS endpoint.
 *
 * The `iss` (Issuer) claim is always verified against the normalized `teamDomain` (e.g.
 * `"https://my-team.cloudflareaccess.com"`, via {@link normalizeTeamDomain}) — SEC-003. This is
 * defense-in-depth: the JWKS itself is already team-scoped (fetched from
 * `teamDomain/cdn-cgi/access/certs`), so a token signed by a different team's key would already
 * fail signature verification, but binding `iss` explicitly matches Cloudflare's own published
 * Worker+Access reference implementation and requires the presence of the `iss` claim, so a
 * token without one is rejected too.
 *
 * When `audience` is provided the `aud` claim is also verified. **When `audience` is omitted,
 * `aud` is not checked at all** — because every Cloudflare Access application in an account
 * shares the same team JWKS, this means a token minted for *any other Access application in the
 * same team* is accepted here too (cross-application token replay). Callers that expose this
 * through a public option (e.g. `hono/cloudflare-access.ts`'s `cloudflareAccess`) should warn
 * loudly when a caller omits `audience` outside of a clearly-local-development configuration.
 *
 * A transient JWKS network/infra failure (bad team domain, DNS blip, certs endpoint down) is
 * otherwise indistinguishable from a genuinely invalid token — both fall through to the same
 * `catch` and the same `null` return, and without a `logger` nothing is recorded. When `logger`
 * is provided, the caught error is recorded at `warn` (matching the generic
 * `"JWT verification failed"` warning callers such as `cloudflareAccess` already emit) together
 * with the raw `err` and a best-effort `cause: "network" | "invalid"` classification (see
 * {@link classifyVerificationFailure}), so operators can distinguish an outage from a rejected
 * token without changing the fail-closed `null` return contract.
 *
 * @param token - The compact JWS to verify.
 * @param teamDomain - The Cloudflare Access team domain used to fetch the public JWKS and to
 *   compute the expected `iss` claim value (see {@link normalizeTeamDomain}).
 * @param audience - Application Audience Tag to verify the `aud` claim against. When omitted,
 *   `aud` is not checked at all — see the security remarks above.
 * @param logger - Optional structured logger. When omitted, verification failures are still
 *   returned as `null` but nothing is logged (unchanged prior behavior).
 */
export async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  audience?: string,
  logger?: Logger
): Promise<VerifiedToken | null> {
  try {
    const jwks = getRemoteJwks(teamDomain);
    const { payload } = await jwtVerify(token, jwks, {
      audience: audience ?? undefined,
      issuer: normalizeTeamDomain(teamDomain)
    });
    return extractClaims(payload);
  } catch (err) {
    logger?.warn("Cloudflare Access JWT verification failed", {
      err,
      teamDomain,
      cause: classifyVerificationFailure(err)
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull the required claims out of a verified payload. */
export function extractClaims(payload: JWTPayload): VerifiedToken | null {
  const email = payload.email;
  const sub = payload.sub;

  if (typeof email !== "string" || !email) {
    return null;
  }
  if (typeof sub !== "string" || !sub) {
    return null;
  }

  return { email, sub };
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Build a `Set-Cookie` header value for the authorisation cookie.
 *
 * Mirrors the attributes used by Cloudflare Access: `HttpOnly; Secure; SameSite=Lax; Path=/`
 *
 * For local dev over plain HTTP the `Secure` flag is omitted when the request was made to
 * `localhost` or `127.0.0.1`.
 */
export function buildCookieHeader(token: string, isSecure: boolean): string {
  const parts = [`${COOKIE_NAME}=${token}`, "HttpOnly", "SameSite=Lax", "Path=/"];
  if (isSecure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Build a `Set-Cookie` header that clears the `CF_Authorization` cookie by setting it to an
 * empty value with `Max-Age=0`.
 *
 * Use this when a stale or invalid cookie needs to be removed so the user can re-authenticate.
 */
export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * Parse the value of the `CF_Authorization` cookie from a `Cookie` header string. Returns
 * `undefined` when the cookie is absent.
 */
export function parseCookie(cookieHeader: string | null | undefined): string | undefined {
  if (!cookieHeader) return undefined;

  for (const pair of cookieHeader.split(";")) {
    const [name, ...rest] = pair.split("=");
    if (name.trim() === COOKIE_NAME) {
      return rest.join("=").trim();
    }
  }
  return undefined;
}
