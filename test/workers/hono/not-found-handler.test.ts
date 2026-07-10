// Toolkit-authored — no upstream equivalent to adapt from (docs/SPECv2.md §5.5). Runs under
// workerd (@cloudflare/vitest-pool-workers, docs/SPECv2.md §7.2) against a bare `Hono` instance
// wired exactly as a real consumer would: `app.notFound(notFoundHandler(options))`.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { notFoundHandler } from "../../../src/lib/hono/not-found-handler.js";

function createApp(options?: Parameters<typeof notFoundHandler>[0]) {
  const app = new Hono();
  app.notFound(notFoundHandler(options));
  return app;
}

describe("notFoundHandler", () => {
  it("returns a 404 with an RFC 9457 problem-details body", async () => {
    const app = createApp();
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json; charset=utf-8");
    const body = await res.json();
    expect(body).toStrictEqual({
      type: "about:blank",
      status: 404,
      title: "Not Found"
    });
  });

  it("does not fire for a matched route", async () => {
    const app = createApp();
    app.get("/orders/:id", (c) => c.text("ok"));
    const res = await app.request("/orders/123");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("uses typePrefix to build the type URI", async () => {
    const app = createApp({ typePrefix: "https://api.example.com/problems" });
    const res = await app.request("/does-not-exist");
    const body = await res.json();
    expect(body.type).toBe("https://api.example.com/problems/not-found");
  });

  it("uses about:blank when typePrefix is not set", async () => {
    const app = createApp();
    const res = await app.request("/does-not-exist");
    const body = await res.json();
    expect(body.type).toBe("about:blank");
  });

  it("uses defaultType when set and typePrefix is not", async () => {
    const app = createApp({ defaultType: "https://example.com/default" });
    const res = await app.request("/does-not-exist");
    const body = await res.json();
    expect(body.type).toBe("https://example.com/default");
  });

  it("defaults autoInstance to off: no instance is populated", async () => {
    const app = createApp();
    const res = await app.request("/does-not-exist");
    const body = await res.json();
    expect(body.instance).toBeUndefined();
  });

  it("populates instance from the request path when autoInstance is enabled", async () => {
    const app = createApp({ autoInstance: true });
    const res = await app.request("/orders/123");
    const body = await res.json();
    expect(body.instance).toBe("/orders/123");
  });
});
