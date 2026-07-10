import { describe, expect, it } from "vitest";
import { Hono } from "hono";
// Deliberately imported from a plain `hono/http-exception` path, NOT through this package — this
// is what actually proves `hono` is external in the built `dist/hono/index.js` (tsup.config.ts).
// If `hono` were bundled instead, this `HTTPException` (the consumer's own copy) would fail an
// `instanceof` check against the one baked into our bundle, and this test would fail.
import { HTTPException } from "hono/http-exception";
import * as hono from "@adrianhall/cloudflare-toolkit/hono";
import { createCaptureTransport } from "@adrianhall/cloudflare-toolkit/logging";

describe("dist hono/index.js — exports", () => {
  it("exports problemDetailsErrorHandler as a function", () => {
    expect(typeof hono.problemDetailsErrorHandler).toBe("function");
  });

  it("exports notFoundHandler as a function", () => {
    expect(typeof hono.notFoundHandler).toBe("function");
  });

  it("exports cloudflareLogger as a function", () => {
    expect(typeof hono.cloudflareLogger).toBe("function");
  });

  it("exports cloudflareAccess as a function", () => {
    expect(typeof hono.cloudflareAccess).toBe("function");
  });

  it("exports exactly the documented runtime symbols", () => {
    expect(Object.keys(hono).sort()).toStrictEqual(
      [
        "problemDetailsErrorHandler",
        "notFoundHandler",
        "cloudflareLogger",
        "cloudflareAccess"
      ].sort()
    );
  });
});

describe("hono smoke test against the built dist/", () => {
  it("problemDetailsErrorHandler recognizes a plain-hono HTTPException at runtime (proves hono is external in dist/)", async () => {
    const app = new Hono();
    app.onError(hono.problemDetailsErrorHandler());
    app.get("/", () => {
      // Constructed from the plain `hono/http-exception` import above, not re-exported by this
      // package — exercising the `instanceof` mismatch that would occur if `hono` were bundled.
      throw new HTTPException(403, { message: "Forbidden" });
    });
    const res = await app.request("/");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { title: string; detail: string };
    expect(body.title).toBe("Forbidden");
    expect(body.detail).toBe("Forbidden");
  });

  it("notFoundHandler returns an RFC 9457 404 for an unmatched route", async () => {
    const app = new Hono();
    app.notFound(hono.notFoundHandler());
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { type: string; status: number; title: string };
    expect(body).toStrictEqual({ type: "about:blank", status: 404, title: "Not Found" });
  });

  it("cloudflareLogger sets c.get('LOGGER') and downstream handlers can log through it", async () => {
    const capture = createCaptureTransport();
    const app = new Hono();
    app.use(hono.cloudflareLogger({ transport: capture, level: "info" }));
    app.get("/", (c) => {
      const logger = c.get("LOGGER") as { info: (message: string) => void };
      logger.info("hello from dist");
      return c.text("ok");
    });

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(capture.records).toHaveLength(1);
    expect(capture.records[0]?.message).toBe("hello from dist");
  });

  it("cloudflareAccess blocks a request with no token by default (defaultAction: block)", async () => {
    const app = new Hono();
    app.use(hono.cloudflareAccess());
    app.get("/", (c) => c.json({ email: c.get("userEmail") ?? null }));

    // No JWT provided at all — defaultAction defaults to "block", so this is a 401, proving the
    // middleware from dist/ is wired and enforcing auth, not silently passing every request.
    const res = await app.request("/");
    expect(res.status).toBe(401);
  });

  it("cloudflareAccess bypasses a public path via policies without requiring a token", async () => {
    const app = new Hono();
    app.use(hono.cloudflareAccess({ policies: [{ pattern: /^\/public$/, authenticate: false }] }));
    app.get("/public", (c) => c.text("ok"));

    const res = await app.request("/public");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
