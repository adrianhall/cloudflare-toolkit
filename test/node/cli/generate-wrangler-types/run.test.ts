import { describe, expect, it, vi } from "vitest";
import type { LogLevel, LogSink } from "../../../../src/cli/generate-wrangler-types/logger.js";
import type { GenerateWranglerTypesDeps } from "../../../../src/cli/generate-wrangler-types/run.js";
import { run } from "../../../../src/cli/generate-wrangler-types/run.js";
import type {
  FileSystem,
  WranglerResult,
  WranglerRunner
} from "../../../../src/cli/generate-wrangler-types/types.js";

// ---------------------------------------------------------------------------
// Constants — use absolute paths to avoid cwd dependency
// ---------------------------------------------------------------------------

const CONFIG = "/project/wrangler.jsonc";
const OUTPUT = "/project/worker-configuration.d.ts";

// Timestamps: OUTPUT is newer than CONFIG by default (fresh).
const CONFIG_MTIME = 1000;
const OUTPUT_MTIME_FRESH = 2000; // output newer → skip
const OUTPUT_MTIME_STALE = 500; // output older → regenerate

// ---------------------------------------------------------------------------
// Stub factory helpers
// ---------------------------------------------------------------------------

function makeLogSink(): {
  sink: LogSink;
  logs: { level: LogLevel; message: string }[];
} {
  const logs: { level: LogLevel; message: string }[] = [];
  const sink: LogSink = (level, message) => logs.push({ level, message });
  return { sink, logs };
}

function makeFS(overrides: Partial<FileSystem> = {}): FileSystem {
  return {
    async fileExists(path) {
      // By default: config exists, output exists.
      return path === CONFIG || path === OUTPUT;
    },
    async getModifiedTime(path) {
      if (path === CONFIG) return CONFIG_MTIME;
      if (path === OUTPUT) return OUTPUT_MTIME_FRESH;
      throw new Error(`Unexpected path: ${path}`);
    },
    ...overrides
  };
}

function makeWrangler(result: Partial<WranglerResult> = {}): WranglerRunner {
  return {
    async runTypes(_outputPath, _extraArgs, _cwd) {
      return { exitCode: 0, stdout: "", stderr: "", ...result };
    }
  };
}

function makeDeps(
  overrides: Partial<GenerateWranglerTypesDeps> = {}
): GenerateWranglerTypesDeps & { logs: { level: LogLevel; message: string }[] } {
  const { sink, logs } = makeLogSink();
  return {
    fs: makeFS(),
    wrangler: makeWrangler(),
    logSink: sink,
    ...overrides,
    // Allow overriding the logSink while still exposing logs.
    // If the caller explicitly provides a logSink, use it instead.
    ...(overrides.logSink ? {} : { logSink: sink }),
    logs
  };
}

// Build a minimal argv array with default paths baked in.
function argv(...extra: string[]): string[] {
  return ["node", "generate-wrangler-types", "--config", CONFIG, "--output", OUTPUT, ...extra];
}

// ---------------------------------------------------------------------------
// exit 0 — types fresh (skipped)
// ---------------------------------------------------------------------------

describe("exit 0 — types are fresh", () => {
  it("returns 0 and skips wrangler when output is newer than config", async () => {
    const runCalled = { value: false };
    const deps = makeDeps({
      wrangler: {
        async runTypes() {
          runCalled.value = true;
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      }
    });

    const code = await run(argv(), deps);

    expect(code).toBe(0);
    expect(runCalled.value).toBe(false);
  });

  it("logs a debug message when types are skipped", async () => {
    const deps = makeDeps();
    await run(argv("--verbose"), deps);

    const debugLogs = deps.logs.filter((l) => l.level === "debug");
    expect(debugLogs.some((l) => l.message.includes("fresh"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// exit 0 — wrangler types succeeded
// ---------------------------------------------------------------------------

describe("exit 0 — wrangler types succeeded", () => {
  it("returns 0 when output is stale and wrangler exits 0", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async getModifiedTime(path) {
          if (path === CONFIG) return CONFIG_MTIME;
          if (path === OUTPUT) return OUTPUT_MTIME_STALE;
          throw new Error(`Unexpected path: ${path}`);
        }
      })
    });

    const code = await run(argv(), deps);

    expect(code).toBe(0);
  });

  it("returns 0 when output does not exist yet", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG; // output missing
        }
      })
    });

    const code = await run(argv(), deps);

    expect(code).toBe(0);
  });

  it("logs info with the output path after success", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      })
    });

    await run(argv(), deps);

    const infoLogs = deps.logs.filter((l) => l.level === "info");
    expect(infoLogs.some((l) => l.message.includes(OUTPUT))).toBe(true);
  });

  it("forwards extra args after -- to wrangler", async () => {
    let capturedArgs: string[] = [];
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      }),
      wrangler: {
        async runTypes(_outputPath, extraArgs, _cwd) {
          capturedArgs = extraArgs;
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      }
    });

    await run(argv("--", "--include-runtime=false", "--strict-vars=false"), deps);

    expect(capturedArgs).toEqual(["--include-runtime=false", "--strict-vars=false"]);
  });

  it("passes no extra args when -- is absent", async () => {
    let capturedArgs: string[] = [];
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      }),
      wrangler: {
        async runTypes(_outputPath, extraArgs, _cwd) {
          capturedArgs = extraArgs;
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      }
    });

    await run(argv(), deps);

    expect(capturedArgs).toEqual([]);
  });

  it("passes resolved cwd (--dir) to wrangler runner", async () => {
    let capturedCwd = "";
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      }),
      wrangler: {
        async runTypes(_outputPath, _extraArgs, cwd) {
          capturedCwd = cwd;
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      }
    });

    await run(
      [
        "node",
        "generate-wrangler-types",
        "--config",
        CONFIG,
        "--output",
        OUTPUT,
        "--dir",
        "/my/dir"
      ],
      deps
    );

    expect(capturedCwd).toBe("/my/dir");
  });

  it("returns 0 for --help", async () => {
    const deps = makeDeps();
    // Override stdout to suppress Commander's help output during tests.
    const write = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["node", "generate-wrangler-types", "--help"], deps);
      expect(code).toBe(0);
    } finally {
      vi.restoreAllMocks();
      void write;
    }
  });

  it("returns 0 for --version", async () => {
    const deps = makeDeps();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["node", "generate-wrangler-types", "--version"], deps);
      expect(code).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

// ---------------------------------------------------------------------------
// exit 0 — --force bypasses freshness check
// ---------------------------------------------------------------------------

describe("exit 0 — --force bypasses freshness check", () => {
  it("runs wrangler even when output is fresher than config", async () => {
    let wranglerCalled = false;
    const deps = makeDeps({
      // Default FS has output fresher than config.
      wrangler: {
        async runTypes() {
          wranglerCalled = true;
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      }
    });

    const code = await run(argv("--force"), deps);

    expect(code).toBe(0);
    expect(wranglerCalled).toBe(true);
  });

  it("logs a debug skip-check message with --force --verbose", async () => {
    const deps = makeDeps({
      wrangler: makeWrangler()
    });

    await run(argv("--force", "--verbose"), deps);

    const debugLogs = deps.logs.filter((l) => l.level === "debug");
    expect(debugLogs.some((l) => l.message.includes("force"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// exit 1 — config file not found
// ---------------------------------------------------------------------------

describe("exit 1 — config file not found", () => {
  it("returns 1 when wrangler.jsonc does not exist", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists() {
          return false;
        }
      })
    });

    const code = await run(argv(), deps);

    expect(code).toBe(1);
  });

  it("logs an error message mentioning provision", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists() {
          return false;
        }
      })
    });

    await run(argv(), deps);

    const errorLogs = deps.logs.filter((l) => l.level === "error");
    expect(errorLogs.some((l) => l.message.includes("provision"))).toBe(true);
  });

  it("does not invoke wrangler when config is missing", async () => {
    let wranglerCalled = false;
    const deps = makeDeps({
      fs: makeFS({
        async fileExists() {
          return false;
        }
      }),
      wrangler: {
        async runTypes() {
          wranglerCalled = true;
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      }
    });

    await run(argv(), deps);

    expect(wranglerCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// exit 2 — wrangler could not be executed (spawn failure)
// ---------------------------------------------------------------------------

describe("exit 2 — wrangler spawn failure", () => {
  it("returns 2 when wrangler runner throws (e.g. ENOENT)", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG; // output missing → trigger run
        }
      }),
      wrangler: {
        async runTypes() {
          throw new Error("spawn npx ENOENT");
        }
      }
    });

    const code = await run(argv(), deps);

    expect(code).toBe(2);
  });

  it("logs the spawn error message", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      }),
      wrangler: {
        async runTypes() {
          throw new Error("spawn npx ENOENT");
        }
      }
    });

    await run(argv(), deps);

    const errorLogs = deps.logs.filter((l) => l.level === "error");
    expect(errorLogs.some((l) => l.message.includes("ENOENT"))).toBe(true);
  });

  it("returns 2 when runner throws a non-Error (plain string)", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      }),
      wrangler: {
        async runTypes() {
          // Deliberately a non-Error throw — this test exercises run()'s handling of a
          // WranglerRunner that violates its own contract by rejecting with a plain value.
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "plain string rejection";
        }
      }
    });

    const code = await run(argv(), deps);

    expect(code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// exit 3 — wrangler types returned non-zero
// ---------------------------------------------------------------------------

describe("exit 3 — wrangler types non-zero exit", () => {
  it("returns 3 when wrangler exits with code 1", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      }),
      wrangler: makeWrangler({ exitCode: 1, stderr: "Config not found" })
    });

    const code = await run(argv(), deps);

    expect(code).toBe(3);
  });

  it("returns 3 when wrangler exits with code 2", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      }),
      wrangler: makeWrangler({ exitCode: 2 })
    });

    const code = await run(argv(), deps);

    expect(code).toBe(3);
  });

  it("returns 3 when wrangler exit code is null (killed by signal)", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      }),
      wrangler: makeWrangler({ exitCode: null })
    });

    const code = await run(argv(), deps);

    expect(code).toBe(3);
  });

  it("logs an error with the exit code", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      }),
      wrangler: makeWrangler({ exitCode: 42 })
    });

    await run(argv(), deps);

    const errorLogs = deps.logs.filter((l) => l.level === "error");
    expect(errorLogs.some((l) => l.message.includes("42"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// exit 6 — argument errors
// ---------------------------------------------------------------------------

describe("exit 6 — argument errors", () => {
  it("returns 6 when --verbose and --quiet are both supplied", async () => {
    const deps = makeDeps();
    const code = await run(argv("--verbose", "--quiet"), deps);
    expect(code).toBe(6);
  });

  it("returns 6 for an unknown option", async () => {
    const deps = makeDeps();
    const code = await run(argv("--unknown-flag"), deps);
    expect(code).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// exit 99 — internal error
// ---------------------------------------------------------------------------

describe("exit 99 — internal error", () => {
  it("returns 99 when getModifiedTime throws unexpectedly", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists() {
          return true; // both config and output exist
        },
        async getModifiedTime() {
          throw new Error("unexpected stat error");
        }
      })
    });

    // Write stderr to /dev/null to suppress the internal error message.
    const write = process.stderr.write.bind(process.stderr);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const code = await run(argv(), deps);
      expect(code).toBe(99);
    } finally {
      vi.restoreAllMocks();
      void write;
    }
  });

  it("returns 99 on unexpected Commander.parse throw", async () => {
    const { Command: Cmd } = await import("commander");
    vi.spyOn(Cmd.prototype, "parse").mockImplementationOnce(() => {
      throw new TypeError("unexpected internal error");
    });

    const deps = makeDeps();
    const write = process.stderr.write.bind(process.stderr);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const code = await run(argv(), deps);
      expect(code).toBe(99);
    } finally {
      vi.restoreAllMocks();
      void write;
    }
  });
});

// ---------------------------------------------------------------------------
// Logging behaviour
// ---------------------------------------------------------------------------

describe("logging behaviour", () => {
  it("logs at info level by default (no -v or -q)", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      })
    });

    await run(argv(), deps);

    // Info log for "Wrote <output>" should be present.
    expect(deps.logs.some((l) => l.level === "info")).toBe(true);
    // Debug logs should NOT appear at default level.
    expect(deps.logs.some((l) => l.level === "debug")).toBe(false);
  });

  it("emits debug logs with --verbose", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      })
    });

    await run(argv("--verbose"), deps);

    expect(deps.logs.some((l) => l.level === "debug")).toBe(true);
  });

  it("suppresses info logs with --quiet", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      })
    });

    await run(argv("--quiet"), deps);

    expect(deps.logs.some((l) => l.level === "info")).toBe(false);
  });

  it("logs stale regeneration message at info level", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists() {
          return true;
        },
        async getModifiedTime(path) {
          if (path === CONFIG) return CONFIG_MTIME;
          return OUTPUT_MTIME_STALE; // output is older
        }
      })
    });

    await run(argv(), deps);

    const infoLogs = deps.logs.filter((l) => l.level === "info");
    expect(infoLogs.some((l) => l.message.includes("regenerating"))).toBe(true);
  });

  it("logs missing output message at info level", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      })
    });

    await run(argv(), deps);

    const infoLogs = deps.logs.filter((l) => l.level === "info");
    expect(infoLogs.some((l) => l.message.includes("generating"))).toBe(true);
  });

  it("logs captured wrangler stdout at debug level with --verbose", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      }),
      wrangler: makeWrangler({
        exitCode: 0,
        stdout: "✓ Generated types\n",
        stderr: ""
      })
    });

    await run(argv("--verbose"), deps);

    const debugLogs = deps.logs.filter((l) => l.level === "debug");
    expect(debugLogs.some((l) => l.message.includes("Generated types"))).toBe(true);
  });

  it("logs captured wrangler stderr at debug level with --verbose", async () => {
    const deps = makeDeps({
      fs: makeFS({
        async fileExists(path) {
          return path === CONFIG;
        }
      }),
      wrangler: makeWrangler({
        exitCode: 0,
        stdout: "",
        stderr: "warn: something\n"
      })
    });

    await run(argv("--verbose"), deps);

    const debugLogs = deps.logs.filter((l) => l.level === "debug");
    expect(debugLogs.some((l) => l.message.includes("warn: something"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("path resolution", () => {
  it("resolves relative --config and --output against --dir", async () => {
    let capturedOutput = "";
    const deps = makeDeps({
      fs: {
        async fileExists() {
          return true;
        },
        async getModifiedTime() {
          return OUTPUT_MTIME_STALE;
        } // force regeneration
      },
      wrangler: {
        async runTypes(outputPath) {
          capturedOutput = outputPath;
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      }
    });

    await run(
      [
        "node",
        "generate-wrangler-types",
        "--dir",
        "/project/src",
        "--config",
        "wrangler.jsonc",
        "--output",
        "worker-configuration.d.ts"
      ],
      deps
    );

    expect(capturedOutput).toBe("/project/src/worker-configuration.d.ts");
  });

  it("uses an absolute --output path as-is, ignoring --dir", async () => {
    let capturedOutput = "";
    const deps = makeDeps({
      fs: {
        async fileExists() {
          return true;
        },
        async getModifiedTime() {
          return OUTPUT_MTIME_STALE;
        }
      },
      wrangler: {
        async runTypes(outputPath) {
          capturedOutput = outputPath;
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      }
    });

    await run(
      [
        "node",
        "generate-wrangler-types",
        "--dir",
        "/project/src",
        "--config",
        "/absolute/wrangler.jsonc",
        "--output",
        "/absolute/worker-configuration.d.ts"
      ],
      deps
    );

    expect(capturedOutput).toBe("/absolute/worker-configuration.d.ts");
  });
});
