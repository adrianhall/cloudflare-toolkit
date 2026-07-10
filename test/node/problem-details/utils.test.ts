// Adapted from adrianhall/hono-problem-details's tests/utils.test.ts (MIT) — see
// THIRD-PARTY-NOTICES.md. Imports the module directly rather than the barrel: these helpers are
// intentionally internal (not part of the public export surface, docs/SPECv2.md §5.1/§5.4), so
// this is the "extract + unit-test the module directly" case from §7.3, not a coverage workaround.
import { describe, expect, it } from "vitest";
import {
  buildProblemResponse,
  clampHttpStatus,
  normalizeProblemDetails,
  PROBLEM_JSON_CONTENT_TYPE,
  safeStringify,
  sanitizeExtensions
} from "../../../src/lib/problem-details/utils.js";

describe("PROBLEM_JSON_CONTENT_TYPE", () => {
  it("matches RFC 9457 media type with charset", () => {
    expect(PROBLEM_JSON_CONTENT_TYPE).toBe("application/problem+json; charset=utf-8");
  });
});

describe("sanitizeExtensions", () => {
  it("returns undefined when input is undefined", () => {
    expect(sanitizeExtensions(undefined)).toBeUndefined();
  });

  it("returns same reference for empty object (no copy)", () => {
    const ext = {};
    expect(sanitizeExtensions(ext)).toBe(ext);
  });

  it("returns same reference when no dangerous keys present", () => {
    const ext = { foo: 1, bar: "baz" };
    expect(sanitizeExtensions(ext)).toBe(ext);
  });

  it("strips all three dangerous keys", () => {
    const result = sanitizeExtensions({
      __proto__: "a",
      constructor: "b",
      prototype: "c",
      safe: "ok"
    });
    expect(result).toEqual({ safe: "ok" });
  });

  it("returns new object (not same reference) when dangerous keys found", () => {
    const ext = { constructor: "bad", safe: "ok" };
    const result = sanitizeExtensions(ext);
    expect(result).not.toBe(ext);
    expect(result).toEqual({ safe: "ok" });
  });
});

describe("clampHttpStatus", () => {
  it.each([
    [200, 200],
    [299, 299],
    [300, 300],
    [399, 399],
    [400, 400],
    [599, 599]
  ])("passes through %d as-is", (input, expected) => {
    expect(clampHttpStatus(input)).toBe(expected);
  });

  it.each([
    [199, 500],
    [100, 500],
    [0, 500],
    [-1, 500],
    [600, 500],
    [9999, 500]
  ])("clamps %d to 500", (input, expected) => {
    expect(clampHttpStatus(input)).toBe(expected);
  });

  it("returns 500 for non-integer float", () => {
    expect(clampHttpStatus(200.5)).toBe(500);
  });

  it("returns 500 for numeric string", () => {
    expect(clampHttpStatus("200" as unknown as number)).toBe(500);
  });

  it("returns 500 for BigInt", () => {
    expect(clampHttpStatus(200n as unknown as number)).toBe(500);
  });

  it("returns 500 for NaN", () => {
    expect(clampHttpStatus(Number.NaN)).toBe(500);
  });

  it("returns 500 for Infinity", () => {
    expect(clampHttpStatus(Number.POSITIVE_INFINITY)).toBe(500);
  });
});

describe("normalizeProblemDetails", () => {
  it("defaults type to about:blank", () => {
    const pd = normalizeProblemDetails({ status: 404 });
    expect(pd.type).toBe("about:blank");
  });

  it("defaults title from status phrase", () => {
    const pd = normalizeProblemDetails({ status: 404 });
    expect(pd.title).toBe("Not Found");
  });

  it("falls back to Unknown Error for unknown status", () => {
    const pd = normalizeProblemDetails({ status: 999 });
    expect(pd.title).toBe("Unknown Error");
  });

  it("preserves explicit type and title", () => {
    const pd = normalizeProblemDetails({
      status: 400,
      type: "https://example.com/error",
      title: "Custom"
    });
    expect(pd.type).toBe("https://example.com/error");
    expect(pd.title).toBe("Custom");
  });

  it("passes through detail, instance, and extensions", () => {
    const pd = normalizeProblemDetails({
      status: 422,
      detail: "detail",
      instance: "/path",
      extensions: { key: "value" }
    });
    expect(pd.detail).toBe("detail");
    expect(pd.instance).toBe("/path");
    expect(pd.extensions).toEqual({ key: "value" });
  });
});

describe("safeStringify", () => {
  it("serializes plain object", () => {
    const { json, fallback } = safeStringify({ a: 1 });
    expect(fallback).toBe(false);
    expect(JSON.parse(json)).toEqual({ a: 1 });
  });

  it("returns fallback for circular reference", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const { json, fallback } = safeStringify(obj);
    expect(fallback).toBe(true);
    const body = JSON.parse(json);
    expect(body.type).toBe("about:blank");
    expect(body.status).toBe(500);
    expect(body.title).toBe("Internal Server Error");
  });

  it("returns fallback for BigInt", () => {
    const { fallback } = safeStringify({ big: BigInt(42) });
    expect(fallback).toBe(true);
  });
});

describe("buildProblemResponse", () => {
  it("builds response with correct status and Content-Type", async () => {
    const res = buildProblemResponse({
      type: "about:blank",
      status: 404,
      title: "Not Found"
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
    const body = await res.json();
    expect(body.type).toBe("about:blank");
    expect(body.status).toBe(404);
    expect(body.title).toBe("Not Found");
  });

  it("flattens extensions and strips dangerous keys", async () => {
    const res = buildProblemResponse({
      type: "about:blank",
      status: 400,
      title: "Bad Request",
      extensions: { constructor: "bad", info: "safe" }
    });
    const body = await res.json();
    expect(body.info).toBe("safe");
    expect(Object.hasOwn(body, "constructor")).toBe(false);
    expect(Object.hasOwn(body, "extensions")).toBe(false);
  });

  it("clamps out-of-range status to 500", async () => {
    const res = buildProblemResponse({
      type: "about:blank",
      status: 9999,
      title: "Invalid"
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe(9999);
  });

  it("returns fallback on circular extensions", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const res = buildProblemResponse({
      type: "about:blank",
      status: 422,
      title: "Test",
      extensions: circular
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.title).toBe("Internal Server Error");
  });
});
