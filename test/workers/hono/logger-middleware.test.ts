// Adapted from adrianhall/cloudflare-logger's test/workers/hono.test.ts (MIT) — see
// THIRD-PARTY-NOTICES.md — narrowed to this toolkit's scope for `cloudflareLogger`
// (docs/SPECv2.md §5.5): only the `LOGGER` context-variable wiring and `resolveLoggerConfig`
// resolution are covered here, since the automatic request/response trace logging,
// correlation-id derivation, and header-redaction behavior from upstream are deliberately not
// ported (see logger-middleware.ts). Runs under workerd (@cloudflare/vitest-pool-workers,
// docs/SPECv2.md §7.2) against a bare `Hono` instance wired exactly as a real consumer would —
// `app.use(cloudflareLogger(options))` — with no dependency on `cloudflareAccess`.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { cloudflareLogger } from "../../../src/lib/hono/logger-middleware.js";
import type { LoggerVariables } from "../../../src/lib/hono/types.js";
import { createCaptureTransport } from "../../../src/lib/logging/transports/capture.js";

type LoggerEnv = { Bindings: { ENVIRONMENT?: string }; Variables: LoggerVariables };

describe("cloudflareLogger", () => {
  it("sets c.get('LOGGER') to a usable Logger for downstream handlers", async () => {
    const app = new Hono<LoggerEnv>();
    let loggerIsUsable = false;
    app.use(cloudflareLogger());
    app.get("/", (c) => {
      const logger = c.get("LOGGER");
      loggerIsUsable = typeof logger.info === "function";
      return c.text("ok");
    });

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(loggerIsUsable).toBe(true);
  });

  it("is independently wireable — works with no other middleware and no arguments", async () => {
    const app = new Hono();
    app.use(cloudflareLogger());
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("a downstream handler can read the injected logger and emit records through it", async () => {
    const capture = createCaptureTransport();
    const app = new Hono<LoggerEnv>();
    app.use(cloudflareLogger({ transport: capture, level: "info" }));
    app.get("/", (c) => {
      c.get("LOGGER").info("handling request", { route: "/" });
      return c.text("ok");
    });

    const res = await app.request("/");
    expect(res.status).toBe(200);

    const records = capture.find("info");
    expect(records).toHaveLength(1);
    expect(records[0]?.message).toBe("handling request");
    expect(records[0]?.context["route"]).toBe("/");
  });

  it("resolves level/transport from resolveLoggerConfig(environment, 'worker') via options.environment", async () => {
    const app = new Hono<LoggerEnv>();
    app.use(cloudflareLogger({ environment: "test" }));
    app.get("/", (c) => {
      // resolveLoggerConfig("test", "worker") => { level: "trace", transport: capture }, so a
      // trace-level record must not be dropped.
      const logger = c.get("LOGGER");
      return c.json({ level: logger.level, traceEnabled: logger.isLevelEnabled("trace") });
    });

    const res = await app.request("/");
    const body = await res.json();
    expect(body).toStrictEqual({ level: "trace", traceEnabled: true });
  });

  it("resolves the environment from c.env.ENVIRONMENT when options.environment is omitted", async () => {
    const app = new Hono<LoggerEnv>();
    app.use(cloudflareLogger());
    app.get("/", (c) => c.json({ level: c.get("LOGGER").level }));

    const res = await app.request("/", {}, { ENVIRONMENT: "test" });
    const body = await res.json();
    // resolveLoggerConfig("test", "worker") => level "trace".
    expect(body).toStrictEqual({ level: "trace" });
  });

  it("options.environment takes precedence over c.env.ENVIRONMENT", async () => {
    const app = new Hono<LoggerEnv>();
    app.use(cloudflareLogger({ environment: "test" }));
    app.get("/", (c) => c.json({ level: c.get("LOGGER").level }));

    const res = await app.request("/", {}, { ENVIRONMENT: "production" });
    const body = await res.json();
    expect(body).toStrictEqual({ level: "trace" });
  });

  it("defaults to production behavior when neither options.environment nor c.env.ENVIRONMENT is set", async () => {
    const app = new Hono<LoggerEnv>();
    app.use(cloudflareLogger());
    app.get("/", (c) => c.json({ level: c.get("LOGGER").level }));

    const res = await app.request("/");
    const body = await res.json();
    // resolveLoggerConfig(undefined, "worker") => production defaults => level "warn".
    expect(body).toStrictEqual({ level: "warn" });
  });

  it("options.level and options.transport override resolveLoggerConfig's own choices", async () => {
    const capture = createCaptureTransport();
    const app = new Hono<LoggerEnv>();
    // environment "test" would normally resolve to level "trace" + a fresh capture transport;
    // both are overridden here.
    app.use(cloudflareLogger({ environment: "test", level: "warn", transport: capture }));
    app.get("/", (c) => {
      const logger = c.get("LOGGER");
      logger.info("suppressed"); // below the overridden "warn" level
      logger.warn("kept");
      return c.json({ level: logger.level });
    });

    const res = await app.request("/");
    const body = await res.json();
    expect(body).toStrictEqual({ level: "warn" });
    expect(capture.find("info")).toHaveLength(0);
    expect(capture.find("warn")).toHaveLength(1);
  });
});
