import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Hono } from "hono";
import { cloudflareAccess } from "../../../src/lib/hono/cloudflare-access.js";
import type { AuthVariables } from "../../../src/lib/hono/types.js";
import type { PathPolicy } from "../../../src/lib/auth-internal/types.js";
import { signDevJwt, buildCookieHeader, COOKIE_NAME } from "../../../src/lib/auth-internal/jwt.js";
import { createAccessDevMiddleware } from "../../../src/lib/vite/plugin.js";

const MOCK_ENV = { CLOUDFLARE_TEAM_DOMAIN: "test.cloudflareaccess.com" };

const policies: PathPolicy[] = [{ pattern: /^\/api\//, authenticate: true, redirect: false }];

/** Build a fake connect req carrying the given cookie. */
function makeReq(url: string, cookie: string): IncomingMessage {
  const req = Readable.from([]) as unknown as IncomingMessage;
  req.url = url;
  req.method = "GET";
  req.headers = { cookie, accept: "application/json" };
  req.rawHeaders = ["cookie", cookie, "accept", "application/json"];
  return req;
}

function makeRes(): ServerResponse {
  return {
    statusCode: 200,
    setHeader() {},
    end() {}
  } as unknown as ServerResponse;
}

/** Run the plugin middleware and resolve when next() is called. */
function injectThroughPlugin(req: IncomingMessage): Promise<void> {
  const mw = createAccessDevMiddleware({ policies });
  return new Promise((resolve, reject) => {
    mw(req, makeRes(), (err?: unknown) => (err ? reject(err) : resolve()));
  });
}

/** Rebuild a fetch Request from req.rawHeaders, as the CF plugin does. */
function requestFromRawHeaders(req: IncomingMessage): Request {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }
  return new Request(`http://localhost${req.url}`, { headers });
}

function createWorker() {
  const app = new Hono<{ Bindings: typeof MOCK_ENV; Variables: AuthVariables }>();
  // The Worker under `vite dev` enables dev tokens (e.g. via import.meta.env.DEV) so the
  // plugin's HS256 token validates over HMAC.
  app.use(cloudflareAccess({ policies, enableDevTokens: true }));
  app.get("/api/me", (c) => c.json(c.get("Cloudflare_Access_Identity")));
  return app;
}

describe("vite plugin → cloudflareAccess() handshake", () => {
  it("an authenticated session reaches the Worker and validates via HMAC", async () => {
    const token = await signDevJwt("alice@example.com", { sub: "alice-uuid" });
    const cookie = buildCookieHeader(token, false).split(";")[0]; // CF_Authorization=<token>
    expect(cookie.startsWith(`${COOKIE_NAME}=`)).toBe(true);

    const req = makeReq("/api/me", cookie);
    await injectThroughPlugin(req);

    // The plugin must have injected the JWT onto rawHeaders.
    expect(req.rawHeaders).toContain("cf-access-jwt-assertion");

    const workerReq = requestFromRawHeaders(req);
    const res = await createWorker().fetch(workerReq, MOCK_ENV);

    expect(res.status).toBe(200);
    const body = await res.json<{ source: string; email: string; sub: string }>();
    expect(body.source).toBe("header");
    expect(body.email).toBe("alice@example.com");
    expect(body.sub).toBe("alice-uuid");
  });

  it("an unauthenticated API request is rejected by the Worker (401)", async () => {
    // No cookie → plugin would 401 for redirect:false, but verify the Worker also rejects when
    // the request reaches it without a token.
    const workerReq = new Request("http://localhost/api/me");
    const res = await createWorker().fetch(workerReq, MOCK_ENV);
    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // #181: path-specific PathPolicy.audience must agree between the plugin's dev-emulation layer
  // and the Worker's own cloudflareAccess — a session accepted by one but rejected by the other
  // would be a dev/prod parity bug.
  // -------------------------------------------------------------------------
  describe("path-specific audience parity", () => {
    const audiencePolicies: PathPolicy[] = [
      {
        pattern: /^\/api\/contributor/,
        authenticate: true,
        redirect: false,
        audience: "contrib-aud"
      },
      { pattern: /^\/api\/reviewer/, authenticate: true, redirect: false, audience: "review-aud" }
    ];

    function createAudienceWorker() {
      const app = new Hono<{ Bindings: typeof MOCK_ENV; Variables: AuthVariables }>();
      app.use(cloudflareAccess({ policies: audiencePolicies, enableDevTokens: true }));
      app.get("/api/contributor/docs", (c) => c.json(c.get("Cloudflare_Access_Identity")));
      app.get("/api/reviewer/docs", (c) => c.json(c.get("Cloudflare_Access_Identity")));
      return app;
    }

    it("a session minted for the contributor audience reaches the contributor route in both layers", async () => {
      const token = await signDevJwt("alice@example.com", { audience: "contrib-aud" });
      const cookie = buildCookieHeader(token, false).split(";")[0];

      const req = makeReq("/api/contributor/docs", cookie);
      const mw = createAccessDevMiddleware({ policies: audiencePolicies });
      await new Promise<void>((resolve, reject) => {
        mw(req, makeRes(), (err?: unknown) => (err ? reject(err) : resolve()));
      });
      expect(req.rawHeaders).toContain("cf-access-jwt-assertion");

      const workerReq = requestFromRawHeaders(req);
      const res = await createAudienceWorker().fetch(workerReq, MOCK_ENV);
      expect(res.status).toBe(200);
    });

    it("a session minted for the contributor audience is rejected by both layers on the reviewer route", async () => {
      const token = await signDevJwt("alice@example.com", { audience: "contrib-aud" });
      const cookie = buildCookieHeader(token, false).split(";")[0];

      // Plugin layer: the dev-emulation middleware treats the wrong-audience session as
      // unauthenticated for this path and returns 401 directly (redirect: false) — it never
      // calls `next()` in that case, so the response's own `end()` (not the `next` callback)
      // is what signals completion here.
      const req = makeReq("/api/reviewer/docs", cookie);
      const res = makeRes();
      let pluginNextCalled = false;
      const mw = createAccessDevMiddleware({ policies: audiencePolicies });
      await new Promise<void>((resolve, reject) => {
        const originalEnd = res.end.bind(res);
        res.end = ((body?: string) => {
          originalEnd(body);
          resolve();
          return res;
        }) as typeof res.end;
        mw(req, res, (err?: unknown) => {
          pluginNextCalled = true;
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      expect(pluginNextCalled).toBe(false);
      expect(res.statusCode).toBe(401);

      // Worker layer: even if the request reached it directly with the same cookie (bypassing
      // the plugin), cloudflareAccess independently rejects the wrong audience too. A
      // deliberately non-conforming team domain (matching the pattern used in
      // test/workers/hono/cloudflare-access.test.ts) forces the fallback real-JWKS branch to
      // fail synchronously on team-domain validation instead of attempting a real network fetch
      // once the dev-token fast path rejects the mismatched audience.
      const INVALID_ENV = { CLOUDFLARE_TEAM_DOMAIN: "cloudflare-toolkit-test.invalid" };
      const workerReq = new Request("http://localhost/api/reviewer/docs", {
        headers: { cookie }
      });
      const workerRes = await createAudienceWorker().fetch(workerReq, INVALID_ENV);
      expect(workerRes.status).toBe(401);
    });
  });
});
