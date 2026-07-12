import { describe, expect, it, vi } from "vitest";
import { createBrowserTransport } from "../../../../src/lib/logging/index.js";
import type { ConsoleLike } from "../../../../src/lib/logging/internal/console.js";
import type { LogLevel, LogRecord } from "../../../../src/lib/logging/index.js";

/** Build a minimal LogRecord for testing. */
function makeRecord(overrides?: Partial<LogRecord>): LogRecord {
  return {
    time: "2026-01-01T00:00:00.000Z",
    level: "info",
    levelValue: 30,
    message: "hello",
    context: {},
    ...overrides
  };
}

/** Create a spy console capturing all method calls. */
function makeConsoleSpy() {
  const calls: Record<string, unknown[][]> = {
    debug: [],
    info: [],
    log: [],
    warn: [],
    error: []
  };
  const c: ConsoleLike = {
    debug: vi.fn((...args: unknown[]) => calls.debug.push(args)),
    info: vi.fn((...args: unknown[]) => calls.info.push(args)),
    log: vi.fn((...args: unknown[]) => calls.log.push(args)),
    warn: vi.fn((...args: unknown[]) => calls.warn.push(args)),
    error: vi.fn((...args: unknown[]) => calls.error.push(args))
  };
  return { c, calls };
}

describe("createBrowserTransport()", () => {
  describe("level-to-method mapping", () => {
    const ROUTING: [LogLevel, string][] = [
      ["trace", "debug"],
      ["debug", "debug"],
      ["info", "info"],
      ["warn", "warn"],
      ["error", "error"],
      ["fatal", "error"]
    ];

    for (const [level, method] of ROUTING) {
      it(`routes '${level}' to console.${method}`, () => {
        const { c, calls } = makeConsoleSpy();
        const transport = createBrowserTransport(undefined, c);
        transport.log(makeRecord({ level }));
        expect(calls[method]).toHaveLength(1);
        for (const [m, recorded] of Object.entries(calls)) {
          if (m !== method) {
            expect(recorded, `unexpected call to console.${m}`).toHaveLength(0);
          }
        }
      });
    }
  });

  describe("badge call shape", () => {
    it("first argument is %cLEVEL string", () => {
      const { c, calls } = makeConsoleSpy();
      const transport = createBrowserTransport(undefined, c);
      transport.log(makeRecord({ level: "info" }));
      const args = calls.info[0];
      expect(args[0]).toBe("%cINFO");
    });

    it("second argument is a CSS style string", () => {
      const { c, calls } = makeConsoleSpy();
      const transport = createBrowserTransport(undefined, c);
      transport.log(makeRecord({ level: "info" }));
      const args = calls.info[0];
      expect(typeof args[1]).toBe("string");
      expect(args[1] as string).toBeTruthy();
    });

    it("third argument is the message", () => {
      const { c, calls } = makeConsoleSpy();
      const transport = createBrowserTransport(undefined, c);
      transport.log(makeRecord({ level: "info", message: "user loaded" }));
      const args = calls.info[0];
      expect(args[2]).toBe("user loaded");
    });
  });

  describe("context argument", () => {
    it("passes context as fourth argument when non-empty", () => {
      const { c, calls } = makeConsoleSpy();
      const transport = createBrowserTransport(undefined, c);
      const ctx = { userId: "123" };
      transport.log(makeRecord({ level: "info", context: ctx }));
      const args = calls.info[0];
      expect(args).toHaveLength(4);
      expect(args[3]).toBe(ctx);
    });

    it("omits context argument when context is empty", () => {
      const { c, calls } = makeConsoleSpy();
      const transport = createBrowserTransport(undefined, c);
      transport.log(makeRecord({ level: "info", context: {} }));
      const args = calls.info[0];
      expect(args).toHaveLength(3);
    });
  });

  describe("style override", () => {
    it("uses the provided style override for the specified level", () => {
      const CUSTOM_STYLE = "color: purple; font-size: 16px";
      const { c, calls } = makeConsoleSpy();
      const transport = createBrowserTransport({ levelStyles: { info: CUSTOM_STYLE } }, c);
      transport.log(makeRecord({ level: "info" }));
      const args = calls.info[0];
      expect(args[1]).toBe(CUSTOM_STYLE);
    });

    it("uses default style for levels not in the override map", () => {
      const { c: c1, calls: calls1 } = makeConsoleSpy();
      const { c: c2, calls: calls2 } = makeConsoleSpy();
      const transportWithOverride = createBrowserTransport(
        { levelStyles: { warn: "color: orange" } },
        c1
      );
      const transportDefault = createBrowserTransport(undefined, c2);

      const record = makeRecord({ level: "info" });
      transportWithOverride.log(record);
      transportDefault.log(record);

      const style1 = calls1.info[0][1];
      const style2 = calls2.info[0][1];
      expect(style1).toBe(style2);
    });
  });

  describe("missing method fallback", () => {
    it("falls back to console.log when the preferred method is absent", () => {
      const logCalls: unknown[][] = [];
      const c: ConsoleLike = {
        log: vi.fn((...args: unknown[]) => logCalls.push(args))
        // debug is intentionally omitted
      };
      const transport = createBrowserTransport(undefined, c);
      transport.log(makeRecord({ level: "trace" })); // trace → debug → fallback to log
      expect(logCalls).toHaveLength(1);
      expect(logCalls[0][0]).toBe("%cTRACE");
    });
  });

  describe("default console parameter", () => {
    it("uses the global console when no _console argument is supplied", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
      try {
        const transport = createBrowserTransport();
        transport.log(makeRecord({ level: "info" }));
        expect(spy).toHaveBeenCalledOnce();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("level badge text", () => {
    const BADGES: [LogLevel, string][] = [
      ["trace", "%cTRACE"],
      ["debug", "%cDEBUG"],
      ["info", "%cINFO"],
      ["warn", "%cWARN"],
      ["error", "%cERROR"],
      ["fatal", "%cFATAL"]
    ];

    for (const [level, badge] of BADGES) {
      it(`emits badge '${badge}' for level '${level}'`, () => {
        const { c, calls } = makeConsoleSpy();
        const transport = createBrowserTransport(undefined, c);
        transport.log(makeRecord({ level }));
        const methodName =
          ["trace", "debug"].includes(level) ? "debug"
          : level === "info" ? "info"
          : level === "warn" ? "warn"
          : "error";
        const args = calls[methodName][0];
        expect(args[0]).toBe(badge);
      });
    }
  });
});
