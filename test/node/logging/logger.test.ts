import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../src/lib/logging/index.js";
import type { LogRecord, Transport } from "../../../src/lib/logging/index.js";

/** Fixed clock for deterministic timestamp assertions. */
const FIXED_TIME = "2026-01-01T00:00:00.000Z";
const clock = () => new Date(FIXED_TIME);

/** Build a capture transport and return it alongside a helper. */
function makeCapture() {
  const records: LogRecord[] = [];
  const transport: Transport = {
    log(record: LogRecord) {
      records.push(record);
    }
  };
  return { transport, records };
}

describe("createLogger()", () => {
  describe("default level", () => {
    it("defaults to info level", () => {
      const { transport } = makeCapture();
      const logger = createLogger({ transport, clock });
      expect(logger.level).toBe("info");
    });

    it("suppresses debug when level is info (default)", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock });
      logger.debug("suppressed");
      expect(records).toHaveLength(0);
    });

    it("suppresses trace when level is info (default)", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock });
      logger.trace("suppressed");
      expect(records).toHaveLength(0);
    });

    it("emits info when level is info", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock });
      logger.info("visible");
      expect(records).toHaveLength(1);
    });
  });

  describe("clock", () => {
    it("uses the injected clock for record.time", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock });
      logger.info("msg");
      expect(records[0]?.time).toBe(FIXED_TIME);
    });

    it("default clock produces an ISO timestamp string", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport });
      logger.info("msg");
      expect(records[0]?.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe("level method record fields", () => {
    const levels = [
      { method: "trace" as const, expectedValue: 10 },
      { method: "debug" as const, expectedValue: 20 },
      { method: "info" as const, expectedValue: 30 },
      { method: "warn" as const, expectedValue: 40 },
      { method: "error" as const, expectedValue: 50 },
      { method: "fatal" as const, expectedValue: 60 }
    ] as const;

    for (const { method, expectedValue } of levels) {
      it(`${method}() sets record.level to "${method}"`, () => {
        const { transport, records } = makeCapture();
        // Use trace level to allow all methods through.
        const logger = createLogger({ transport, clock, level: "trace" });
        logger[method]("test");
        expect(records[0]?.level).toBe(method);
      });

      it(`${method}() sets record.levelValue to ${expectedValue}`, () => {
        const { transport, records } = makeCapture();
        const logger = createLogger({ transport, clock, level: "trace" });
        logger[method]("test");
        expect(records[0]?.levelValue).toBe(expectedValue);
      });
    }

    it("record.message matches the supplied message", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock });
      logger.info("hello world");
      expect(records[0]?.message).toBe("hello world");
    });

    it("record.time is set from the clock", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock });
      logger.info("msg");
      expect(records[0]?.time).toBe(FIXED_TIME);
    });
  });

  describe("level filtering", () => {
    it("emits records at exactly the configured level", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock, level: "warn" });
      logger.warn("at level");
      expect(records).toHaveLength(1);
    });

    it("suppresses records below the configured level", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock, level: "warn" });
      logger.info("below");
      logger.debug("below");
      logger.trace("below");
      expect(records).toHaveLength(0);
    });

    it("emits records above the configured level", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock, level: "warn" });
      logger.error("above");
      logger.fatal("above");
      expect(records).toHaveLength(2);
    });
  });

  describe("disabled call context isolation", () => {
    it("does not evaluate getters on context when the level is disabled", () => {
      const { transport } = makeCapture();
      const logger = createLogger({ transport, clock, level: "info" });
      let evaluated = false;
      const context = Object.defineProperty({}, "expensive", {
        get() {
          evaluated = true;
          return "value";
        },
        enumerable: true
      });
      logger.debug("suppressed", context);
      expect(evaluated).toBe(false);
    });

    it("does not throw even when the context object has a throwing getter (disabled)", () => {
      const { transport } = makeCapture();
      const logger = createLogger({ transport, clock, level: "info" });
      const context = Object.defineProperty({}, "boom", {
        get() {
          throw new Error("should not run");
        },
        enumerable: true
      });
      expect(() => logger.debug("suppressed", context)).not.toThrow();
    });
  });

  describe("isLevelEnabled()", () => {
    it("returns true for the configured level", () => {
      const { transport } = makeCapture();
      const logger = createLogger({ transport, clock, level: "warn" });
      expect(logger.isLevelEnabled("warn")).toBe(true);
    });

    it("returns false for levels below the configured level", () => {
      const { transport } = makeCapture();
      const logger = createLogger({ transport, clock, level: "warn" });
      expect(logger.isLevelEnabled("info")).toBe(false);
      expect(logger.isLevelEnabled("debug")).toBe(false);
      expect(logger.isLevelEnabled("trace")).toBe(false);
    });

    it("returns true for levels above the configured level", () => {
      const { transport } = makeCapture();
      const logger = createLogger({ transport, clock, level: "warn" });
      expect(logger.isLevelEnabled("error")).toBe(true);
      expect(logger.isLevelEnabled("fatal")).toBe(true);
    });
  });

  describe("context merging", () => {
    it("per-call context appears in record.context", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock });
      logger.info("msg", { foo: "bar" });
      expect(records[0]?.context.foo).toBe("bar");
    });

    it("bindings appear in record.context", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock, bindings: { service: "api" } });
      logger.info("msg");
      expect(records[0]?.context.service).toBe("api");
    });

    it("per-call context wins over bindings on key collision", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock, bindings: { key: "binding" } });
      logger.info("msg", { key: "call" });
      expect(records[0]?.context.key).toBe("call");
    });

    it("bindings and per-call context are both present when keys differ", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock, bindings: { a: 1 } });
      logger.info("msg", { b: 2 });
      expect(records[0]?.context.a).toBe(1);
      expect(records[0]?.context.b).toBe(2);
    });

    it("omitting per-call context still includes bindings", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock, bindings: { x: "y" } });
      logger.info("no context arg");
      expect(records[0]?.context.x).toBe("y");
    });
  });

  describe("input immutability", () => {
    it("does not mutate the bindings object", () => {
      const bindings = { a: 1 };
      const { transport } = makeCapture();
      const logger = createLogger({ transport, clock, bindings });
      logger.info("msg", { b: 2 });
      expect(bindings).toStrictEqual({ a: 1 });
    });

    it("does not mutate the per-call context object", () => {
      const context = { b: 2 };
      const { transport } = makeCapture();
      const logger = createLogger({ transport, clock });
      logger.info("msg", context);
      expect(context).toStrictEqual({ b: 2 });
    });
  });

  describe("child loggers", () => {
    it("child records include child bindings", () => {
      const { transport, records } = makeCapture();
      const parent = createLogger({ transport, clock });
      const child = parent.child({ component: "Widget" });
      child.info("msg");
      expect(records[0]?.context.component).toBe("Widget");
    });

    it("child merges parent bindings with child bindings", () => {
      const { transport, records } = makeCapture();
      const parent = createLogger({ transport, clock, bindings: { service: "api" } });
      const child = parent.child({ component: "Widget" });
      child.info("msg");
      expect(records[0]?.context.service).toBe("api");
      expect(records[0]?.context.component).toBe("Widget");
    });

    it("child bindings override parent bindings on collision", () => {
      const { transport, records } = makeCapture();
      const parent = createLogger({ transport, clock, bindings: { key: "parent" } });
      const child = parent.child({ key: "child" });
      child.info("msg");
      expect(records[0]?.context.key).toBe("child");
    });

    it("parent logger does not pick up child bindings", () => {
      const { transport, records } = makeCapture();
      const parent = createLogger({ transport, clock });
      const child = parent.child({ component: "Widget" });
      parent.info("from parent");
      child.info("from child");
      expect(records[0]?.context.component).toBeUndefined();
      expect(records[1]?.context.component).toBe("Widget");
    });

    it("child shares the same transport as the parent", () => {
      const { transport, records } = makeCapture();
      const parent = createLogger({ transport, clock });
      const child = parent.child({ c: 1 });
      child.info("via child transport");
      expect(records).toHaveLength(1);
    });

    it("child shares the same level as the parent", () => {
      const { transport, records } = makeCapture();
      const parent = createLogger({ transport, clock, level: "warn" });
      const child = parent.child({ c: 1 });
      child.info("suppressed by parent level");
      expect(records).toHaveLength(0);
    });

    it("child shares the same clock as the parent", () => {
      const { transport, records } = makeCapture();
      const parent = createLogger({ transport, clock });
      const child = parent.child({ c: 1 });
      child.info("msg");
      expect(records[0]?.time).toBe(FIXED_TIME);
    });

    it("child shares the same onTransportError handler", () => {
      const errors: unknown[] = [];
      const throwingTransport: Transport = {
        log() {
          throw new Error("transport fail");
        }
      };
      const parent = createLogger({
        transport: throwingTransport,
        clock,
        onTransportError: (err) => {
          errors.push(err);
        }
      });
      const child = parent.child({ c: 1 });
      child.info("trigger error");
      expect(errors).toHaveLength(1);
    });
  });

  describe("error serialization", () => {
    it("serializes a top-level Error context value", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock });
      const err = new Error("db failed");
      logger.error("save failed", { err });
      const ctxErr = records[0]?.context.err as Record<string, unknown>;
      expect(ctxErr).not.toBeInstanceOf(Error);
      expect(ctxErr.name).toBe("Error");
      expect(ctxErr.message).toBe("db failed");
    });

    it("does not serialize a nested error inside a context value", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock });
      const nested = new Error("nested");
      logger.error("outer", { wrapper: { inner: nested } });
      const wrapper = records[0]?.context.wrapper as Record<string, unknown>;
      expect(wrapper.inner).toBeInstanceOf(Error);
    });

    it("serializes multiple top-level Errors independently", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock });
      const err1 = new Error("first");
      const err2 = new Error("second");
      logger.error("two errors", { err1, err2 });
      const ctxErr1 = records[0]?.context.err1 as Record<string, unknown>;
      const ctxErr2 = records[0]?.context.err2 as Record<string, unknown>;
      expect(ctxErr1.message).toBe("first");
      expect(ctxErr2.message).toBe("second");
    });
  });

  describe("transport error isolation", () => {
    it("does not throw when transport.log throws", () => {
      const throwingTransport: Transport = {
        log() {
          throw new Error("transport exploded");
        }
      };
      const logger = createLogger({ transport: throwingTransport, clock });
      expect(() => logger.info("msg")).not.toThrow();
    });

    it("calls onTransportError when transport.log throws", () => {
      const errors: unknown[] = [];
      const throwingTransport: Transport = {
        log() {
          throw new Error("transport exploded");
        }
      };
      const logger = createLogger({
        transport: throwingTransport,
        clock,
        onTransportError: (err) => {
          errors.push(err);
        }
      });
      logger.info("msg");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(Error);
    });

    it("onTransportError receives the LogRecord that caused the failure", () => {
      const capturedRecords: LogRecord[] = [];
      const throwingTransport: Transport = {
        log() {
          throw new Error("fail");
        }
      };
      const logger = createLogger({
        transport: throwingTransport,
        clock,
        onTransportError: (_err, record) => {
          capturedRecords.push(record);
        }
      });
      logger.info("the message");
      expect(capturedRecords[0]?.message).toBe("the message");
    });

    it("swallows errors thrown by onTransportError itself", () => {
      const throwingTransport: Transport = {
        log() {
          throw new Error("transport fail");
        }
      };
      const logger = createLogger({
        transport: throwingTransport,
        clock,
        onTransportError: () => {
          throw new Error("error handler also throws");
        }
      });
      expect(() => logger.info("msg")).not.toThrow();
    });

    it("does not call transport for disabled log levels", () => {
      const callCount = { n: 0 };
      const countingTransport: Transport = {
        log() {
          callCount.n++;
        }
      };
      const logger = createLogger({ transport: countingTransport, clock, level: "info" });
      logger.debug("suppressed");
      logger.trace("suppressed");
      expect(callCount.n).toBe(0);
    });

    it("does not call onTransportError for disabled log levels", () => {
      const errors: unknown[] = [];
      const throwingTransport: Transport = {
        log() {
          throw new Error("should not be reached");
        }
      };
      const logger = createLogger({
        transport: throwingTransport,
        clock,
        level: "info",
        onTransportError: (err) => {
          errors.push(err);
        }
      });
      logger.debug("suppressed");
      expect(errors).toHaveLength(0);
    });

    it("silently drops transport errors when no onTransportError is provided", () => {
      const throwingTransport: Transport = {
        log() {
          throw new Error("silent drop");
        }
      };
      const logger = createLogger({ transport: throwingTransport, clock });
      expect(() => logger.info("msg")).not.toThrow();
    });

    it("handles multiple successive transport errors without accumulation", () => {
      const errors: unknown[] = [];
      const throwingTransport: Transport = {
        log() {
          throw new Error("fail");
        }
      };
      const logger = createLogger({
        transport: throwingTransport,
        clock,
        onTransportError: (err) => {
          errors.push(err);
        }
      });
      logger.info("first");
      logger.info("second");
      expect(errors).toHaveLength(2);
    });
  });

  describe("record isolation", () => {
    it("emits a new context object for each call", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock });
      logger.info("first", { x: 1 });
      logger.info("second", { x: 2 });
      expect(records[0]?.context).not.toBe(records[1]?.context);
      expect(records[0]?.context.x).toBe(1);
      expect(records[1]?.context.x).toBe(2);
    });

    it("mutating record.context after delivery does not affect subsequent records", () => {
      const { transport, records } = makeCapture();
      const logger = createLogger({ transport, clock });
      logger.info("first", { x: 1 });
      (records[0].context as Record<string, unknown>).x = 99;
      logger.info("second", { x: 2 });
      expect(records[1]?.context.x).toBe(2);
    });
  });

  describe("mock transport", () => {
    it("calls transport.log once per enabled emit", () => {
      const mockLog = vi.fn();
      const transport: Transport = { log: mockLog };
      const logger = createLogger({ transport, clock, level: "trace" });
      logger.trace("t");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      logger.fatal("f");
      expect(mockLog).toHaveBeenCalledTimes(6);
    });

    it("does not call transport.log for disabled levels", () => {
      const mockLog = vi.fn();
      const transport: Transport = { log: mockLog };
      const logger = createLogger({ transport, clock, level: "info" });
      logger.trace("suppressed");
      logger.debug("suppressed");
      expect(mockLog).not.toHaveBeenCalled();
    });
  });
});
