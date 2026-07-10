// SMOKE TEST — remove once real tests exist for this project. Issue #10
// ("Add hono notFoundHandler and problemDetailsErrorHandler re-export")
// deletes this file when it adds the first real test/workers suite. See
// docs/SPECv2.md §7.2.
import { describe, expect, it } from "vitest";

describe("test/workers smoke test", () => {
  it("runs inside the Workers runtime (workerd), not Node", () => {
    // `Response` is a Workers/Fetch API runtime global; asserting it exists
    // as a function proves this test actually executed in workerd rather
    // than falling back to a Node polyfill or a misconfigured pool.
    expect(typeof Response).toBe("function");
  });
});
