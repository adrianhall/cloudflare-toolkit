// Tests for matchPolicy (docs/SPECv2.md §5.9, issue #12). Ported from
// adrianhall/cloudflare-auth's `tests/policy.test.ts` (same author, MIT — see docs/SPECv2.md
// §10), adjusted only for the new import path. Imports directly from the module (not a barrel —
// auth-internal has no public export, docs/SPECv2.md §5.9).
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
});
