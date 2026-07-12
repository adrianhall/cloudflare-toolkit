import { describe, expect, it } from "vitest";
import {
  ensureHttps,
  getRemoteJwks,
  MAX_JWKS_CACHE_ENTRIES,
  normalizeTeamDomain
} from "../../../src/lib/auth-internal/jwks.js";

describe("ensureHttps", () => {
  it("returns the URL unchanged when it already starts with https://", () => {
    expect(ensureHttps("https://example.com")).toBe("https://example.com");
  });

  it("prepends https:// when the URL has no scheme", () => {
    expect(ensureHttps("example.com")).toBe("https://example.com");
  });

  it("throws when given an explicit http:// URL instead of double-prefixing it", () => {
    expect(() => ensureHttps("http://example.com")).toThrow(
      'Expected an https:// URL, got: "http://example.com"'
    );
  });

  it("throws for a non-http(s) explicit scheme (e.g. ftp://)", () => {
    expect(() => ensureHttps("ftp://example.com")).toThrow(
      'Expected an https:// URL, got: "ftp://example.com"'
    );
  });

  it("handles an empty string", () => {
    expect(ensureHttps("")).toBe("https://");
  });
});

describe("normalizeTeamDomain", () => {
  it("prepends https:// and returns the origin for a bare domain", () => {
    expect(normalizeTeamDomain("my-team.cloudflareaccess.com")).toBe(
      "https://my-team.cloudflareaccess.com"
    );
  });

  it("strips a trailing slash", () => {
    expect(normalizeTeamDomain("my-team.cloudflareaccess.com/")).toBe(
      "https://my-team.cloudflareaccess.com"
    );
  });

  it("returns the same origin for an already-https:// domain", () => {
    expect(normalizeTeamDomain("https://my-team.cloudflareaccess.com")).toBe(
      "https://my-team.cloudflareaccess.com"
    );
  });

  it("strips any path from the input, keeping only the origin", () => {
    expect(normalizeTeamDomain("https://my-team.cloudflareaccess.com/some/path")).toBe(
      "https://my-team.cloudflareaccess.com"
    );
  });

  describe("SECURITY: team-domain host allowlist (SEC-003/SEC-009/CODE-004)", () => {
    it("rejects a domain that is not a *.cloudflareaccess.com host", () => {
      expect(() => normalizeTeamDomain("example.com")).toThrow(
        'Invalid Cloudflare Access team domain: "example.com"'
      );
    });

    it("rejects the bare cloudflareaccess.com host with no team label", () => {
      expect(() => normalizeTeamDomain("cloudflareaccess.com")).toThrow(
        'Invalid Cloudflare Access team domain: "cloudflareaccess.com"'
      );
    });

    it("rejects a suffix-spoofing attempt appended after the real cloudflareaccess.com host", () => {
      expect(() => normalizeTeamDomain("my-team.cloudflareaccess.com.attacker.example")).toThrow(
        'Invalid Cloudflare Access team domain: "my-team.cloudflareaccess.com.attacker.example"'
      );
    });

    it("rejects a userinfo-embedding trick (legit host as userinfo, attacker host as the real host)", () => {
      expect(() => normalizeTeamDomain("legit-team.cloudflareaccess.com@evil.example")).toThrow(
        'Invalid Cloudflare Access team domain: "legit-team.cloudflareaccess.com@evil.example"'
      );
    });

    it("rejects an explicit non-https:// scheme (delegated to ensureHttps)", () => {
      expect(() => normalizeTeamDomain("http://my-team.cloudflareaccess.com")).toThrow(
        'Expected an https:// URL, got: "http://my-team.cloudflareaccess.com"'
      );
    });
  });
});

describe("getRemoteJwks", () => {
  it("caches and returns the same instance for repeated calls with the same domain", () => {
    const first = getRemoteJwks("jwks-cache-test-a.cloudflareaccess.com");
    const second = getRemoteJwks("jwks-cache-test-a.cloudflareaccess.com");
    expect(second).toBe(first);
  });

  it("normalizes a trailing slash so it hits the same cache entry", () => {
    const withoutSlash = getRemoteJwks("jwks-cache-test-b.cloudflareaccess.com");
    const withSlash = getRemoteJwks("jwks-cache-test-b.cloudflareaccess.com/");
    expect(withSlash).toBe(withoutSlash);
  });

  it("normalizes an explicit https:// prefix so it hits the same cache entry", () => {
    const bare = getRemoteJwks("jwks-cache-test-c.cloudflareaccess.com");
    const withScheme = getRemoteJwks("https://jwks-cache-test-c.cloudflareaccess.com");
    expect(withScheme).toBe(bare);
  });

  it("returns a distinct instance for a different domain (cache invalidation/refresh)", () => {
    const domainOne = getRemoteJwks("jwks-cache-test-d.cloudflareaccess.com");
    const domainTwo = getRemoteJwks("jwks-cache-test-e.cloudflareaccess.com");
    expect(domainTwo).not.toBe(domainOne);
  });

  describe("SECURITY: team-domain host allowlist (SEC-009/CODE-004)", () => {
    it("rejects a domain that is not a *.cloudflareaccess.com host", () => {
      expect(() => getRemoteJwks("example.com")).toThrow(
        'Invalid Cloudflare Access team domain: "example.com"'
      );
    });

    it("rejects the bare cloudflareaccess.com host with no team label", () => {
      expect(() => getRemoteJwks("cloudflareaccess.com")).toThrow(
        'Invalid Cloudflare Access team domain: "cloudflareaccess.com"'
      );
    });

    it("rejects a suffix-spoofing attempt appended after the real cloudflareaccess.com host", () => {
      expect(() => getRemoteJwks("my-team.cloudflareaccess.com.attacker.example")).toThrow(
        'Invalid Cloudflare Access team domain: "my-team.cloudflareaccess.com.attacker.example"'
      );
    });

    it("rejects a userinfo-embedding trick (legit host as userinfo, attacker host as the real host)", () => {
      expect(() => getRemoteJwks("legit-team.cloudflareaccess.com@evil.example")).toThrow(
        'Invalid Cloudflare Access team domain: "legit-team.cloudflareaccess.com@evil.example"'
      );
    });
  });

  describe("bounded cache (unbounded-memory-growth hardening)", () => {
    it("evicts the oldest entry once the cache exceeds its maximum size", () => {
      const domains = Array.from(
        { length: MAX_JWKS_CACHE_ENTRIES + 1 },
        (_, i) => `jwks-cache-bound-test-${i}.cloudflareaccess.com`
      );

      const instances = domains.map((domain) => getRemoteJwks(domain));

      // The oldest entry (index 0) was evicted to make room for the (MAX + 1)th insertion, so
      // requesting it again must produce a *new* instance rather than the original.
      const oldestAgain = getRemoteJwks(domains[0]);
      expect(oldestAgain).not.toBe(instances[0]);

      // The most recently inserted entry must still be cached (not evicted).
      const newestAgain = getRemoteJwks(domains[domains.length - 1]);
      expect(newestAgain).toBe(instances[instances.length - 1]);
    });
  });
});
