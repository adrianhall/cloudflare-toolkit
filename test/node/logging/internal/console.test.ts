// Adapted from adrianhall/cloudflare-logger's test/node/internal/console.test.ts (same author;
// source repo is read-only per docs/SPECv2.md §10, not modified by this port).
//
// `getConsoleMethod` is an internal helper, not exported from `src/lib/logging/index.ts` —
// tested here by importing the module directly rather than through the public barrel.
import { describe, expect, it, vi } from "vitest";
import * as sut from "../../../../src/lib/logging/internal/console.js";

/** Build a minimal ConsoleLike with all five standard methods as spies. */
function makeFullConsole(): sut.ConsoleLike
  & Record<sut.ConsoleMethodName, ReturnType<typeof vi.fn>> {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("getConsoleMethod()", () => {
  it("returns console.debug when requested and present", () => {
    const c = makeFullConsole();
    const method = sut.getConsoleMethod(c, "debug");
    method("hello");
    expect(c.debug).toHaveBeenCalledWith("hello");
  });

  it("returns console.info when requested and present", () => {
    const c = makeFullConsole();
    const method = sut.getConsoleMethod(c, "info");
    method("msg");
    expect(c.info).toHaveBeenCalledWith("msg");
  });

  it("returns console.log when requested and present", () => {
    const c = makeFullConsole();
    const method = sut.getConsoleMethod(c, "log");
    method("msg");
    expect(c.log).toHaveBeenCalledWith("msg");
  });

  it("returns console.warn when requested and present", () => {
    const c = makeFullConsole();
    const method = sut.getConsoleMethod(c, "warn");
    method("msg");
    expect(c.warn).toHaveBeenCalledWith("msg");
  });

  it("returns console.error when requested and present", () => {
    const c = makeFullConsole();
    const method = sut.getConsoleMethod(c, "error");
    method("msg");
    expect(c.error).toHaveBeenCalledWith("msg");
  });

  it("falls back to console.log when the requested method is absent", () => {
    const c: sut.ConsoleLike = { log: vi.fn() };
    const method = sut.getConsoleMethod(c, "debug");
    method("fallback");
    expect(c.log).toHaveBeenCalledWith("fallback");
  });

  it("falls back to console.log when the requested property is not a function", () => {
    const c = {
      log: vi.fn(),
      // Deliberately non-function value to simulate an unusual environment.
      debug: "not-a-function" as unknown as sut.ConsoleMethod
    } satisfies sut.ConsoleLike;
    const method = sut.getConsoleMethod(c, "debug");
    method("fallback");
    expect(c.log).toHaveBeenCalledWith("fallback");
  });

  it("does not call the fallback method when the primary method is present", () => {
    const c = makeFullConsole();
    sut.getConsoleMethod(c, "warn")("msg");
    expect(c.log).not.toHaveBeenCalled();
  });

  it("returns different methods for different requested names", () => {
    const c = makeFullConsole();
    const debug = sut.getConsoleMethod(c, "debug");
    const error = sut.getConsoleMethod(c, "error");
    debug("d");
    error("e");
    expect(c.debug).toHaveBeenCalledWith("d");
    expect(c.error).toHaveBeenCalledWith("e");
    expect(c.log).not.toHaveBeenCalled();
  });

  it("passes multiple arguments through to the underlying method", () => {
    const c = makeFullConsole();
    const method = sut.getConsoleMethod(c, "info");
    method("a", "b", { c: 1 });
    expect(c.info).toHaveBeenCalledWith("a", "b", { c: 1 });
  });

  it("passes multiple arguments through to the fallback log method", () => {
    const c: sut.ConsoleLike = { log: vi.fn() };
    const method = sut.getConsoleMethod(c, "warn");
    method("x", 42);
    expect(c.log).toHaveBeenCalledWith("x", 42);
  });
});
