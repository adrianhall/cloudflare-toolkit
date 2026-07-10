// Package-level export validation for `@adrianhall/cloudflare-toolkit/logging` (docs/SPECv2.md
// §5.1, §7.2). Imports the built package by name/subpath resolution against `dist/`, not a
// relative path — see guards.test.ts for why.
//
// The type-only exports (`Logger`, `LogLevel`, `Transport`, etc. — docs/SPECv2.md §5.1) have no
// runtime representation and are not asserted here.
import { describe, expect, it } from "vitest";
import * as logging from "@adrianhall/cloudflare-toolkit/logging";

const RUNTIME_EXPORTS = [
  "createLogger",
  "resolveLoggerConfig",
  "serializeError",
  "createBrowserTransport",
  "createCaptureTransport",
  "combineTransports",
  "createConsoleTransport",
  "createSilentTransport",
  "createStructuredTransport"
] as const;

describe("dist logging/index.js — exports", () => {
  it.each(RUNTIME_EXPORTS)("exports %s as a function", (name) => {
    expect(typeof logging[name]).toBe("function");
  });

  it("exports exactly the documented runtime symbols", () => {
    expect(Object.keys(logging).sort()).toStrictEqual([...RUNTIME_EXPORTS].sort());
  });
});

describe("logging smoke test against the built dist/", () => {
  it("createLogger() returns a Logger with the documented interface", () => {
    const transport = logging.createSilentTransport();
    const logger = logging.createLogger({ transport });
    expect(typeof logger.trace).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.fatal).toBe("function");
    expect(typeof logger.child).toBe("function");
    expect(typeof logger.isLevelEnabled).toBe("function");
    expect(logger.level).toBe("info");
  });

  it("createCaptureTransport() captures records emitted through createLogger()", () => {
    const capture = logging.createCaptureTransport();
    const logger = logging.createLogger({ transport: capture });
    logger.info("hello from dist");
    expect(capture.records).toHaveLength(1);
    expect(capture.records[0]?.message).toBe("hello from dist");
    expect(capture.records[0]?.level).toBe("info");
  });

  it("resolveLoggerConfig() maps environment/runtime to a level and transport", () => {
    const config = logging.resolveLoggerConfig("test", "worker");
    expect(config.level).toBe("trace");
    expect(typeof config.transport.log).toBe("function");
  });

  it("serializeError() converts an Error to a plain, JSON-safe object", () => {
    const result = logging.serializeError(new Error("boom"));
    expect(result).not.toBeInstanceOf(Error);
    expect((result as Record<string, unknown>)["message"]).toBe("boom");
  });

  it("combineTransports() fans a record out to every underlying transport", () => {
    const a = logging.createCaptureTransport();
    const b = logging.createCaptureTransport();
    const combined = logging.combineTransports(a, b);
    combined.log({
      time: new Date().toISOString(),
      level: "info",
      levelValue: 30,
      message: "fan-out",
      context: {}
    });
    expect(a.records).toHaveLength(1);
    expect(b.records).toHaveLength(1);
  });
});
