import { describe, expect, it } from "vitest";
import { matchPolicy } from "../../../src/lib/auth-internal/policy.js";
import type { PathPolicy } from "../../../src/lib/auth-internal/types.js";

describe("matchPolicy", () => {
  const policies: PathPolicy[] = [
    { pattern: /^\/api\/version$/, authenticate: false },
    { pattern: /^\/api\/ws$/, authenticate: true, redirect: false },
    { pattern: /^\/api\//, authenticate: true },
    { pattern: /^\/dashboard/, authenticate: true, redirect: true }
  ];

  it("returns undefined when no policy matches", () => {
    expect(matchPolicy("/unknown", policies)).toBeUndefined();
  });

  it("returns authenticate: false for a public path", () => {
    const result = matchPolicy("/api/version", policies);
    expect(result).toEqual({ authenticate: false, redirect: true });
  });

  it("returns authenticate: true with redirect defaulting to true", () => {
    const result = matchPolicy("/api/data", policies);
    expect(result).toEqual({ authenticate: true, redirect: true });
  });

  it("returns redirect: false when explicitly set on the policy", () => {
    const result = matchPolicy("/api/ws", policies);
    expect(result).toEqual({ authenticate: true, redirect: false });
  });

  it("returns redirect: true when explicitly set on the policy", () => {
    const result = matchPolicy("/dashboard", policies);
    expect(result).toEqual({ authenticate: true, redirect: true });
  });

  it("uses first-match-wins ordering", () => {
    // /api/version matches the first rule (false) before /api/ (true).
    const result = matchPolicy("/api/version", policies);
    expect(result?.authenticate).toBe(false);
  });

  it("returns undefined for an empty policy array", () => {
    expect(matchPolicy("/anything", [])).toBeUndefined();
  });

  it("defaults redirect to true when not specified on a public policy", () => {
    const result = matchPolicy("/api/version", policies);
    // The first rule { authenticate: false } has no redirect property.
    expect(result?.redirect).toBe(true);
  });

  describe("audience (#181)", () => {
    const audiencePolicies: PathPolicy[] = [
      {
        pattern: /^\/api\/contributor/,
        authenticate: true,
        redirect: false,
        audience: "contrib-aud"
      },
      { pattern: /^\/api\/reviewer/, authenticate: true, redirect: false, audience: "review-aud" },
      { pattern: /^\/api\//, authenticate: true }
    ];

    it("returns the audience selected by the first matching policy", () => {
      const result = matchPolicy("/api/contributor/docs", audiencePolicies);
      expect(result).toEqual({ authenticate: true, redirect: false, audience: "contrib-aud" });
    });

    it("selects a different audience for a different matching policy", () => {
      const result = matchPolicy("/api/reviewer/docs", audiencePolicies);
      expect(result?.audience).toBe("review-aud");
    });

    it("leaves audience undefined when the matched policy does not specify one", () => {
      const result = matchPolicy("/api/other", audiencePolicies);
      expect(result?.authenticate).toBe(true);
      expect(result?.audience).toBeUndefined();
    });

    it("leaves audience undefined for public policies without one", () => {
      const result = matchPolicy("/api/version", policies);
      expect(result?.audience).toBeUndefined();
    });
  });
});
