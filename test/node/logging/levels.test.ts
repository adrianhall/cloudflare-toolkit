// Adapted from adrianhall/cloudflare-logger's test/node/levels.test.ts (same author; source
// repo is read-only per docs/SPECv2.md §10, not modified by this port).
//
// `LOG_LEVELS`/`levelValue` are internal implementation details, not exported from
// `src/lib/logging/index.ts` — tested here by importing the module directly rather than through
// the public barrel.
import { describe, expect, it } from "vitest";
import * as sut from "../../../src/lib/logging/levels.js";

describe("LOG_LEVELS", () => {
  it("has exactly the six documented levels", () => {
    expect(Object.keys(sut.LOG_LEVELS)).toStrictEqual([
      "trace",
      "debug",
      "info",
      "warn",
      "error",
      "fatal"
    ]);
  });
});

describe("levelValue()", () => {
  it("throws a TypeError for an unrecognized level string", () => {
    expect(() =>
      // Cast needed to simulate a bad runtime value arriving from untyped JS.
      sut.levelValue("verbose" as Parameters<typeof sut.levelValue>[0])
    ).toThrow(TypeError);
  });

  it("TypeError message includes the invalid level name", () => {
    expect(() => sut.levelValue("bogus" as Parameters<typeof sut.levelValue>[0])).toThrow(/bogus/);
  });

  it("TypeError message lists valid level names", () => {
    expect(() => sut.levelValue("nope" as Parameters<typeof sut.levelValue>[0])).toThrow(/trace/);
  });

  it("levels are strictly ordered trace < debug < info < warn < error < fatal", () => {
    const ordered = (["trace", "debug", "info", "warn", "error", "fatal"] as const).map(
      sut.levelValue
    );
    for (let i = 1; i < ordered.length; i++) {
      // Non-null assertion safe because the array is statically constructed.
      expect(ordered[i]!).toBeGreaterThan(ordered[i - 1]!);
    }
  });
});
