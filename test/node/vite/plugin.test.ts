import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  cloudflareAccessPlugin,
  createAccessDevMiddleware,
  type CloudflareAccessPluginOptions
} from "../../../src/lib/vite/plugin.js";
import {
  signDevJwt,
  COOKIE_NAME,
  JWT_HEADER,
  EMAIL_HEADER
} from "../../../src/lib/auth-internal/jwt.js";
import type { PathPolicy } from "../../../src/lib/auth-internal/types.js";

// ---------------------------------------------------------------------------
// Mock req/res helpers
// ---------------------------------------------------------------------------

interface MockRes extends ServerResponse {
  _body?: string;
  _headers: Record<string, string>;
}

function makeReq(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  errorOnRead?: boolean;
}): IncomingMessage {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    headers[k.toLowerCase()] = v;
  }
  const rawHeaders: string[] = [];
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    rawHeaders.push(k, v);
  }

  let stream: Readable;
  if (opts.errorOnRead) {
    stream = new Readable({
      read() {
        this.destroy(new Error("stream boom"));
      }
    });
  } else {
    stream = Readable.from(opts.body ? [Buffer.from(opts.body)] : []);
  }

  const req = stream as unknown as IncomingMessage;
  req.url = opts.url;
  req.method = opts.method ?? "GET";
  req.headers = headers;
  req.rawHeaders = rawHeaders;
  return req;
}

function makeRes(): MockRes {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    _headers: headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    end(body?: string) {
      (this as MockRes)._body = body;
    }
  } as unknown as MockRes;
  return res;
}

/** Run the middleware and resolve once it either calls `next` or ends the response. */
function invoke(
  options: CloudflareAccessPluginOptions,
  req: IncomingMessage,
  res: MockRes
): Promise<{ nextCalled: boolean; nextErr?: unknown }> {
  const mw = createAccessDevMiddleware(options);
  return new Promise((resolve) => {
    const originalEnd = res.end.bind(res);
    res.end = ((body?: string) => {
      originalEnd(body);
      resolve({ nextCalled: false });
      return res;
    }) as unknown as typeof res.end;
    mw(req, res, (err?: unknown) => resolve({ nextCalled: true, nextErr: err }));
  });
}

const COOKIE = (token: string) => `${COOKIE_NAME}=${token}`;

// ---------------------------------------------------------------------------
// Plugin shape
// ---------------------------------------------------------------------------

describe("cloudflareAccessPlugin", () => {
  it("returns a dev-only pre-enforced plugin", () => {
    const plugin = cloudflareAccessPlugin();
    expect(plugin.name).toBe("cloudflare-access-dev");
    expect(plugin.apply).toBe("serve");
    expect(plugin.enforce).toBe("pre");
  });

  it("registers the connect middleware synchronously in configureServer", () => {
    const plugin = cloudflareAccessPlugin();
    const use = vi.fn();
    const server = { middlewares: { use } };
    // configureServer is a function on the plugin object.
    (plugin.configureServer as unknown as (s: typeof server) => void)(server);
    expect(use).toHaveBeenCalledTimes(1);
    expect(typeof use.mock.calls[0][0]).toBe("function");
  });

  it("defaults options to {} when called with no arguments", async () => {
    const mw = createAccessDevMiddleware(); // exercises the `options = {}` default
    const req = makeReq({ url: "/@vite/client" }); // Vite-internal → immediate next()
    const res = makeRes();

    const nextCalled = await new Promise<boolean>((resolve) => {
      mw(req, res, () => resolve(true));
    });

    expect(nextCalled).toBe(true);
    expect(req.headers[JWT_HEADER]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Vite internals passthrough
// ---------------------------------------------------------------------------

describe("vite internals passthrough", () => {
  it.each([
    "/@vite/client",
    "/@fs/Users/x/proj/file.ts",
    "/@id/foo",
    "/@react-refresh",
    "/node_modules/.vite/deps/react.js",
    "/__vite_ping",
    "/src/main.tsx"
  ])("passes %s through untouched", async (url) => {
    const req = makeReq({ url });
    const res = makeRes();
    const result = await invoke({}, req, res);
    expect(result.nextCalled).toBe(true);
    expect(req.headers[JWT_HEADER]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Login form
// ---------------------------------------------------------------------------

describe("login form", () => {
  it("serves the login form on GET and reflects the redirect param", async () => {
    const req = makeReq({ url: "/cdn-cgi/access/login?redirect=%2Fdashboard" });
    const res = makeRes();
    const result = await invoke({}, req, res);

    expect(result.nextCalled).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res._headers["content-type"]).toContain("text/html");
    expect(res._body).toContain("Developer Login");
    expect(res._body).toContain('value="/dashboard"');
  });

  it("renders selectable users when configured", async () => {
    const users = [{ email: "alice@example.com", name: "Alice" }, { email: "bob@example.com" }];
    const req = makeReq({ url: "/cdn-cgi/access/login" });
    const res = makeRes();
    await invoke({ users }, req, res);

    expect(res._body).toContain("alice@example.com");
    expect(res._body).toContain("Alice");
    expect(res._body).toContain("bob@example.com");
    expect(res._body).toContain("custom-email");
  });
});

// ---------------------------------------------------------------------------
// Login submit
// ---------------------------------------------------------------------------

describe("login submit", () => {
  it("signs a dev JWT and sets an HttpOnly cookie, then redirects", async () => {
    const body = new URLSearchParams({ email: "alice@example.com", redirect: "/home" }).toString();
    const req = makeReq({
      url: "/cdn-cgi/access/login",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const res = makeRes();
    const result = await invoke({}, req, res);

    expect(result.nextCalled).toBe(false);
    expect(res.statusCode).toBe(302);
    expect(res._headers["location"]).toBe("/home");
    const cookie = res._headers["set-cookie"];
    expect(cookie).toContain(`${COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toContain("Secure");
  });

  it("prefers a custom email over the selected radio value", async () => {
    const body = new URLSearchParams({
      "email": "alice@example.com",
      "custom-email": "custom@example.com",
      "redirect": "/"
    }).toString();
    const req = makeReq({
      url: "/cdn-cgi/access/login",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const res = makeRes();
    await invoke({}, req, res);

    // Decode the signed cookie to confirm the email used.
    const cookie = res._headers["set-cookie"];
    const token = cookie.split(";")[0].split("=").slice(1).join("=");
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
    expect(payload.email).toBe("custom@example.com");
  });

  it("pins a configured user's sub verbatim in the signed JWT", async () => {
    const users = [{ email: "alice@example.com", name: "Alice", sub: "alice-fixed-uuid" }];
    const body = new URLSearchParams({ email: "alice@example.com", redirect: "/" }).toString();
    const req = makeReq({
      url: "/cdn-cgi/access/login",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const res = makeRes();
    await invoke({ users }, req, res);

    const cookie = res._headers["set-cookie"];
    const token = cookie.split(";")[0].split("=").slice(1).join("=");
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
    expect(payload.sub).toBe("alice-fixed-uuid");
  });

  it("generates a UUID sub for a custom email not in the users list", async () => {
    const users = [{ email: "alice@example.com", name: "Alice", sub: "alice-fixed-uuid" }];
    const body = new URLSearchParams({
      "email": "alice@example.com",
      "custom-email": "stranger@example.com",
      "redirect": "/"
    }).toString();
    const req = makeReq({
      url: "/cdn-cgi/access/login",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const res = makeRes();
    await invoke({ users }, req, res);

    const cookie = res._headers["set-cookie"];
    const token = cookie.split(";")[0].split("=").slice(1).join("=");
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
    expect(payload.email).toBe("stranger@example.com");
    expect(payload.sub).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(payload.sub).not.toBe("alice-fixed-uuid");
  });

  it("sets the Secure flag when forwarded over https", async () => {
    const body = new URLSearchParams({ email: "alice@example.com" }).toString();
    const req = makeReq({
      url: "/cdn-cgi/access/login",
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-proto": "https"
      },
      body
    });
    const res = makeRes();
    await invoke({}, req, res);
    expect(res._headers["set-cookie"]).toContain("Secure");
  });

  it("re-renders the form with a 400 when no email is provided", async () => {
    const req = makeReq({
      url: "/cdn-cgi/access/login",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ redirect: "/" }).toString()
    });
    const res = makeRes();
    await invoke({}, req, res);

    expect(res.statusCode).toBe(400);
    expect(res._body).toContain("valid email address is required");
  });

  it("defaults the redirect target to / when absent", async () => {
    const req = makeReq({
      url: "/cdn-cgi/access/login",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "alice@example.com" }).toString()
    });
    const res = makeRes();
    await invoke({}, req, res);
    expect(res._headers["location"]).toBe("/");
  });

  it("propagates body-read errors to next(err)", async () => {
    const req = makeReq({
      url: "/cdn-cgi/access/login",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      errorOnRead: true
    });
    const res = makeRes();
    const result = await invoke({}, req, res);
    expect(result.nextCalled).toBe(true);
    expect(result.nextErr).toBeInstanceOf(Error);
  });

  it("returns a 413 problem+json response when the body exceeds the size cap (CODE-008)", async () => {
    const big = "a".repeat(70 * 1024); // exceeds the 64 KiB cap in a single chunk
    const body = new URLSearchParams({ "custom-email": big }).toString();
    const req = makeReq({
      url: "/cdn-cgi/access/login",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const res = makeRes();
    const result = await invoke({}, req, res);

    expect(result.nextCalled).toBe(false);
    expect(res.statusCode).toBe(413);
    expect(res._headers["content-type"]).toContain("application/problem+json");
    const problem = JSON.parse(res._body ?? "{}");
    expect(problem.status).toBe(413);
    expect(problem.title).toBe("Content Too Large");
    expect(problem.detail).toContain("exceeded the maximum allowed size");
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

describe("logout", () => {
  it("clears the cookie and redirects to /", async () => {
    const req = makeReq({ url: "/cdn-cgi/access/logout" });
    const res = makeRes();
    const result = await invoke({}, req, res);

    expect(result.nextCalled).toBe(false);
    expect(res.statusCode).toBe(302);
    expect(res._headers["location"]).toBe("/");
    expect(res._headers["set-cookie"]).toContain("Max-Age=0");
  });
});

// ---------------------------------------------------------------------------
// get-identity
// ---------------------------------------------------------------------------

describe("get-identity", () => {
  it("returns an Access-shaped identity for a valid session", async () => {
    const token = await signDevJwt("alice@example.com", { sub: "alice-uuid" });
    const req = makeReq({
      url: "/cdn-cgi/access/get-identity",
      headers: { cookie: COOKIE(token) }
    });
    const res = makeRes();
    await invoke({ users: [{ email: "alice@example.com", name: "Alice" }] }, req, res);

    expect(res.statusCode).toBe(200);
    expect(res._headers["content-type"]).toContain("application/json");
    const body = JSON.parse(res._body!);
    expect(body.email).toBe("alice@example.com");
    expect(body.name).toBe("Alice");
    expect(body.sub ?? body.user_uuid).toBe("alice-uuid");
    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.idp).toBeTruthy();
    expect(body.geo).toBeTruthy();
  });

  it("falls back to the email as the display name when no user matches", async () => {
    const token = await signDevJwt("nobody@example.com");
    const req = makeReq({
      url: "/cdn-cgi/access/get-identity",
      headers: { cookie: COOKIE(token) }
    });
    const res = makeRes();
    await invoke({}, req, res);
    const body = JSON.parse(res._body!);
    expect(body.name).toBe("nobody@example.com");
  });

  it("returns 401 when there is no session", async () => {
    const req = makeReq({ url: "/cdn-cgi/access/get-identity" });
    const res = makeRes();
    await invoke({}, req, res);
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Authenticated header injection
// ---------------------------------------------------------------------------

describe("authenticated request", () => {
  it("injects Access headers onto rawHeaders AND headers, then hands off", async () => {
    const token = await signDevJwt("alice@example.com");
    const req = makeReq({
      url: "/api/me",
      headers: { cookie: COOKIE(token), accept: "application/json" }
    });
    const res = makeRes();
    const result = await invoke({}, req, res);

    expect(result.nextCalled).toBe(true);

    // rawHeaders is what @cloudflare/vite-plugin reads.
    const rawIdx = req.rawHeaders.indexOf(JWT_HEADER);
    expect(rawIdx).toBeGreaterThanOrEqual(0);
    expect(req.rawHeaders[rawIdx + 1]).toBe(token);
    expect(req.rawHeaders).toContain(EMAIL_HEADER);

    // Parsed view kept consistent.
    expect(req.headers[JWT_HEADER]).toBe(token);
    expect(req.headers[EMAIL_HEADER]).toBe("alice@example.com");
  });

  it("treats an invalid cookie token as unauthenticated", async () => {
    const req = makeReq({
      url: "/",
      headers: { "cookie": COOKIE("not-a-jwt"), "sec-fetch-mode": "navigate" }
    });
    const res = makeRes();
    const result = await invoke({}, req, res);
    expect(result.nextCalled).toBe(false);
    expect(res.statusCode).toBe(302);
    expect(res._headers["location"]).toContain("/cdn-cgi/access/login");
  });
});

// ---------------------------------------------------------------------------
// Gating (unauthenticated)
// ---------------------------------------------------------------------------

describe("gating unauthenticated requests", () => {
  const policies: PathPolicy[] = [
    { pattern: /^\/api\/public/, authenticate: false },
    { pattern: /^\/api\//, authenticate: true, redirect: false },
    { pattern: /^\/dashboard/, authenticate: true }
  ];

  it("passes through explicitly public paths without injecting headers", async () => {
    const req = makeReq({ url: "/api/public/info", headers: { accept: "text/html" } });
    const res = makeRes();
    const result = await invoke({ policies }, req, res);
    expect(result.nextCalled).toBe(true);
    expect(req.headers[JWT_HEADER]).toBeUndefined();
  });

  it("returns 401 JSON for protected API routes (redirect: false)", async () => {
    const req = makeReq({ url: "/api/me", headers: { accept: "application/json" } });
    const res = makeRes();
    const result = await invoke({ policies }, req, res);
    expect(result.nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res._body!).error).toContain("Authentication required");
  });

  it("redirects protected navigations to the login form (Sec-Fetch-Mode)", async () => {
    const req = makeReq({ url: "/dashboard", headers: { "sec-fetch-mode": "navigate" } });
    const res = makeRes();
    await invoke({ policies }, req, res);
    expect(res.statusCode).toBe(302);
    expect(res._headers["location"]).toBe("/cdn-cgi/access/login?redirect=%2Fdashboard");
  });

  it("redirects protected navigations detected via Accept: text/html", async () => {
    const req = makeReq({ url: "/dashboard", headers: { accept: "text/html,*/*" } });
    const res = makeRes();
    await invoke({ policies }, req, res);
    expect(res.statusCode).toBe(302);
  });

  it("lets a non-navigation protected fetch through (Worker enforces 401)", async () => {
    // /dashboard is protected but redirect defaults to true; a fetch (no navigate, no
    // text/html) is neither redirected nor 401'd here.
    const req = makeReq({ url: "/dashboard", headers: { "sec-fetch-mode": "cors" } });
    const res = makeRes();
    const result = await invoke({ policies }, req, res);
    expect(result.nextCalled).toBe(true);
  });

  it("treats all paths as protected when no policies are given", async () => {
    const navReq = makeReq({ url: "/anything", headers: { "sec-fetch-mode": "navigate" } });
    const navRes = makeRes();
    await invoke({}, navReq, navRes);
    expect(navRes.statusCode).toBe(302);

    const fetchReq = makeReq({ url: "/anything", headers: { "sec-fetch-mode": "cors" } });
    const fetchRes = makeRes();
    const result = await invoke({}, fetchReq, fetchRes);
    expect(result.nextCalled).toBe(true);
  });

  it("does not treat a protected POST as a navigation (hands off to Worker)", async () => {
    const req = makeReq({
      url: "/dashboard",
      method: "POST",
      headers: { accept: "text/html" }
    });
    const res = makeRes();
    const result = await invoke({ policies }, req, res);
    expect(result.nextCalled).toBe(true);
  });

  it("handles array-valued request headers", async () => {
    const req = makeReq({ url: "/dashboard" });
    // Simulate Node delivering a repeated header as an array.
    (req.headers as Record<string, unknown>)["sec-fetch-mode"] = ["navigate"];
    const res = makeRes();
    await invoke({ policies }, req, res);
    expect(res.statusCode).toBe(302);
  });

  it("respects a custom loginPath", async () => {
    const req = makeReq({ url: "/secret", headers: { "sec-fetch-mode": "navigate" } });
    const res = makeRes();
    await invoke({ loginPath: "/login" }, req, res);
    expect(res._headers["location"]).toBe("/login?redirect=%2Fsecret");
  });

  it("does not treat a protected GET as a navigation when neither Sec-Fetch-Mode nor Accept is present", async () => {
    // No Sec-Fetch-Mode and no Accept header at all — isNavigation() must fall through its
    // `accept?.includes(...) ?? false` default without throwing, and treat the request as a
    // non-navigation (hands off to the Worker rather than redirecting).
    const req = makeReq({ url: "/dashboard" });
    const res = makeRes();
    const result = await invoke({ policies }, req, res);
    expect(result.nextCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Defensive fallback: a missing req.url
// ---------------------------------------------------------------------------

describe("defensive fallback for a missing req.url", () => {
  it("treats a missing req.url as the root pathname", async () => {
    // Node's IncomingMessage.url is typed `string | undefined`; a real connect middleware
    // stack should never see this in practice, but getPathname()/getQueryParam() defensively
    // fall back to "/" rather than throwing on `undefined.indexOf(...)`.
    const req = Readable.from([]) as unknown as IncomingMessage;
    req.url = undefined;
    req.method = "GET";
    req.headers = {};
    req.rawHeaders = [];
    const res = makeRes();

    // loginPath: "/" makes the missing-url fallback ("/") match the login route, so both
    // getPathname()'s and getQueryParam()'s `req.url ?? "/"` fallbacks are exercised in one
    // request.
    const result = await invoke({ loginPath: "/" }, req, res);

    expect(result.nextCalled).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res._body).toContain("Developer Login");
  });
});
