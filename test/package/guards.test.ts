// Package-level export validation for `@adrianhall/cloudflare-toolkit/guards` (docs/SPECv2.md
// §5.1, §7.2). Imports the built package by name/subpath resolution (Node's self-referencing
// package feature resolves this against `package.json#exports` -> `dist/guards/index.js`), not
// a relative path into `src/` or `dist/` — this is what actually exercises `tsup`'s entry point
// and the `exports` map, catching a misconfiguration in either before publish.
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
