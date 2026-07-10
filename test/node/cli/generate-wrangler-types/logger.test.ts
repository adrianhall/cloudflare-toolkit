import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../../src/cli/generate-wrangler-types/logger.js";
import type { LogLevel, LogSink } from "../../../../src/cli/generate-wrangler-types/logger.js";

/** A single log record captured by the in-memory sink. */
interface CapturedMessage {
  /** The severity level of the captured message. */
  level: LogLevel;
  /** The plain-text message body. */
  message: string;
}

/**
 * Creates an in-memory {@link LogSink} and returns it together with the array of messages it
 * accumulates, for use in assertions.
 *
 * @returns An object with a `sink` and a `messages` array that grows as the sink is called.
 */
function makeSink(): { sink: LogSink; messages: CapturedMessage[] } {
  const messages: CapturedMessage[] = [];
  const sink: LogSink = (level, message) => messages.push({ level, message });
  return { sink, messages };
}

describe("createLogger", () => {
  describe("level filtering", () => {
    it("debug level passes all four levels through", () => {
      const { sink, messages } = makeSink();
      const log = createLogger({ level: "debug", sink });
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
      expect(messages).toHaveLength(4);
    });

    it("info level suppresses debug messages", () => {
      const { sink, messages } = makeSink();
      const log = createLogger({ level: "info", sink });
      log.debug("suppressed");
      log.info("visible");
      expect(messages).toHaveLength(1);
      expect(messages[0].level).toBe("info");
    });

    it("warn level suppresses debug and info messages", () => {
      const { sink, messages } = makeSink();
      const log = createLogger({ level: "warn", sink });
      log.debug("suppressed");
      log.info("suppressed");
      log.warn("visible");
      log.error("visible");
      expect(messages).toHaveLength(2);
      expect(messages[0].level).toBe("warn");
      expect(messages[1].level).toBe("error");
    });

    it("error level only passes error messages through", () => {
      const { sink, messages } = makeSink();
      const log = createLogger({ level: "error", sink });
      log.debug("suppressed");
      log.info("suppressed");
      log.warn("suppressed");
      log.error("visible");
      expect(messages).toHaveLength(1);
      expect(messages[0].level).toBe("error");
    });
  });

  describe("message routing", () => {
    it("passes the exact message string to the sink", () => {
      const { sink, messages } = makeSink();
      const log = createLogger({ level: "debug", sink });
      log.info("hello world");
      expect(messages[0].message).toBe("hello world");
    });

    it("routes each method to its corresponding level", () => {
      const { sink, messages } = makeSink();
      const log = createLogger({ level: "debug", sink });
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
      expect(messages[0].level).toBe("debug");
      expect(messages[1].level).toBe("info");
      expect(messages[2].level).toBe("warn");
      expect(messages[3].level).toBe("error");
    });

    it("preserves message content exactly for each level", () => {
      const { sink, messages } = makeSink();
      const log = createLogger({ level: "debug", sink });
      log.debug("debug msg");
      log.info("info msg");
      log.warn("warn msg");
      log.error("error msg");
      expect(messages[0].message).toBe("debug msg");
      expect(messages[1].message).toBe("info msg");
      expect(messages[2].message).toBe("warn msg");
      expect(messages[3].message).toBe("error msg");
    });
  });

  describe("default sink (stderr)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("writes ISO-timestamped lines to stderr without color when not a TTY", () => {
      const writes: string[] = [];
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: Uint8Array | string) => {
        writes.push(chunk.toString());
        return true;
      });

      const log = createLogger({ level: "info" });
      log.info("formatted output");

      expect(writes).toHaveLength(1);
      // Format: <iso-utc-ms> [info] formatted output\n
      expect(writes[0]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[info\] formatted output\n$/
      );
    });

    it("calls colorize for all four levels when isTTY is true", () => {
      const writes: string[] = [];
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: Uint8Array | string) => {
        writes.push(chunk.toString());
        return true;
      });

      // Force isTTY so the default sink applies colour, covering all colorize branches.
      const stderr = process.stderr as NodeJS.WriteStream & { isTTY: boolean };
      const originalIsTTY = stderr.isTTY;
      stderr.isTTY = true;
      try {
        const log = createLogger({ level: "debug" });
        log.debug("d");
        log.info("i");
        log.warn("w");
        log.error("e");
      } finally {
        stderr.isTTY = originalIsTTY;
      }

      // All four messages were written (colorize executed without throwing).
      expect(writes).toHaveLength(4);
      for (const w of writes) {
        expect(w.endsWith("\n")).toBe(true);
      }
    });
  });
});
