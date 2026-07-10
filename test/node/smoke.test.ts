// SMOKE TEST — remove once real tests exist for this project. Issue #5
// ("Vendor RFC 9457 problem-details core primitives") deletes this file
// when it adds the first real test/node suite. See docs/SPECv2.md §7.2.
import { describe, expect, it } from "vitest";

describe("test/node smoke test", () => {
  it("runs in a plain Node environment", () => {
    expect(1 + 1).toBe(2);
  });
});
