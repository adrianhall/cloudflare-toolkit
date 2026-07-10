// Adapted from adrianhall/cloudflare-logger's test/node/transports/capture.test.ts (same author;
// source repo is read-only per docs/SPECv2.md §10, not modified by this port). Imports from the
// public barrel, matching how a consumer would use `@adrianhall/cloudflare-toolkit/logging`.
import { describe, expect, it, vi } from "vitest";
import { createCaptureTransport } from "../../../../src/lib/logging/index.js";
import type { LogRecord } from "../../../../src/lib/logging/index.js";

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

describe("createCaptureTransport()", () => {
  it("starts with an empty records array", () => {
    const capture = createCaptureTransport();
    expect(capture.records).toHaveLength(0);
  });

  it("stores records in the order they are received", () => {
    const capture = createCaptureTransport();
    const r1 = makeRecord({ message: "first", level: "info", levelValue: 30 });
    const r2 = makeRecord({ message: "second", level: "warn", levelValue: 40 });
    const r3 = makeRecord({ message: "third", level: "error", levelValue: 50 });

    capture.log(r1);
    capture.log(r2);
    capture.log(r3);

    expect(capture.records).toHaveLength(3);
    expect(capture.records[0]).toBe(r1);
    expect(capture.records[1]).toBe(r2);
    expect(capture.records[2]).toBe(r3);
  });

  describe(".records immutability", () => {
    it("returns a copy — push on the returned array does not affect internal storage", () => {
      const capture = createCaptureTransport();
      capture.log(makeRecord({ message: "one" }));

      const snapshot = capture.records as LogRecord[];
      snapshot.push(makeRecord({ message: "injected" }));

      expect(capture.records).toHaveLength(1);
    });

    it("each .records access returns an independent snapshot", () => {
      const capture = createCaptureTransport();
      capture.log(makeRecord({ message: "one" }));

      const first = capture.records;
      capture.log(makeRecord({ message: "two" }));
      const second = capture.records;

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(2);
    });
  });

  describe("clear()", () => {
    it("removes all stored records", () => {
      const capture = createCaptureTransport();
      capture.log(makeRecord());
      capture.log(makeRecord());

      capture.clear();

      expect(capture.records).toHaveLength(0);
    });

    it("can be called on an already-empty transport without error", () => {
      const capture = createCaptureTransport();
      expect(() => capture.clear()).not.toThrow();
    });

    it("allows records to be accumulated after a clear", () => {
      const capture = createCaptureTransport();
      capture.log(makeRecord({ message: "before" }));
      capture.clear();
      capture.log(makeRecord({ message: "after" }));

      expect(capture.records).toHaveLength(1);
      expect(capture.records[0]?.message).toBe("after");
    });
  });

  describe("find(level)", () => {
    it("returns only records matching the specified level", () => {
      const capture = createCaptureTransport();
      capture.log(makeRecord({ level: "info", levelValue: 30, message: "info one" }));
      capture.log(makeRecord({ level: "warn", levelValue: 40, message: "warn one" }));
      capture.log(makeRecord({ level: "info", levelValue: 30, message: "info two" }));

      const infoRecords = capture.find("info");
      expect(infoRecords).toHaveLength(2);
      expect(infoRecords[0]?.message).toBe("info one");
      expect(infoRecords[1]?.message).toBe("info two");
    });

    it("returns an empty array when no records match the level", () => {
      const capture = createCaptureTransport();
      capture.log(makeRecord({ level: "info", levelValue: 30 }));

      expect(capture.find("error")).toHaveLength(0);
    });

    it("returns an empty array when the transport is empty", () => {
      const capture = createCaptureTransport();
      expect(capture.find("warn")).toHaveLength(0);
    });

    it("works correctly for all six levels", () => {
      const capture = createCaptureTransport();
      capture.log(makeRecord({ level: "trace", levelValue: 10 }));
      capture.log(makeRecord({ level: "debug", levelValue: 20 }));
      capture.log(makeRecord({ level: "info", levelValue: 30 }));
      capture.log(makeRecord({ level: "warn", levelValue: 40 }));
      capture.log(makeRecord({ level: "error", levelValue: 50 }));
      capture.log(makeRecord({ level: "fatal", levelValue: 60 }));

      for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
        expect(capture.find(level)).toHaveLength(1);
      }
    });

    it("is preferred over manual filtering in test assertions", () => {
      const capture = createCaptureTransport();
      capture.log(makeRecord({ level: "error", levelValue: 50, message: "boom" }));

      const errors = capture.find("error");
      expect(errors[0]?.message).toBe("boom");
    });
  });

  describe("no console output", () => {
    it("does not call console.log when a record is logged", () => {
      const spy = vi.spyOn(console, "log");
      const capture = createCaptureTransport();
      capture.log(makeRecord());
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("does not call console.error when a record is logged", () => {
      const spy = vi.spyOn(console, "error");
      const capture = createCaptureTransport();
      capture.log(makeRecord({ level: "error", levelValue: 50 }));
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
