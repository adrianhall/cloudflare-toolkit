import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import * as testing from "../../../src/lib/testing/index.js";
import * as authInternal from "../../../src/lib/auth-internal/jwt.js";
import { verifyDevJwt } from "../../../src/lib/auth-internal/jwt.js";
import { cloudflareAccess } from "../../../src/lib/hono/cloudflare-access.js";
import type { AuthVariables } from "../../../src/lib/hono/types.js";

describe("testing barrel — re-export identity", () => {
  it("re-exports the exact bindings from auth-internal/jwt.js (not copies)", () => {
    expect(testing.signDevJwt).toBe(authInternal.signDevJwt);
    expect(testing.buildCookieHeader).toBe(authInternal.buildCookieHeader);
    expect(testing.clearCookieHeader).toBe(authInternal.clearCookieHeader);
    expect(testing.JWT_HEADER).toBe(authInternal.JWT_HEADER);
    expect(testing.COOKIE_NAME).toBe(authInternal.COOKIE_NAME);
  });

  it("exports exactly the documented runtime symbols", () => {
    expect(Object.keys(testing).sort()).toStrictEqual(
      ["signDevJwt", "buildCookieHeader", "clearCookieHeader", "JWT_HEADER", "COOKIE_NAME"].sort()
    );
  });
});

describe("testing barrel — signDevJwt round-trips through auth-internal's verification", () => {
  it("signs a token that auth-internal's own verifyDevJwt accepts", async () => {
    const token = await testing.signDevJwt("alice@example.com", { sub: "alice-uuid" });

    const result = await verifyDevJwt(token);

    expect(result).toEqual({ email: "alice@example.com", sub: "alice-uuid" });
  });

  it("signs a token with a custom secret that verifies only with that same secret", async () => {
    const secret = "my-test-secret";
    const token = await testing.signDevJwt("bob@example.com", { secret });

    expect(await verifyDevJwt(token, secret)).toEqual({
      email: "bob@example.com",
      sub: expect.any(String)
    });
    expect(await verifyDevJwt(token, "wrong-secret")).toBeNull();
  });
});

describe("testing barrel — cookie helper shape", () => {
  it("buildCookieHeader's name=value pair matches the cloudflareAccess cookie fixture shape", async () => {
    const token = await testing.signDevJwt("carol@example.com");

    // Same extraction technique as test/node/vite/handshake.test.ts: the Set-Cookie attributes
    // (HttpOnly/SameSite/Path) are irrelevant to a request's Cookie header — only the leading
    // name=value pair is sent back by a client.
    const cookiePair = testing.buildCookieHeader(token, false).split(";")[0];

    expect(cookiePair).toBe(`${testing.COOKIE_NAME}=${token}`);
  });

  it("clearCookieHeader clears the same cookie name buildCookieHeader sets", () => {
    expect(testing.clearCookieHeader()).toContain(`${testing.COOKIE_NAME}=`);
    expect(testing.clearCookieHeader()).toContain("Max-Age=0");
  });
});

// ---------------------------------------------------------------------------
// A testing-signed token is accepted by cloudflareAccess when enableDevTokens is true, and
// rejected when it isn't (the fail-closed invariant, proven through this public surface).
// ---------------------------------------------------------------------------
describe("testing barrel + cloudflareAccess acceptance criteria", () => {
  type AccessEnv = { Bindings: Record<string, never>; Variables: AuthVariables };

  function createApp() {
    const app = new Hono<AccessEnv>();
    app.use(cloudflareAccess({ enableDevTokens: true }));
    app.get("/api/me", (c) => c.json({ email: c.get("userEmail"), sub: c.get("userSub") }));
    return app;
  }

  it("accepts a testing-signed token via the header when enableDevTokens is true", async () => {
    const token = await testing.signDevJwt("dev@example.com", { sub: "dev-uuid" });
    const app = createApp();

    const res = await app.fetch(
      new Request("http://localhost/api/me", { headers: { [testing.JWT_HEADER]: token } }),
      {}
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; sub: string };
    expect(body).toEqual({ email: "dev@example.com", sub: "dev-uuid" });
  });

  it("accepts a testing-signed token via the cookie helper when enableDevTokens is true", async () => {
    const token = await testing.signDevJwt("cookie-dev@example.com");
    const cookie = testing.buildCookieHeader(token, false).split(";")[0];
    const app = createApp();

    const res = await app.fetch(
      new Request("http://localhost/api/me", { headers: { Cookie: cookie } }),
      {}
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string };
    expect(body.email).toBe("cookie-dev@example.com");
  });

  it("rejects the same testing-signed token when enableDevTokens is not enabled (fail-closed)", async () => {
    const token = await testing.signDevJwt("dev@example.com");

    const app = new Hono<AccessEnv>();
    app.use(cloudflareAccess()); // enableDevTokens defaults to false
    app.get("/api/me", (c) => c.json({ email: c.get("userEmail") ?? null }));

    const res = await app.fetch(
      new Request("http://localhost/api/me", { headers: { [testing.JWT_HEADER]: token } }),
      {}
    );

    expect(res.status).toBe(401);
  });
});
