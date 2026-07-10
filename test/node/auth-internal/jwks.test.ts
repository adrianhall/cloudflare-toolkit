import { describe, expect, it } from "vitest";
import { ensureHttps, getRemoteJwks } from "../../../src/lib/auth-internal/jwks.js";

describe("ensureHttps", () => {
  it("returns the URL unchanged when it already starts with https://", () => {
    expect(ensureHttps("https://example.com")).toBe("https://example.com");
  });

  it("prepends https:// when the URL has no scheme", () => {
    expect(ensureHttps("example.com")).toBe("https://example.com");
  });

  it("prepends https:// to an http:// URL (does not replace)", () => {
    expect(ensureHttps("http://example.com")).toBe("https://http://example.com");
  });

  it("handles an empty string", () => {
    expect(ensureHttps("")).toBe("https://");
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
});
