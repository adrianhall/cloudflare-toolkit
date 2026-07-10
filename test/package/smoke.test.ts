// SMOKE TEST — replace (not just delete) once dist/ exists to import from.
// Issue #9 ("Wire root barrel, tsup build, package.json exports, and real
// test/package suite") adds the build step and the first real assertions
// against the built dist/ output. See docs/SPECv2.md §7.2.
import { describe, expect, it } from "vitest";

describe("test/package smoke test", () => {
  it("runs in a plain Node environment", () => {
    expect(1 + 1).toBe(2);
  });
});
