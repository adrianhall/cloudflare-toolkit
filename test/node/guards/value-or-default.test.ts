// Tests for valueOrDefault (docs/SPECv2.md §5.2) — literally `value ?? defaultValue`, covering
// the null, undefined, and defined-value cases. Imports from the public barrel, matching how a
// consumer would use `@adrianhall/cloudflare-toolkit/guards`.
import { describe, expect, it } from "vitest";
import { valueOrDefault } from "../../../src/lib/guards/index.js";

describe("valueOrDefault", () => {
  it("returns the default value when value is null", () => {
    expect(valueOrDefault(null, "fallback")).toBe("fallback");
  });

  it("returns the default value when value is undefined", () => {
    expect(valueOrDefault(undefined, "fallback")).toBe("fallback");
  });

  it("returns value itself when it is defined and non-null", () => {
    expect(valueOrDefault("actual", "fallback")).toBe("actual");
  });

  it("returns falsy-but-defined values as-is (0, '', false) rather than the default", () => {
    expect(valueOrDefault(0, 42)).toBe(0);
    expect(valueOrDefault("", "fallback")).toBe("");
    expect(valueOrDefault(false, true)).toBe(false);
  });
});
