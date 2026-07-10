import { describe, expect, it } from "vitest";
import * as guards from "@adrianhall/cloudflare-toolkit/guards";

describe("dist guards/index.js — exports", () => {
  it("exports sqlCount as a function", () => {
    expect(typeof guards.sqlCount).toBe("function");
  });

  it("exports throwIfNull as a function", () => {
    expect(typeof guards.throwIfNull).toBe("function");
  });

  it("exports valueOrDefault as a function", () => {
    expect(typeof guards.valueOrDefault).toBe("function");
  });

  it("exports exactly the documented runtime symbols", () => {
    expect(Object.keys(guards).sort()).toStrictEqual(
      ["sqlCount", "throwIfNull", "valueOrDefault"].sort()
    );
  });
});

describe("guards smoke test against the built dist/", () => {
  it("valueOrDefault falls back to the default for null/undefined", () => {
    expect(guards.valueOrDefault(null, "fallback")).toBe("fallback");
    expect(guards.valueOrDefault("value", "fallback")).toBe("value");
  });

  it("throwIfNull throws for null/undefined and narrows for defined values", () => {
    expect(() => guards.throwIfNull(null, "boom")).toThrow();
    expect(() => guards.throwIfNull(undefined, "boom")).toThrow();
    expect(() => guards.throwIfNull("value", "boom")).not.toThrow();
  });

  it("sqlCount reads the count property off a D1-shaped row", () => {
    expect(guards.sqlCount({ count: 5 })).toBe(5);
  });
});
