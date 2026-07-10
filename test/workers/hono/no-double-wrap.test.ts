// docs/SPECv2.md §7.4's specific risk area: `problemDetailsErrorHandler` and `notFoundHandler`
// must not double-wrap a single request. Both are wired independently on a bare `Hono` instance
// exactly as a real consumer would (docs/SPECv2.md §5.5) — `app.onError()`/`app.notFound()` are
// distinct Hono hooks with no combined/coordinator middleware between them.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { problemDetailsErrorHandler } from "../../../src/lib/hono/error-handler.js";
import { notFoundHandler } from "../../../src/lib/hono/not-found-handler.js";

const SHARED_OPTIONS = { typePrefix: "https://api.example.com/problems", autoInstance: true };

function createApp() {
  const app = new Hono();
  app.onError(problemDetailsErrorHandler(SHARED_OPTIONS));
  app.notFound(notFoundHandler(SHARED_OPTIONS));
  return app;
}

describe("problemDetailsErrorHandler + notFoundHandler wired together", () => {
  it("an unmatched route goes through notFoundHandler only, not onError", async () => {
    const app = createApp();
    // No routes registered at all — app.notFound() must be the only path that can produce a
    // response for this request. If onError somehow ran too (double-wrap), the response would
    // still be well-formed (both build the same problem+json shape), so the strongest possible
    // check is an exact-shape comparison against notFoundHandler wired completely alone below,
    // plus the sanity check that a matched route is unaffected by app.notFound() at all.
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toStrictEqual({
      type: "https://api.example.com/problems/not-found",
      status: 404,
      title: "Not Found",
      instance: "/does-not-exist"
    });
  });

  it("a matched route that throws goes through onError only, not notFound", async () => {
    const app = createApp();
    app.get("/boom", () => {
      throw new Error("boom");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const body = await res.json();
    // A 500 body proves onError ran; notFoundHandler can only ever produce a 404, so this shape
    // is unreachable from that hook.
    expect(body.title).toBe("Internal Server Error");
  });

  it("produces the exact same shape as notFoundHandler wired completely alone", async () => {
    const combinedApp = createApp();
    const notFoundOnlyApp = new Hono();
    notFoundOnlyApp.notFound(notFoundHandler(SHARED_OPTIONS));

    const combinedRes = await combinedApp.request("/does-not-exist");
    const notFoundOnlyRes = await notFoundOnlyApp.request("/does-not-exist");

    expect(await combinedRes.json()).toStrictEqual(await notFoundOnlyRes.json());
    expect(combinedRes.status).toBe(notFoundOnlyRes.status);
  });

  it("notFoundHandler and a thrown 404 HTTPException through problemDetailsErrorHandler agree on type/title conventions", async () => {
    // Two independent codepaths for a 404: (1) app.notFound() firing for an unmatched route, and
    // (2) a matched route throwing a 404 HTTPException through onError. Neither one invokes the
    // other (no double-wrap), but — per docs/SPECv2.md §7.4 — they must still agree on
    // `type`/`title` conventions (`typePrefix`, `autoInstance`) so a consumer sees a consistent
    // RFC 9457 shape for "not found" regardless of which path produced it. (A thrown
    // `ProblemDetailsError` from the `notFound()` generator is deliberately not used here: per
    // upstream's own H31 case, `typePrefix` never overrides a `ProblemDetailsError`'s already-
    // normalized `type` — only the `HTTPException`/fallback paths apply `buildType`, which is
    // the actual mechanism both handlers need to agree on.)
    const viaNotFoundHook = new Hono();
    viaNotFoundHook.notFound(notFoundHandler(SHARED_OPTIONS));
    const hookRes = await viaNotFoundHook.request("/orders/123");
    const hookBody = await hookRes.json();

    const viaThrow = new Hono();
    viaThrow.onError(problemDetailsErrorHandler(SHARED_OPTIONS));
    viaThrow.get("/orders/:id", () => {
      throw new HTTPException(404);
    });
    const throwRes = await viaThrow.request("/orders/123");
    const throwBody = await throwRes.json();

    expect(hookRes.status).toBe(throwRes.status);
    expect(hookBody.type).toBe(throwBody.type);
    expect(hookBody.title).toBe(throwBody.title);
    expect(hookBody.instance).toBe(throwBody.instance);
  });
});
