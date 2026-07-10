// Package-level export validation for `@adrianhall/cloudflare-toolkit/testing` (docs/SPECv2.md
// §5.1, §5.9, §7.2, issue #15). Imports the built package by name/subpath resolution against
// `dist/`, not a relative path — see guards.test.ts for why.
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import * as testing from "@adrianhall/cloudflare-toolkit/testing";
import * as hono from "@adrianhall/cloudflare-toolkit/hono";

describe("dist testing/index.js — exports", () => {
  it("exports signDevJwt as a function", () => {
    expect(typeof testing.signDevJwt).toBe("function");
  });

  it("exports buildCookieHeader as a function", () => {
    expect(typeof testing.buildCookieHeader).toBe("function");
  });

  it("exports clearCookieHeader as a function", () => {
    expect(typeof testing.clearCookieHeader).toBe("function");
  });

  it("exports JWT_HEADER as the documented header name", () => {
    expect(testing.JWT_HEADER).toBe("cf-access-jwt-assertion");
  });

  it("exports COOKIE_NAME as the documented cookie name", () => {
    expect(testing.COOKIE_NAME).toBe("CF_Authorization");
  });

  it("exports exactly the documented runtime symbols", () => {
    expect(Object.keys(testing).sort()).toStrictEqual(
      ["signDevJwt", "buildCookieHeader", "clearCookieHeader", "JWT_HEADER", "COOKIE_NAME"].sort()
    );
  });
});

describe("cross-entry: a testing-signed token is accepted/rejected by hono's cloudflareAccess", () => {
  // This is the built-level counterpart to test/node/testing/index.test.ts's acceptance-criteria
  // suite: both `testing` and `hono` are imported here via their own package subpath (against
  // `dist/`), not `src/`, proving the contract holds for what actually ships to npm, not just
  // what's true of the source.
  it("accepts a token signed via testing's signDevJwt when enableDevTokens is true", async () => {
    const token = await testing.signDevJwt("dev@example.com", { sub: "dev-uuid" });

    const app = new Hono();
    app.use(hono.cloudflareAccess({ enableDevTokens: true }));
    app.get("/api/me", (c) => c.json({ email: c.get("userEmail") ?? null }));

    const res = await app.request("/api/me", { headers: { [testing.JWT_HEADER]: token } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string };
    expect(body.email).toBe("dev@example.com");
  });

  it("rejects the same token when enableDevTokens is not enabled (fail-closed, docs/SPECv2.md §9)", async () => {
    const token = await testing.signDevJwt("dev@example.com");

    const app = new Hono();
    app.use(hono.cloudflareAccess());
    app.get("/api/me", (c) => c.json({ email: c.get("userEmail") ?? null }));

    const res = await app.request("/api/me", { headers: { [testing.JWT_HEADER]: token } });

    expect(res.status).toBe(401);
  });

  it("accepts a token via the cookie helper's name=value pair", async () => {
    const token = await testing.signDevJwt("cookie-dev@example.com");
    const cookie = testing.buildCookieHeader(token, false).split(";")[0];

    const app = new Hono();
    app.use(hono.cloudflareAccess({ enableDevTokens: true }));
    app.get("/api/me", (c) => c.json({ email: c.get("userEmail") ?? null }));

    const res = await app.request("/api/me", { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string };
    expect(body.email).toBe("cookie-dev@example.com");
  });
});
