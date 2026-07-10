import { describe, expect, it, vi } from "vitest";
import {
  combineTransports,
  createCaptureTransport,
  createLogger
} from "../../../../src/lib/logging/index.js";
import type { LogRecord, Transport } from "../../../../src/lib/logging/index.js";

/** Build a minimal LogRecord for testing. */
function makeRecord(overrides?: Partial<LogRecord>): LogRecord {
  return {
    time: "2026-01-01T00:00:00.000Z",
    level: "info",
    levelValue: 30,
    message: "test message",
    context: {},
    ...overrides
  };
}

/** Build a transport that records calls in an array. */
function makeCapture() {
  const received: LogRecord[] = [];
  const transport: Transport = { log: (r) => received.push(r) };
  return { transport, received };
}

/** Build a transport that always throws with the given message. */
function makeThrowing(message: string): Transport {
  return {
    log() {
      throw new Error(message);
    }
  };
}

describe("combineTransports()", () => {
  describe("forwarding", () => {
    it("forwards a record to a single transport", () => {
      const { transport, received } = makeCapture();
      const combined = combineTransports(transport);
      const record = makeRecord();
      combined.log(record);
      expect(received).toHaveLength(1);
      expect(received[0]).toBe(record);
    });

    it("forwards a record to multiple transports in order", () => {
      const order: string[] = [];
      const t1: Transport = { log: () => order.push("t1") };
      const t2: Transport = { log: () => order.push("t2") };
      const t3: Transport = { log: () => order.push("t3") };

      const combined = combineTransports(t1, t2, t3);
      combined.log(makeRecord());

      expect(order).toEqual(["t1", "t2", "t3"]);
    });

    it("passes the exact same record object to each transport", () => {
      const received: LogRecord[] = [];
      const t1: Transport = { log: (r) => received.push(r) };
      const t2: Transport = { log: (r) => received.push(r) };
      const record = makeRecord();

      combineTransports(t1, t2).log(record);

      expect(received[0]).toBe(record);
      expect(received[1]).toBe(record);
    });

    it("works with zero transports", () => {
      const combined = combineTransports();
      expect(() => combined.log(makeRecord())).not.toThrow();
    });
  });

  describe("single child throws", () => {
    it("throws the child error after attempting all transports", () => {
      const { transport: good, received } = makeCapture();
      const throwing = makeThrowing("first error");

      const combined = combineTransports(throwing, good);

      expect(() => combined.log(makeRecord())).toThrow("first error");
      expect(received).toHaveLength(1);
    });

    it("throws the child error when the only transport throws", () => {
      const combined = combineTransports(makeThrowing("only error"));
      expect(() => combined.log(makeRecord())).toThrow("only error");
    });

    it("still calls subsequent transports even when an earlier one throws", () => {
      const { transport: good1, received: r1 } = makeCapture();
      const { transport: good2, received: r2 } = makeCapture();

      const combined = combineTransports(good1, makeThrowing("middle"), good2);

      expect(() => combined.log(makeRecord())).toThrow();
      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
    });
  });

  describe("multiple children throw", () => {
    it("throws an AggregateError when two children throw", () => {
      const combined = combineTransports(makeThrowing("error one"), makeThrowing("error two"));

      let thrown: unknown;
      try {
        combined.log(makeRecord());
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(AggregateError);
      const agg = thrown as AggregateError;
      expect(agg.errors).toHaveLength(2);
      expect((agg.errors[0] as Error).message).toBe("error one");
      expect((agg.errors[1] as Error).message).toBe("error two");
    });

    it("throws an AggregateError when all three children throw", () => {
      const combined = combineTransports(makeThrowing("a"), makeThrowing("b"), makeThrowing("c"));

      let thrown: unknown;
      try {
        combined.log(makeRecord());
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(AggregateError);
      const agg = thrown as AggregateError;
      expect(agg.errors).toHaveLength(3);
    });
  });

  describe("logger-level error isolation", () => {
    it("routes combined failure through onTransportError without crashing", () => {
      const errors: unknown[] = [];
      const onTransportError = vi.fn((err: unknown) => errors.push(err));

      const combined = combineTransports(makeThrowing("from combine"), makeCapture().transport);

      const logger = createLogger({
        level: "info",
        transport: combined,
        clock: () => new Date("2026-01-01T00:00:00.000Z"),
        onTransportError
      });

      expect(() => logger.info("test")).not.toThrow();
      expect(onTransportError).toHaveBeenCalledOnce();
      expect((errors[0] as Error).message).toBe("from combine");
    });

    it("captures records from good transports even when another throws", () => {
      const capture = createCaptureTransport();
      const combined = combineTransports(makeThrowing("oops"), capture);

      const logger = createLogger({
        level: "info",
        transport: combined,
        clock: () => new Date("2026-01-01T00:00:00.000Z"),
        onTransportError: () => {
          // swallow
        }
      });

      logger.info("hello");

      expect(capture.records).toHaveLength(1);
      expect(capture.records[0]?.message).toBe("hello");
    });
  });
});
