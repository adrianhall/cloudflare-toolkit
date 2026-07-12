import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import {
  signDevJwt,
  verifyDevJwt,
  verifyAccessJwt,
  parseCookie,
  buildCookieHeader,
  clearCookieHeader,
  extractClaims,
  DEFAULT_DEV_SECRET,
  COOKIE_NAME
} from "../../../src/lib/auth-internal/jwt.js";
import { createCaptureTransport } from "../../../src/lib/logging/transports/capture.js";
import { createLogger } from "../../../src/lib/logging/logger.js";

/** Matches the canonical UUID shape used for default dev subjects. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mock only getRemoteJwks so we can supply a local key set instead of hitting a real Cloudflare
// Access certs endpoint.
vi.mock(import("../../../src/lib/auth-internal/jwks.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getRemoteJwks: vi.fn() };
});

import { getRemoteJwks } from "../../../src/lib/auth-internal/jwks.js";

describe("JWT utilities", () => {
  // -----------------------------------------------------------------------
  // signDevJwt + verifyDevJwt
  // -----------------------------------------------------------------------

  describe("signDevJwt / verifyDevJwt", () => {
    it("creates a token that can be verified with the default secret", async () => {
      const token = await signDevJwt("alice@example.com");
      const result = await verifyDevJwt(token);

      expect(result).not.toBeNull();
      expect(result!.email).toBe("alice@example.com");
      // Default sub is a generated UUID (not an email-derived value).
      expect(result!.sub).toMatch(UUID_RE);
      expect(result!.sub).not.toContain("@");
    });

    it("uses a provided sub verbatim", async () => {
      const sub = "01J8XYZ-custom-subject";
      const token = await signDevJwt("alice@example.com", { sub });
      const result = await verifyDevJwt(token);

      expect(result).not.toBeNull();
      expect(result!.sub).toBe(sub);
    });

    it("generates a distinct UUID sub on each call when none is provided", async () => {
      const a = await verifyDevJwt(await signDevJwt("alice@example.com"));
      const b = await verifyDevJwt(await signDevJwt("alice@example.com"));

      expect(a!.sub).toMatch(UUID_RE);
      expect(b!.sub).toMatch(UUID_RE);
      expect(a!.sub).not.toBe(b!.sub);
    });

    it("creates a token that can be verified with a custom secret", async () => {
      const secret = "my-custom-test-secret";
      const token = await signDevJwt("bob@example.com", { secret });
      const result = await verifyDevJwt(token, secret);

      expect(result).not.toBeNull();
      expect(result!.email).toBe("bob@example.com");
    });

    it("fails verification when the secret does not match (wrong signature)", async () => {
      const token = await signDevJwt("alice@example.com", { secret: "secret-a" });
      const result = await verifyDevJwt(token, "secret-b");

      expect(result).toBeNull();
    });

    it("respects a custom token lifetime (expired token)", async () => {
      // Create a token that already expired (negative lifetime trick: sign with a lifetime in
      // the past, so verification fails on `exp`).
      const token = await signDevJwt("alice@example.com", { lifetime: -1 });
      const result = await verifyDevJwt(token);

      expect(result).toBeNull();
    });

    it("returns null for garbage input (malformed token)", async () => {
      const result = await verifyDevJwt("not-a-jwt");
      expect(result).toBeNull();
    });

    it("returns null for an empty string", async () => {
      const result = await verifyDevJwt("");
      expect(result).toBeNull();
    });

    it("returns null for a token signed with a different algorithm (wrong algorithm)", async () => {
      // verifyDevJwt only accepts HS256; a token signed with a different HMAC-compatible
      // algorithm must be rejected even though the secret matches.
      const secret = new TextEncoder().encode(DEFAULT_DEV_SECRET);
      const token = await new SignJWT({ email: "alice@example.com", sub: "u1" })
        .setProtectedHeader({ alg: "HS384" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(secret);

      const result = await verifyDevJwt(token);
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // parseCookie
  // -----------------------------------------------------------------------

  describe("parseCookie", () => {
    it("extracts the CF_Authorization value", () => {
      const header = `${COOKIE_NAME}=abc123; other=xyz`;
      expect(parseCookie(header)).toBe("abc123");
    });

    it("handles the cookie appearing last", () => {
      const header = `other=xyz; ${COOKIE_NAME}=token-value`;
      expect(parseCookie(header)).toBe("token-value");
    });

    it("handles values containing '=' (JWTs)", () => {
      const jwt = "eyJ.eyJ.sig==";
      const header = `${COOKIE_NAME}=${jwt}`;
      expect(parseCookie(header)).toBe(jwt);
    });

    it("returns undefined when the cookie is absent", () => {
      expect(parseCookie("other=xyz; foo=bar")).toBeUndefined();
    });

    it("returns undefined for null input", () => {
      expect(parseCookie(null)).toBeUndefined();
    });

    it("returns undefined for undefined input", () => {
      expect(parseCookie(undefined)).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // buildCookieHeader
  // -----------------------------------------------------------------------

  describe("buildCookieHeader", () => {
    it("includes Secure flag when isSecure is true", () => {
      const header = buildCookieHeader("tok", true);
      expect(header).toContain("Secure");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Lax");
      expect(header).toContain("Path=/");
      expect(header).toMatch(new RegExp(`^${COOKIE_NAME}=tok`));
    });

    it("omits Secure flag when isSecure is false", () => {
      const header = buildCookieHeader("tok", false);
      expect(header).not.toContain("Secure");
      expect(header).toContain("HttpOnly");
    });
  });

  // -----------------------------------------------------------------------
  // clearCookieHeader
  // -----------------------------------------------------------------------

  describe("clearCookieHeader", () => {
    it("produces a Set-Cookie value that clears the CF_Authorization cookie", () => {
      const header = clearCookieHeader();
      expect(header).toContain(`${COOKIE_NAME}=`);
      expect(header).toContain("Max-Age=0");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Lax");
      expect(header).toContain("Path=/");
    });
  });

  // -----------------------------------------------------------------------
  // DEFAULT_DEV_SECRET
  // -----------------------------------------------------------------------

  it("exports a non-empty default dev secret", () => {
    expect(DEFAULT_DEV_SECRET).toBeTruthy();
    expect(typeof DEFAULT_DEV_SECRET).toBe("string");
  });

  // -----------------------------------------------------------------------
  // extractClaims
  // -----------------------------------------------------------------------

  describe("extractClaims", () => {
    it("returns email and sub from a valid payload", () => {
      const result = extractClaims({ email: "a@b.com", sub: "u123" });
      expect(result).toEqual({ email: "a@b.com", sub: "u123" });
    });

    it("returns null when email is missing", () => {
      expect(extractClaims({ sub: "u123" })).toBeNull();
    });

    it("returns null when email is not a string", () => {
      expect(extractClaims({ email: 42, sub: "u123" })).toBeNull();
    });

    it("returns null when email is empty", () => {
      expect(extractClaims({ email: "", sub: "u123" })).toBeNull();
    });

    it("returns null when sub is missing", () => {
      expect(extractClaims({ email: "a@b.com" })).toBeNull();
    });

    it("returns null when sub is not a string", () => {
      // Cast required: JWTPayload types `sub` as string, but the runtime guard must handle
      // malformed payloads.
      expect(extractClaims({ email: "a@b.com", sub: 99 as unknown as string })).toBeNull();
    });

    it("returns null when sub is empty", () => {
      expect(extractClaims({ email: "a@b.com", sub: "" })).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // verifyAccessJwt (with mocked JWKS)
  // -----------------------------------------------------------------------

  describe("verifyAccessJwt", () => {
    /** Canonical expected `iss` claim value for the `"test.cloudflareaccess.com"` team domain. */
    const EXPECTED_ISSUER = "https://test.cloudflareaccess.com";

    it("verifies a JWT signed with a key from the remote JWKS", async () => {
      const { publicKey, privateKey } = await generateKeyPair("RS256");
      const publicJwk = await exportJWK(publicKey);
      publicJwk.alg = "RS256";

      // createLocalJWKSet is callable-compatible with createRemoteJWKSet for verification
      // purposes; the cast is safe.
      const localJwks = createLocalJWKSet({ keys: [publicJwk] }) as ReturnType<
        typeof getRemoteJwks
      >;
      vi.mocked(getRemoteJwks).mockReturnValue(localJwks);

      const token = await new SignJWT({ email: "access@cloudflare.com", sub: "cf-user-123" })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(EXPECTED_ISSUER)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);

      const result = await verifyAccessJwt(token, "test.cloudflareaccess.com");

      expect(result).toEqual({ email: "access@cloudflare.com", sub: "cf-user-123" });
      expect(getRemoteJwks).toHaveBeenCalledWith("test.cloudflareaccess.com");
    });

    it("validates the audience claim when provided", async () => {
      const { publicKey, privateKey } = await generateKeyPair("RS256");
      const publicJwk = await exportJWK(publicKey);
      publicJwk.alg = "RS256";

      const localJwks = createLocalJWKSet({ keys: [publicJwk] }) as ReturnType<
        typeof getRemoteJwks
      >;
      vi.mocked(getRemoteJwks).mockReturnValue(localJwks);

      const token = await new SignJWT({ email: "a@b.com", sub: "u1" })
        .setProtectedHeader({ alg: "RS256" })
        .setAudience("my-app-aud")
        .setIssuer(EXPECTED_ISSUER)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);

      // Correct audience → success.
      const ok = await verifyAccessJwt(token, "test.cloudflareaccess.com", "my-app-aud");
      expect(ok).toEqual({ email: "a@b.com", sub: "u1" });

      // Wrong audience → null.
      const bad = await verifyAccessJwt(token, "test.cloudflareaccess.com", "wrong-aud");
      expect(bad).toBeNull();
    });

    // -----------------------------------------------------------------------
    // SEC-003: `iss` (Issuer) claim must be bound to the team domain
    // -----------------------------------------------------------------------

    describe("issuer validation (SEC-003)", () => {
      it("returns null when the token has no iss claim at all", async () => {
        const { publicKey, privateKey } = await generateKeyPair("RS256");
        const publicJwk = await exportJWK(publicKey);
        publicJwk.alg = "RS256";

        const localJwks = createLocalJWKSet({ keys: [publicJwk] }) as ReturnType<
          typeof getRemoteJwks
        >;
        vi.mocked(getRemoteJwks).mockReturnValue(localJwks);

        // Deliberately omit .setIssuer(...) — a correctly-signed token with no `iss` claim.
        const token = await new SignJWT({ email: "a@b.com", sub: "u1" })
          .setProtectedHeader({ alg: "RS256" })
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);

        const result = await verifyAccessJwt(token, "test.cloudflareaccess.com");
        expect(result).toBeNull();
      });

      it("returns null when the iss claim does not match the expected team domain (cross-team token replay)", async () => {
        const { publicKey, privateKey } = await generateKeyPair("RS256");
        const publicJwk = await exportJWK(publicKey);
        publicJwk.alg = "RS256";

        const localJwks = createLocalJWKSet({ keys: [publicJwk] }) as ReturnType<
          typeof getRemoteJwks
        >;
        vi.mocked(getRemoteJwks).mockReturnValue(localJwks);

        const token = await new SignJWT({ email: "a@b.com", sub: "u1" })
          .setProtectedHeader({ alg: "RS256" })
          .setIssuer("https://a-different-team.cloudflareaccess.com")
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);

        const result = await verifyAccessJwt(token, "test.cloudflareaccess.com");
        expect(result).toBeNull();
      });

      it("logs a warn with cause 'invalid' when the iss claim is mismatched", async () => {
        const { publicKey, privateKey } = await generateKeyPair("RS256");
        const publicJwk = await exportJWK(publicKey);
        publicJwk.alg = "RS256";

        const localJwks = createLocalJWKSet({ keys: [publicJwk] }) as ReturnType<
          typeof getRemoteJwks
        >;
        vi.mocked(getRemoteJwks).mockReturnValue(localJwks);

        const token = await new SignJWT({ email: "a@b.com", sub: "u1" })
          .setProtectedHeader({ alg: "RS256" })
          .setIssuer("https://a-different-team.cloudflareaccess.com")
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);

        const capture = createCaptureTransport();
        const logger = createLogger({ transport: capture, level: "trace" });

        const result = await verifyAccessJwt(token, "test.cloudflareaccess.com", undefined, logger);

        expect(result).toBeNull();
        const warnings = capture.find("warn");
        expect(warnings).toHaveLength(1);
        expect(warnings[0].context.cause).toBe("invalid");
        expect(warnings[0].context.err).toMatchObject({ name: "JWTClaimValidationFailed" });
      });
    });

    // -----------------------------------------------------------------------
    // SEC-004/CODE-003: `algorithms` allowlist must reject a non-RS256-signed token even when
    // the underlying key material would otherwise validate the signature.
    // -----------------------------------------------------------------------

    describe("algorithm allowlist (SEC-004/CODE-003)", () => {
      it("returns null for a token signed with a non-RS256 algorithm, even though the signature is cryptographically valid against the JWKS", async () => {
        // Use node:crypto's generateKeyPairSync (a generic RSA KeyObject) rather than jose's
        // generateKeyPair: jose's WebCrypto-backed keys bind a single algorithm at generation
        // time (e.g. an RS256 CryptoKey refuses to sign as PS256/RS384), which makes it
        // impossible to produce a "signature would otherwise validate" token any other way. A
        // plain RSA KeyObject has no such binding, so the same key pair can genuinely sign as
        // PS256 and still validate against the RSA public JWK in the JWKS below.
        const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const publicJwk = await exportJWK(publicKey);
        // Deliberately omit `alg` on the JWK entry so JWKS key resolution matches purely on
        // `kty`/`kid`, isolating this test to the `algorithms` allowlist in `verifyAccessJwt`
        // rather than a JWK-level `alg` mismatch that `createLocalJWKSet` would otherwise catch.

        const localJwks = createLocalJWKSet({ keys: [publicJwk] }) as ReturnType<
          typeof getRemoteJwks
        >;
        vi.mocked(getRemoteJwks).mockReturnValue(localJwks);

        const token = await new SignJWT({ email: "a@b.com", sub: "u1" })
          .setProtectedHeader({ alg: "PS256" })
          .setIssuer(EXPECTED_ISSUER)
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);

        const result = await verifyAccessJwt(token, "test.cloudflareaccess.com");
        expect(result).toBeNull();
      });

      it("logs a warn with cause 'invalid' when the token's alg is not in the allowlist", async () => {
        const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const publicJwk = await exportJWK(publicKey);

        const localJwks = createLocalJWKSet({ keys: [publicJwk] }) as ReturnType<
          typeof getRemoteJwks
        >;
        vi.mocked(getRemoteJwks).mockReturnValue(localJwks);

        const token = await new SignJWT({ email: "a@b.com", sub: "u1" })
          .setProtectedHeader({ alg: "PS256" })
          .setIssuer(EXPECTED_ISSUER)
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);

        const capture = createCaptureTransport();
        const logger = createLogger({ transport: capture, level: "trace" });

        const result = await verifyAccessJwt(token, "test.cloudflareaccess.com", undefined, logger);

        expect(result).toBeNull();
        const warnings = capture.find("warn");
        expect(warnings).toHaveLength(1);
        expect(warnings[0].context.cause).toBe("invalid");
        expect(warnings[0].context.err).toMatchObject({ name: "JOSEAlgNotAllowed" });
      });
    });

    it("returns null when the signature does not match the JWKS (wrong signature)", async () => {
      // Sign with one key pair, provide a different public key to JWKS.
      const { privateKey } = await generateKeyPair("RS256");
      const { publicKey: otherPublic } = await generateKeyPair("RS256");
      const otherJwk = await exportJWK(otherPublic);
      otherJwk.alg = "RS256";

      const localJwks = createLocalJWKSet({ keys: [otherJwk] }) as ReturnType<typeof getRemoteJwks>;
      vi.mocked(getRemoteJwks).mockReturnValue(localJwks);

      const token = await new SignJWT({ email: "a@b.com", sub: "u1" })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);

      const result = await verifyAccessJwt(token, "test.cloudflareaccess.com");
      expect(result).toBeNull();
    });

    it("returns null for a malformed token", async () => {
      const result = await verifyAccessJwt("not-a-jwt", "test.cloudflareaccess.com");
      expect(result).toBeNull();
    });

    // -----------------------------------------------------------------------
    // CODE-002: diagnostic logging on the optional `logger` parameter
    // -----------------------------------------------------------------------

    describe("diagnostic logging (CODE-002)", () => {
      it("logs a warn with cause 'invalid' when the token's signature does not match the JWKS", async () => {
        // Sign with one key pair, provide a different public key to JWKS — a genuine
        // token-validity failure, not a JWKS transport problem.
        const { privateKey } = await generateKeyPair("RS256");
        const { publicKey: otherPublic } = await generateKeyPair("RS256");
        const otherJwk = await exportJWK(otherPublic);
        otherJwk.alg = "RS256";

        const localJwks = createLocalJWKSet({ keys: [otherJwk] }) as ReturnType<
          typeof getRemoteJwks
        >;
        vi.mocked(getRemoteJwks).mockReturnValue(localJwks);

        const token = await new SignJWT({ email: "a@b.com", sub: "u1" })
          .setProtectedHeader({ alg: "RS256" })
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);

        const capture = createCaptureTransport();
        const logger = createLogger({ transport: capture, level: "trace" });

        const result = await verifyAccessJwt(token, "test.cloudflareaccess.com", undefined, logger);

        expect(result).toBeNull();
        const warnings = capture.find("warn");
        expect(warnings).toHaveLength(1);
        expect(warnings[0].message).toBe("Cloudflare Access JWT verification failed");
        expect(warnings[0].context.cause).toBe("invalid");
        expect(warnings[0].context.teamDomain).toBe("test.cloudflareaccess.com");
        expect(warnings[0].context.err).toMatchObject({ name: "JWSSignatureVerificationFailed" });
      });

      it("logs a warn with cause 'network' when the JWKS lookup throws a non-JOSE (e.g. fetch/DNS) error", async () => {
        // Simulates a transient JWKS transport failure (bad team domain, DNS blip, certs
        // endpoint down): the key-lookup function itself throws before any cryptographic
        // verification of the token could occur.
        vi.mocked(getRemoteJwks).mockReturnValue((async () => {
          throw new TypeError("fetch failed");
        }) as unknown as ReturnType<typeof getRemoteJwks>);

        // Must be RS256-headed (not a dev-signed HS256 token) so the SEC-004/CODE-003 algorithm
        // allowlist doesn't short-circuit with JOSEAlgNotAllowed before the mocked, throwing
        // key-lookup function above is ever invoked — the actual signature is irrelevant since
        // verification never reaches it.
        const { privateKey } = await generateKeyPair("RS256");
        const token = await new SignJWT({ email: "alice@example.com", sub: "u1" })
          .setProtectedHeader({ alg: "RS256" })
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);

        const capture = createCaptureTransport();
        const logger = createLogger({ transport: capture, level: "trace" });

        const result = await verifyAccessJwt(token, "test.cloudflareaccess.com", undefined, logger);

        expect(result).toBeNull();
        const warnings = capture.find("warn");
        expect(warnings).toHaveLength(1);
        expect(warnings[0].context.cause).toBe("network");
        expect(warnings[0].context.err).toMatchObject({
          name: "TypeError",
          message: "fetch failed"
        });
      });

      it("does not throw when logger is omitted (unchanged prior behavior)", async () => {
        const result = await verifyAccessJwt("not-a-jwt", "test.cloudflareaccess.com");
        expect(result).toBeNull();
      });
    });
  });
});
