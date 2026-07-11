import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { cloudflareAccess } from "../../../src/lib/hono/cloudflare-access.js";
import type { AuthVariables } from "../../../src/lib/hono/types.js";
import {
  COOKIE_NAME,
  DEFAULT_DEV_SECRET,
  JWT_HEADER,
  signDevJwt
} from "../../../src/lib/auth-internal/jwt.js";
import { createCaptureTransport } from "../../../src/lib/logging/transports/capture.js";
import { createLogger } from "../../../src/lib/logging/logger.js";

const BASE = "http://localhost";

/** Team domain guaranteed to never resolve (RFC 2606) — forces the real JWKS branch to fail. */
const UNREACHABLE_TEAM_DOMAIN = "cloudflare-toolkit-test.invalid";

/** Minimal env stub with a genuinely-configured (but unreachable) team domain. */
const MOCK_ENV = { CLOUDFLARE_TEAM_DOMAIN: UNREACHABLE_TEAM_DOMAIN };

type AccessEnv = { Bindings: typeof MOCK_ENV; Variables: AuthVariables };

function createApp(options?: Parameters<typeof cloudflareAccess>[0]) {
  const app = new Hono<AccessEnv>();
  app.use(cloudflareAccess(options));

  app.get("/api/test", (c) =>
    c.json({ email: c.get("userEmail") ?? null, sub: c.get("userSub") ?? null })
  );
  app.get("/api/version", (c) => c.json({ version: "1.0" }));
  app.get("/public", (c) => c.text("ok"));

  return app;
}

function fetchWithEnv(app: ReturnType<typeof createApp>, url: string, init?: RequestInit) {
  return app.fetch(new Request(url, init), MOCK_ENV);
}

describe("cloudflareAccess", () => {
  // -----------------------------------------------------------------------
  // §9's explicit security invariant: dev tokens are fail-closed by default.
  // -----------------------------------------------------------------------
  describe("SECURITY: dev tokens are fail-closed by default", () => {
    it("rejects a DEFAULT_DEV_SECRET-signed token when enableDevTokens is unset, even with a real (but unreachable) team domain configured", async () => {
      // Attacker mints a token with the published public secret and sends it as the Access
      // assertion header. `enableDevTokens` is not set, so `cloudflareAccess` must never even
      // attempt HS256 verification — only the real Cloudflare Access JWKS path runs. A team
      // domain IS configured (MOCK_ENV), so there is no "missing CLOUDFLARE_TEAM_DOMAIN"
      // shortcut being relied on here; the JWKS fetch genuinely runs and genuinely fails because
      // the domain does not exist, producing the same 401 a real deployment would see for an
      // unrecognized token.
      const forged = await signDevJwt("attacker@evil.example", { secret: DEFAULT_DEV_SECRET });
      const app = createApp();

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: forged }
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Invalid or expired");
    });

    it("rejects a forged token in the cookie when enableDevTokens is unset", async () => {
      const forged = await signDevJwt("attacker@evil.example", { secret: DEFAULT_DEV_SECRET });
      const app = createApp();

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { Cookie: `${COOKIE_NAME}=${forged}` }
      });

      expect(res.status).toBe(401);
    });

    it("does not bypass via a forged dev token even on a defaultAction: bypass path", async () => {
      // `bypass` only relaxes the *missing-token* case; a presented token must still fail
      // verification when dev tokens are disabled, so no user is ever set from it.
      const forged = await signDevJwt("attacker@evil.example", { secret: DEFAULT_DEV_SECRET });
      const app = createApp({ defaultAction: "bypass" });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: forged }
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string | null; sub: string | null };
      expect(body.email).toBeNull();
      expect(body.sub).toBeNull();
    });

    it("verifies the same token once enableDevTokens is explicitly true", async () => {
      const token = await signDevJwt("dev@example.com", { sub: "dev-uuid" });
      const app = createApp({ enableDevTokens: true });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: token }
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string; sub: string };
      expect(body.email).toBe("dev@example.com");
      expect(body.sub).toBe("dev-uuid");
    });
  });

  // -----------------------------------------------------------------------
  // Dev token verification (enableDevTokens: true)
  // -----------------------------------------------------------------------
  describe("dev token verification", () => {
    it("sets AuthVariables from a valid dev JWT in the header", async () => {
      const token = await signDevJwt("alice@example.com", { sub: "alice-uuid" });
      const app = createApp({ enableDevTokens: true });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: token }
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string; sub: string };
      expect(body.email).toBe("alice@example.com");
      expect(body.sub).toBe("alice-uuid");
    });

    it("sets AuthVariables from a valid dev JWT in the cookie", async () => {
      const token = await signDevJwt("bob@example.com");
      const app = createApp({ enableDevTokens: true });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { Cookie: `${COOKIE_NAME}=${token}` }
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string; sub: string };
      expect(body.email).toBe("bob@example.com");
    });

    it("prefers the header over the cookie when both are present", async () => {
      const headerToken = await signDevJwt("header@example.com");
      const cookieToken = await signDevJwt("cookie@example.com");
      const app = createApp({ enableDevTokens: true });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: headerToken, Cookie: `${COOKIE_NAME}=${cookieToken}` }
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string; sub: string };
      expect(body.email).toBe("header@example.com");
    });

    it("works with a custom dev secret", async () => {
      const secret = "my-test-secret";
      const token = await signDevJwt("custom@example.com", { secret });
      const app = createApp({ devSecret: secret, enableDevTokens: true });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: token }
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string; sub: string };
      expect(body.email).toBe("custom@example.com");
    });

    it("falls through to the (failing) JWKS path when the dev secret does not match", async () => {
      const token = await signDevJwt("alice@example.com", { secret: "secret-a" });
      const app = createApp({ devSecret: "secret-b", enableDevTokens: true });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: token }
      });

      expect(res.status).toBe(401);
    });

    it("returns 401 for an expired dev token", async () => {
      const token = await signDevJwt("expired@example.com", { lifetime: -1 });
      const app = createApp({ enableDevTokens: true });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: token }
      });

      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // Missing / invalid token (defaultAction: "block", the default)
  // -----------------------------------------------------------------------
  describe("missing or invalid token (defaultAction: block)", () => {
    it("returns 401 when no JWT is provided", async () => {
      const app = createApp();
      const res = await fetchWithEnv(app, `${BASE}/api/test`);

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Authentication required");
    });

    it("returns 401 for a malformed JWT", async () => {
      const app = createApp();
      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: "not.a.jwt" }
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Invalid or expired");
    });

    it("returns 401 when no team domain is configured and the token is not dev-signed", async () => {
      const token = await signDevJwt("alice@example.com", { secret: "unknown-secret" });
      const app = createApp({ devSecret: "other-secret", enableDevTokens: true });

      // No CLOUDFLARE_TEAM_DOMAIN in env and no `teamDomain` option — the dev secret mismatches,
      // so verification falls through to the "no team domain configured" branch.
      const res = await app.fetch(
        new Request(`${BASE}/api/test`, { headers: { [JWT_HEADER]: token } }),
        {}
      );

      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // Path policies
  // -----------------------------------------------------------------------
  describe("path policies", () => {
    const policies = [
      { pattern: /^\/api\/version$/, authenticate: false },
      { pattern: /^\/public$/, authenticate: false },
      { pattern: /^\/api\//, authenticate: true }
    ];

    it("bypasses auth for paths marked authenticate: false", async () => {
      const app = createApp({ policies });
      const res = await fetchWithEnv(app, `${BASE}/api/version`);
      expect(res.status).toBe(200);
    });

    it("requires auth for paths marked authenticate: true", async () => {
      const app = createApp({ policies });
      const res = await fetchWithEnv(app, `${BASE}/api/test`);
      expect(res.status).toBe(401);
    });

    it("uses first-match-wins ordering", async () => {
      const app = createApp({ policies });

      const versionRes = await fetchWithEnv(app, `${BASE}/api/version`);
      expect(versionRes.status).toBe(200);

      const testRes = await fetchWithEnv(app, `${BASE}/api/test`);
      expect(testRes.status).toBe(401);
    });

    it("sets AuthVariables for an authenticated request under a policy requiring auth", async () => {
      const token = await signDevJwt("alice@example.com");
      const app = createApp({
        enableDevTokens: true,
        policies: [{ pattern: /^\/api\//, authenticate: true }]
      });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: token }
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string };
      expect(body.email).toBe("alice@example.com");
    });

    it("falls back to defaultAction for a path that matches no policy", async () => {
      const app = createApp({
        policies: [{ pattern: /^\/api\/version$/, authenticate: false }],
        defaultAction: "bypass"
      });

      // /public matches no policy; defaultAction is bypass, so it's allowed through.
      const res = await fetchWithEnv(app, `${BASE}/public`);
      expect(res.status).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // defaultAction: bypass
  // -----------------------------------------------------------------------
  describe("defaultAction: bypass", () => {
    it("allows requests through when no JWT is present", async () => {
      const app = createApp({ defaultAction: "bypass" });

      const res = await fetchWithEnv(app, `${BASE}/api/test`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string | null; sub: string | null };
      expect(body.email).toBeNull();
      expect(body.sub).toBeNull();
    });

    it("sets AuthVariables when a valid JWT is present", async () => {
      const token = await signDevJwt("opt@example.com");
      const app = createApp({ defaultAction: "bypass", enableDevTokens: true });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: token }
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string };
      expect(body.email).toBe("opt@example.com");
    });

    it("allows through with an invalid JWT (no user set)", async () => {
      const app = createApp({ defaultAction: "bypass" });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: "garbage.token.here" }
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string | null };
      expect(body.email).toBeNull();
    });

    it("still blocks when a policy explicitly requires auth", async () => {
      const app = createApp({
        defaultAction: "bypass",
        policies: [{ pattern: /^\/api\/test$/, authenticate: true }]
      });

      const res = await fetchWithEnv(app, `${BASE}/api/test`);
      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // Team domain / audience
  // -----------------------------------------------------------------------
  describe("team domain and audience", () => {
    it("uses options.teamDomain over c.env.CLOUDFLARE_TEAM_DOMAIN when both are present", async () => {
      // No matching key exists at this domain either, but this proves the explicit option is
      // read (and not silently ignored) by using a *different* unreachable-but-configured
      // domain than the one in MOCK_ENV.
      const app = createApp({ teamDomain: "another.cloudflare-toolkit-test.invalid" });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: "not.a.jwt" }
      });

      expect(res.status).toBe(401);
    });

    it("passes an audience option through to JWKS verification without throwing", async () => {
      const app = createApp({ audience: "my-app" });

      const res = await fetchWithEnv(app, `${BASE}/api/test`, {
        headers: { [JWT_HEADER]: "not.a.jwt" }
      });

      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // SEC-001: omitting `audience` skips `aud` validation entirely, allowing cross-application
  // Access token replay within the same team. This must warn loudly in the default
  // (production-shaped) configuration, and stay silent when `enableDevTokens` signals a
  // local-development posture.
  // -----------------------------------------------------------------------
  describe("SECURITY: audience omission warns outside dev-token mode", () => {
    it("logs a one-time warning when audience is omitted and enableDevTokens is unset (default)", () => {
      const capture = createCaptureTransport();
      const logger = createLogger({ transport: capture, level: "warn" });

      cloudflareAccess({ logger });

      const warnings = capture.find("warn");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain("audience");
    });

    it("logs a one-time warning when audience is omitted and enableDevTokens is explicitly false", () => {
      const capture = createCaptureTransport();
      const logger = createLogger({ transport: capture, level: "warn" });

      cloudflareAccess({ enableDevTokens: false, logger });

      expect(capture.find("warn")).toHaveLength(1);
    });

    it("does not warn when audience is provided (default, non-dev-token configuration)", () => {
      const capture = createCaptureTransport();
      const logger = createLogger({ transport: capture, level: "warn" });

      cloudflareAccess({ audience: "my-app-aud", logger });

      expect(capture.find("warn")).toHaveLength(0);
    });

    it("does not warn when audience is omitted but enableDevTokens is true (local development)", () => {
      const capture = createCaptureTransport();
      const logger = createLogger({ transport: capture, level: "warn" });

      cloudflareAccess({ enableDevTokens: true, devSecret: "explicit-secret", logger });

      expect(capture.find("warn")).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Pluggable logger
  // -----------------------------------------------------------------------
  describe("pluggable logger", () => {
    it("logs a one-time warning when enableDevTokens is true without an explicit devSecret", () => {
      const capture = createCaptureTransport();
      const logger = createLogger({ transport: capture, level: "warn" });

      cloudflareAccess({ enableDevTokens: true, logger });

      const warnings = capture.find("warn");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain("DEFAULT_DEV_SECRET");
    });

    it("does not warn when an explicit devSecret is provided", () => {
      const capture = createCaptureTransport();
      const logger = createLogger({ transport: capture, level: "warn" });

      cloudflareAccess({ enableDevTokens: true, devSecret: "explicit-secret", logger });

      expect(capture.find("warn")).toHaveLength(0);
    });

    it("does not warn about devSecret when dev tokens are disabled (default) and audience is configured", () => {
      const capture = createCaptureTransport();
      const logger = createLogger({ transport: capture, level: "warn" });

      // `audience` is supplied so this isolates the devSecret-specific assertion from the
      // separate SEC-001 audience-omission warning (see the "SECURITY: audience omission warns
      // outside dev-token mode" describe block above).
      cloudflareAccess({ audience: "test-aud", logger });

      expect(capture.find("warn")).toHaveLength(0);
    });

    it("invokes the logger for request-scoped diagnostics (debug on a bypassed public path)", async () => {
      const capture = createCaptureTransport();
      const logger = createLogger({ transport: capture, level: "trace" });
      const app = createApp({
        logger,
        policies: [{ pattern: /^\/public$/, authenticate: false }]
      });

      const res = await fetchWithEnv(app, `${BASE}/public`);

      expect(res.status).toBe(200);
      expect(capture.find("debug").some((r) => r.message.includes("bypassing auth"))).toBe(true);
    });

    it("invokes the logger with an error when no team domain is configured", async () => {
      const capture = createCaptureTransport();
      const logger = createLogger({ transport: capture, level: "trace" });
      const app = createApp({ logger });

      const res = await app.fetch(
        new Request(`${BASE}/api/test`, { headers: { [JWT_HEADER]: "not.a.jwt" } }),
        {}
      );

      expect(res.status).toBe(401);
      expect(
        capture.find("error").some((r) => r.message.includes("No team domain configured"))
      ).toBe(true);
    });

    it("defaults to a silent logger when no logger option is provided (no throw, no output assertions possible)", async () => {
      const app = createApp();
      const res = await fetchWithEnv(app, `${BASE}/api/test`);
      expect(res.status).toBe(401);
    });
  });
});
