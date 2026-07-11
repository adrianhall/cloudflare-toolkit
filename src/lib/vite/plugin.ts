/**
 * @file `cloudflareAccessPlugin` — a dev-only Vite plugin that emulates the Cloudflare Access
 * edge in front of `@cloudflare/vite-plugin`. In production, Cloudflare Access sits at the edge
 * and injects the `Cf-Access-Jwt-Assertion` header (and friends) into every request before it
 * reaches the Worker; during `vite dev` there is no Access in the loop. This plugin reproduces
 * that behavior at the Vite connect layer so the Worker can keep only the production
 * `cloudflareAccess` middleware (../hono/cloudflare-access.ts) — no separate dev-authentication
 * middleware, no `run_worker_first`.
 *
 * Built on this toolkit's own `auth-internal` module for the shared JWT/JWKS/policy primitives
 * — the same `matchPolicy`/`signDevJwt`/`verifyDevJwt`/`parseCookie`/`buildCookieHeader`/
 * `clearCookieHeader`/`DEFAULT_DEV_SECRET`/`JWT_HEADER`/`EMAIL_HEADER` that
 * `hono/cloudflare-access.ts` also consumes — so a session created here is accepted there
 * without any duplicated verification logic (proved end-to-end in
 * `test/node/vite/handshake.test.ts`).
 *
 * Also depends on `../errors/generators.js` (`contentTooLarge`) and
 * `../problem-details/error.js` (`ProblemDetailsError`) so an oversized login-form POST body
 * (see `readFormBody`) is rejected with a standard `application/problem+json` response, the same
 * shape every other error in this toolkit produces — CODE-008.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import {
  buildCookieHeader,
  clearCookieHeader,
  DEFAULT_DEV_SECRET,
  EMAIL_HEADER,
  JWT_HEADER,
  parseCookie,
  signDevJwt,
  verifyDevJwt
} from "../auth-internal/jwt.js";
import { matchPolicy } from "../auth-internal/policy.js";
import type { PathPolicy } from "../auth-internal/types.js";
import { contentTooLarge } from "../errors/generators.js";
import { ProblemDetailsError } from "../problem-details/error.js";
import { renderViteLoginPage, type DevLoginUser } from "./login-page.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_LOGIN_PATH = "/cdn-cgi/access/login";
const LOGOUT_PATH = "/cdn-cgi/access/logout";
const GET_IDENTITY_PATH = "/cdn-cgi/access/get-identity";

/**
 * Path prefixes that belong to Vite's own internals (or asset requests) and must always pass
 * through untouched.
 */
const VITE_INTERNAL_PREFIXES = [
  "/@vite",
  "/@fs",
  "/@id",
  "/@react-refresh",
  "/node_modules/",
  "/__vite",
  "/src/"
];

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Configuration for {@link cloudflareAccessPlugin}. */
export interface CloudflareAccessPluginOptions {
  /**
   * Path policies evaluated in order (first match wins).
   *
   * Pass the **same array** you give to `cloudflareAccess` in the Worker
   * (../hono/cloudflare-access.ts) so dev and prod agree on which paths are protected.
   *
   * - `authenticate: false` — public (no gating, no header injection).
   * - `authenticate: true` — protected. Unauthenticated navigations are redirected to the login
   *   form; API routes with `redirect: false` receive a 401.
   *
   * When omitted, **all** non-internal paths are treated as protected.
   */
  policies?: PathPolicy[];

  /**
   * HMAC secret used to sign the dev JWT.
   *
   * Must match the `devSecret` passed to `cloudflareAccess` in the Worker (if overridden there).
   * Defaults to the same well-known development key.
   */
  devSecret?: string;

  /**
   * Selectable identities rendered on the dev login form. When omitted the form shows a single
   * free-text email input.
   */
  users?: DevLoginUser[];

  /** Pathname for the login form (default `"/cdn-cgi/access/login"`). */
  loginPath?: string;

  /** Dev JWT lifetime in seconds (default `86400` / 24 h). */
  tokenLifetime?: number;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create the dev-only Cloudflare Access emulation plugin.
 *
 * Register it **before** `@cloudflare/vite-plugin` (and any framework plugin) so its connect
 * middleware runs first:
 *
 * ```ts
 * plugins: [cloudflareAccessPlugin(), cloudflare(), react()]
 * ```
 *
 * The middleware is registered synchronously in the `configureServer` hook body (combined with
 * `enforce: "pre"`) so that it sits ahead of the request → `workerd` dispatch handler that
 * `@cloudflare/vite-plugin` registers from its post hook.
 *
 * @param options - Configuration for path policies, the dev secret, selectable login identities,
 *   the login form path, and the dev token lifetime.
 * @returns A Vite `Plugin`.
 */
export function cloudflareAccessPlugin(options: CloudflareAccessPluginOptions = {}): Plugin {
  return {
    name: "cloudflare-access-dev",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(createAccessDevMiddleware(options));
    }
  };
}

// ---------------------------------------------------------------------------
// Connect middleware
// ---------------------------------------------------------------------------

/**
 * Build the connect middleware that emulates Cloudflare Access.
 *
 * Exported separately so it can be unit-tested with mock `req`/`res` objects without booting a
 * real Vite server.
 *
 * @param options - Same options accepted by {@link cloudflareAccessPlugin}.
 * @returns A Vite `Connect.NextHandleFunction`.
 */
export function createAccessDevMiddleware(
  options: CloudflareAccessPluginOptions = {}
): Connect.NextHandleFunction {
  const policies = options.policies;
  const devSecret = options.devSecret ?? DEFAULT_DEV_SECRET;
  const users = options.users ?? [];
  const loginPath = options.loginPath ?? DEFAULT_LOGIN_PATH;
  const tokenLifetime = options.tokenLifetime;

  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction): void => {
    void handle(req, res, next).catch((err) => next(err as Error));
  };

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction
  ): Promise<void> {
    const pathname = getPathname(req);

    // 1. Vite internals / asset requests → always pass through.
    if (isViteInternal(pathname)) {
      return next();
    }

    // 2. Own the Cloudflare Access edge endpoints.
    if (pathname === loginPath) {
      if (req.method === "POST") {
        return handleLoginSubmit(req, res);
      }
      return serveLoginForm(req, res);
    }
    if (pathname === LOGOUT_PATH) {
      return handleLogout(res);
    }
    if (pathname === GET_IDENTITY_PATH) {
      return handleGetIdentity(req, res);
    }

    // 3. Authenticated session → inject Access headers and hand off.
    const token = parseCookie(req.headers.cookie);
    const verified = token ? await verifyDevJwt(token, devSecret) : null;
    if (token && verified) {
      injectAccessHeaders(req, token, verified.email);
      return next();
    }

    // 4. Unauthenticated. Decide based on policy + request type.
    const policyMatch = policies ? matchPolicy(pathname, policies) : undefined;

    // Explicitly public → pass through (no gating, no injection).
    if (policyMatch?.authenticate === false) {
      return next();
    }

    // API-style protected route (redirect: false) → 401 JSON.
    if (policyMatch?.authenticate === true && policyMatch.redirect === false) {
      return sendJson(res, 401, { error: "Authentication required" });
    }

    // HTML navigations to protected paths → redirect to the login form.
    if (isNavigation(req)) {
      return redirectToLogin(res, loginPath, pathname);
    }

    // Anything else (e.g. an unauthenticated fetch to a protected API that did not opt into
    // `redirect: false`) → let it through; the Worker's own cloudflareAccess() will reject it
    // with a 401.
    return next();
  }

  // -------------------------------------------------------------------------
  // Endpoint handlers
  // -------------------------------------------------------------------------

  function serveLoginForm(req: IncomingMessage, res: ServerResponse): void {
    const redirect = sanitizeRedirectTarget(getQueryParam(req, "redirect") ?? "/");
    sendHtml(res, 200, renderViteLoginPage(loginPath, redirect, users));
  }

  async function handleLoginSubmit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: Record<string, string>;
    try {
      body = await readFormBody(req);
    } catch (err) {
      if (err instanceof ProblemDetailsError) {
        await sendProblemDetails(res, err);
        return;
      }
      throw err;
    }
    const custom = typeof body["custom-email"] === "string" ? body["custom-email"].trim() : "";
    const selected = typeof body.email === "string" ? body.email.trim() : "";
    const email = custom || selected;
    const redirect = sanitizeRedirectTarget(
      typeof body.redirect === "string" && body.redirect ? body.redirect : "/"
    );

    if (!email) {
      sendHtml(
        res,
        400,
        renderViteLoginPage(loginPath, redirect, users, "A valid email address is required.")
      );
      return;
    }

    // Pin the subject for a configured identity (stable, realistic sub); free-text / unknown
    // emails fall back to a generated UUID.
    const sub = users.find((u) => u.email === email)?.sub;
    const token = await signDevJwt(email, { secret: devSecret, lifetime: tokenLifetime, sub });
    res.setHeader("Set-Cookie", buildCookieHeader(token, isSecure(req)));
    redirectTo(res, redirect);
  }

  function handleLogout(res: ServerResponse): void {
    res.setHeader("Set-Cookie", clearCookieHeader());
    redirectTo(res, "/");
  }

  async function handleGetIdentity(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = parseCookie(req.headers.cookie);
    const verified = token ? await verifyDevJwt(token, devSecret) : null;
    if (!verified) {
      sendJson(res, 401, { error: "Authentication required" });
      return;
    }
    const display = users.find((u) => u.email === verified.email)?.name;
    sendJson(res, 200, buildIdentity(verified.email, verified.sub, display));
  }

  // -------------------------------------------------------------------------
  // Header injection
  // -------------------------------------------------------------------------

  /**
   * Inject the Cloudflare Access headers so the request reaches the Worker authenticated.
   *
   * `@cloudflare/vite-plugin` builds the `Request` it dispatches into `workerd` from
   * `req.rawHeaders` (not the parsed `req.headers` object), so the JWT **must** be pushed onto
   * `rawHeaders`. We also mirror it onto `req.headers` so other connect middleware observe a
   * consistent view.
   */
  function injectAccessHeaders(req: IncomingMessage, token: string, email: string): void {
    req.rawHeaders.push(JWT_HEADER, token, EMAIL_HEADER, email);
    req.headers[JWT_HEADER] = token;
    req.headers[EMAIL_HEADER] = email;
  }
}

// ---------------------------------------------------------------------------
// Identity payload
// ---------------------------------------------------------------------------

/**
 * Build a Cloudflare-Access-shaped identity object for the `get-identity` endpoint. Mirrors the
 * real response closely enough for client code that reads `email`, `name`, `groups`, etc.
 *
 * @param email - Authenticated user's email.
 * @param sub - Authenticated user's subject identifier.
 * @param name - Optional display name; falls back to `email` when omitted.
 * @returns A Cloudflare-Access-shaped identity object.
 */
function buildIdentity(email: string, sub: string, name?: string): Record<string, unknown> {
  return {
    id: sub,
    name: name ?? email,
    email,
    user_uuid: sub,
    account_id: "dev-account",
    iat: Math.floor(Date.now() / 1000),
    groups: [],
    idp: { id: "dev", type: "dev-authentication" },
    geo: { country: "US" },
    type: "dev"
  };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function getPathname(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const queryIndex = raw.indexOf("?");
  return queryIndex === -1 ? raw : raw.slice(0, queryIndex);
}

function getQueryParam(req: IncomingMessage, key: string): string | undefined {
  const path = req.url ?? "/";
  const url = new URL(path, "http://localhost");
  return url.searchParams.get(key) ?? undefined;
}

/**
 * Restrict a client-supplied `redirect` target (the dev login form's query string / POST body
 * field) to a same-origin, root-relative path — SEC-005
 * (https://github.com/adrianhall/cloudflare-toolkit/issues/50).
 *
 * Only a value starting with a single `/` — not `//` or `/\`, both of which a browser can
 * interpret as protocol-relative / scheme-relative and resolve against an attacker-controlled
 * host — is considered safe. Anything else (an absolute URL, a protocol-relative URL, or any
 * other unexpected value) falls back to `"/"`. Applied at both points a client-supplied
 * `redirect` value is read (the login form's query string and the login submission's POST body)
 * so the sanitized value is what flows into both the login form's hidden field and the actual
 * redirect `Location` header.
 */
function sanitizeRedirectTarget(value: string): string {
  return /^\/(?!\/|\\)/.test(value) ? value : "/";
}

function isViteInternal(pathname: string): boolean {
  return VITE_INTERNAL_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * A request is treated as an HTML navigation when the browser flags it as such
 * (`Sec-Fetch-Mode: navigate`) or it accepts `text/html`.
 */
function isNavigation(req: IncomingMessage): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }
  const fetchMode = headerValue(req, "sec-fetch-mode");
  if (fetchMode) {
    return fetchMode === "navigate";
  }
  const accept = headerValue(req, "accept");
  return accept?.includes("text/html") ?? false;
}

function isSecure(req: IncomingMessage): boolean {
  // The Vite dev server runs over plain HTTP on localhost; treat HTTPS forwarding hints as
  // secure so the cookie's Secure flag is correct.
  return headerValue(req, "x-forwarded-proto") === "https";
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value ?? undefined;
}

/**
 * Maximum accumulated size, in bytes, accepted for the dev login form's
 * `application/x-www-form-urlencoded` POST body by {@link readFormBody}. The form only ever
 * posts a handful of small fields (`email`, `custom-email`, `redirect`), so 64 KiB is a generous
 * safety cap against an unbounded read — not a real-world limit — see CODE-008.
 */
const MAX_FORM_BODY_BYTES = 64 * 1024;

/**
 * Read and parse an `application/x-www-form-urlencoded` request body, capped at
 * {@link MAX_FORM_BODY_BYTES}. Rejects with a `413 Content Too Large`
 * {@link ProblemDetailsError} (via `contentTooLarge`) once the cap is exceeded, after destroying
 * the underlying stream so no further data is buffered.
 */
function readFormBody(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    req.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_FORM_BODY_BYTES) {
        req.destroy();
        reject(
          contentTooLarge({
            detail: `The request body exceeded the maximum allowed size of ${MAX_FORM_BODY_BYTES} bytes.`
          })
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const params = new URLSearchParams(raw);
      const out: Record<string, string> = {};
      for (const [key, value] of params) {
        out[key] = value;
      }
      resolve(out);
    });
  });
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function redirectTo(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

/**
 * Write a {@link ProblemDetailsError}'s standalone `application/problem+json` {@link Response}
 * (`error.getResponse()`) onto a raw Node `ServerResponse`. This connect middleware has no Hono
 * `Context` to hand the error to, so the Web `Response` it produces is adapted by hand here
 * rather than reusing `problemDetailsErrorHandler` (`@adrianhall/cloudflare-toolkit/hono`).
 */
async function sendProblemDetails(res: ServerResponse, error: ProblemDetailsError): Promise<void> {
  const response = error.getResponse();
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(await response.text());
}

function redirectToLogin(res: ServerResponse, loginPath: string, pathname: string): void {
  redirectTo(res, `${loginPath}?redirect=${encodeURIComponent(pathname)}`);
}
