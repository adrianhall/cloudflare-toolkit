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
  app.get("/api/me", (c) => c.json({ email: c.get("userEmail"), sub: c.get("userSub") }));
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
    const body = (await res.json()) as { email: string; sub: string };
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
});
