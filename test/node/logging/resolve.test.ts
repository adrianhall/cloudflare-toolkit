import { describe, expect, it, vi } from "vitest";
import { resolveLoggerConfig } from "../../../src/lib/logging/index.js";
import type { LogRecord } from "../../../src/lib/logging/index.js";

/** Build a minimal LogRecord for testing. */
function makeRecord(overrides?: Partial<LogRecord>): LogRecord {
  return {
    time: "2026-01-01T00:00:00.000Z",
    level: "info",
    levelValue: 30,
    message: "test",
    context: {},
    ...overrides
  };
}

/**
 * Check whether the transport silently captures records (capture transport behavior: no
 * console output, but the record is stored).
 */
function isCaptureTransport(
  transport: ReturnType<typeof resolveLoggerConfig>["transport"]
): boolean {
  const t = transport as { records?: unknown; clear?: unknown };
  return typeof t.records !== "undefined" && typeof t.clear === "function";
}

/**
 * Identify which built-in transport `resolveLoggerConfig` selected by probing its console
 * output shape for an info-level record:
 *  - capture transport: exposes `.records`/`.clear()`.
 *  - browser transport: first arg is `"%cINFO"` (starts with `"%c"`).
 *  - structured transport: first arg is a plain object.
 *  - console transport: first arg is a plain string line with no `"%c"`.
 */
function identifyTransport(
  transport: ReturnType<typeof resolveLoggerConfig>["transport"]
): "capture" | "browser" | "console" | "structured" | "unknown" {
  if (isCaptureTransport(transport)) {
    return "capture";
  }

  const record = makeRecord({ level: "info", levelValue: 30, message: "probe" });
  const captured: unknown[][] = [];

  const methods = ["debug", "info", "log", "warn", "error"] as const;
  const spies = methods.map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      captured.push(args);
    })
  );

  try {
    transport.log(record);
  } finally {
    spies.forEach((s) => s.mockRestore());
  }

  if (captured.length === 0) {
    return "unknown";
  }

  const firstArg = captured[0]?.[0];

  if (typeof firstArg === "string" && firstArg.startsWith("%c")) {
    return "browser";
  }

  if (typeof firstArg === "object" && firstArg !== null && !Array.isArray(firstArg)) {
    return "structured";
  }

  if (typeof firstArg === "string") {
    return "console";
  }

  return "unknown";
}

describe("module exports", () => {
  it("exports resolveLoggerConfig", () => {
    expect(typeof resolveLoggerConfig).toBe("function");
  });

  it("does not export detectRuntime", async () => {
    const resolveModule: Record<string, unknown> =
      await import("../../../src/lib/logging/resolve.js");
    expect(resolveModule["detectRuntime"]).toBeUndefined();
  });
});

describe('resolveLoggerConfig("test", runtime)', () => {
  it('test + browser → level "trace"', () => {
    const { level } = resolveLoggerConfig("test", "browser");
    expect(level).toBe("trace");
  });

  it("test + browser → capture transport", () => {
    const { transport } = resolveLoggerConfig("test", "browser");
    expect(identifyTransport(transport)).toBe("capture");
  });

  it('test + worker → level "trace"', () => {
    const { level } = resolveLoggerConfig("test", "worker");
    expect(level).toBe("trace");
  });

  it("test + worker → capture transport", () => {
    const { transport } = resolveLoggerConfig("test", "worker");
    expect(identifyTransport(transport)).toBe("capture");
  });
});

describe('resolveLoggerConfig("development", runtime)', () => {
  it('development + browser → level "info"', () => {
    const { level } = resolveLoggerConfig("development", "browser");
    expect(level).toBe("info");
  });

  it("development + browser → browser transport", () => {
    const { transport } = resolveLoggerConfig("development", "browser");
    expect(identifyTransport(transport)).toBe("browser");
  });

  it('development + worker → level "debug"', () => {
    const { level } = resolveLoggerConfig("development", "worker");
    expect(level).toBe("debug");
  });

  it("development + worker → console transport", () => {
    const { transport } = resolveLoggerConfig("development", "worker");
    expect(identifyTransport(transport)).toBe("console");
  });
});

describe('resolveLoggerConfig("production", runtime)', () => {
  it('production + browser → level "warn"', () => {
    const { level } = resolveLoggerConfig("production", "browser");
    expect(level).toBe("warn");
  });

  it("production + browser → browser transport", () => {
    const { transport } = resolveLoggerConfig("production", "browser");
    expect(identifyTransport(transport)).toBe("browser");
  });

  it('production + worker → level "warn"', () => {
    const { level } = resolveLoggerConfig("production", "worker");
    expect(level).toBe("warn");
  });

  it("production + worker → structured transport", () => {
    const { transport } = resolveLoggerConfig("production", "worker");
    expect(identifyTransport(transport)).toBe("structured");
  });
});

describe("resolveLoggerConfig(unknown environment, runtime)", () => {
  it('unknown env + browser → level "warn"', () => {
    const { level } = resolveLoggerConfig("staging", "browser");
    expect(level).toBe("warn");
  });

  it("unknown env + browser → browser transport", () => {
    const { transport } = resolveLoggerConfig("staging", "browser");
    expect(identifyTransport(transport)).toBe("browser");
  });

  it('unknown env + worker → level "warn"', () => {
    const { level } = resolveLoggerConfig("staging", "worker");
    expect(level).toBe("warn");
  });

  it("unknown env + worker → structured transport", () => {
    const { transport } = resolveLoggerConfig("staging", "worker");
    expect(identifyTransport(transport)).toBe("structured");
  });
});

describe("resolveLoggerConfig(undefined, runtime)", () => {
  it('undefined env + browser → level "warn"', () => {
    const { level } = resolveLoggerConfig(undefined, "browser");
    expect(level).toBe("warn");
  });

  it("undefined env + browser → browser transport", () => {
    const { transport } = resolveLoggerConfig(undefined, "browser");
    expect(identifyTransport(transport)).toBe("browser");
  });

  it('undefined env + worker → level "warn"', () => {
    const { level } = resolveLoggerConfig(undefined, "worker");
    expect(level).toBe("warn");
  });

  it("undefined env + worker → structured transport", () => {
    const { transport } = resolveLoggerConfig(undefined, "worker");
    expect(identifyTransport(transport)).toBe("structured");
  });
});

describe("fresh transport per call", () => {
  it("two test calls return distinct capture transport instances", () => {
    const a = resolveLoggerConfig("test", "worker");
    const b = resolveLoggerConfig("test", "worker");
    expect(a.transport).not.toBe(b.transport);
  });

  it("two development+browser calls return distinct browser transport instances", () => {
    const a = resolveLoggerConfig("development", "browser");
    const b = resolveLoggerConfig("development", "browser");
    expect(a.transport).not.toBe(b.transport);
  });

  it("two production+worker calls return distinct structured transport instances", () => {
    const a = resolveLoggerConfig("production", "worker");
    const b = resolveLoggerConfig("production", "worker");
    expect(a.transport).not.toBe(b.transport);
  });

  it("capture transports from separate calls have independent record storage", () => {
    const a = resolveLoggerConfig("test", "worker");
    const b = resolveLoggerConfig("test", "worker");

    const ca = a.transport as { records: readonly unknown[]; log(r: LogRecord): void };
    const cb = b.transport as { records: readonly unknown[]; log(r: LogRecord): void };

    ca.log(makeRecord({ message: "only in a" }));

    expect(ca.records).toHaveLength(1);
    expect(cb.records).toHaveLength(0);
  });
});

describe("returned config shape", () => {
  it("returns an object with level and transport properties", () => {
    const config = resolveLoggerConfig("production", "worker");
    expect(config).toHaveProperty("level");
    expect(config).toHaveProperty("transport");
  });

  it("transport has a log method", () => {
    const { transport } = resolveLoggerConfig("production", "worker");
    expect(typeof transport.log).toBe("function");
  });
});
