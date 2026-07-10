// Package-level export validation for the root barrel, `@adrianhall/cloudflare-toolkit`
// (docs/SPECv2.md §5.1, §7.2). Imports the built package by name/subpath resolution against
// `dist/`, not a relative path — see guards.test.ts for why.
//
// This is the one place that proves the root barrel is exactly "guards + errors +
// problem-details + logging" (docs/SPECv2.md §5.1) — no more, no less, and never anything from a
// future `hono`/`vite`/`testing` subpath.
import { describe, expect, it } from "vitest";
import * as root from "@adrianhall/cloudflare-toolkit";
import * as guards from "@adrianhall/cloudflare-toolkit/guards";
import * as errors from "@adrianhall/cloudflare-toolkit/errors";
import * as problemDetails from "@adrianhall/cloudflare-toolkit/problem-details";
import * as logging from "@adrianhall/cloudflare-toolkit/logging";

const EXPECTED_RUNTIME_EXPORTS = [
  // guards
  "sqlCount",
  "throwIfNull",
  "valueOrDefault",
  // errors
  "badRequest",
  "unauthorized",
  "forbidden",
  "notFound",
  "methodNotAllowed",
  "gone",
  "unsupportedMediaType",
  "unprocessableContent",
  "internalServerError",
  "notImplemented",
  "serviceUnavailable",
  "InvalidShapeError",
  "NullError",
  // problem-details
  "ProblemDetailsError",
  "problemDetails",
  "createProblemTypeRegistry",
  "statusToPhrase",
  "statusToSlug",
  // logging
  "createLogger",
  "resolveLoggerConfig",
  "serializeError",
  "createBrowserTransport",
  "createCaptureTransport",
  "combineTransports",
  "createConsoleTransport",
  "createSilentTransport",
  "createStructuredTransport"
] as const;

describe("dist/index.js — root barrel exports", () => {
  it.each(EXPECTED_RUNTIME_EXPORTS)("exports %s as a function", (name) => {
    expect(typeof root[name]).toBe("function");
  });

  it("exports exactly the 30 documented runtime symbols (guards + errors + problem-details + logging)", () => {
    expect(Object.keys(root).sort()).toStrictEqual([...EXPECTED_RUNTIME_EXPORTS].sort());
    expect(Object.keys(root)).toHaveLength(30);
  });

  it("does not leak hono/vite/testing symbols", () => {
    const keys = Object.keys(root);
    // These subpaths are empty `export {}` stubs today (docs/SPECv2.md §5.1) and are populated
    // in later, separate issues — this test exists so that whichever future issue populates them
    // fails loudly here if it also (incorrectly) re-exports through the root barrel.
    for (const forbidden of [
      "cloudflareAccess",
      "cloudflareLogger",
      "problemDetailsErrorHandler",
      "notFoundHandler",
      "AuthVariables",
      "LoggerVariables",
      "CloudflareToolkitVariables",
      "cloudflareAccessPlugin"
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("dist/index.js — cross-entry identity (chunk-splitting sanity check)", () => {
  // Every symbol below is re-exported by the root barrel from a source module that its own
  // dedicated subpath entry (e.g. `./errors`) also exports. tsup's default ESM code-splitting
  // extracts that shared source into one common chunk that both the root and the subpath entry
  // import (docs/SPECv2.md — see tsup.config.ts), so the exact same class/function reference
  // must come back from both import paths — not two independently-bundled duplicates.
  it("guards re-exports are reference-identical to the ./guards entry", () => {
    expect(root.sqlCount).toBe(guards.sqlCount);
    expect(root.throwIfNull).toBe(guards.throwIfNull);
    expect(root.valueOrDefault).toBe(guards.valueOrDefault);
  });

  it("errors re-exports are reference-identical to the ./errors entry", () => {
    expect(root.badRequest).toBe(errors.badRequest);
    expect(root.NullError).toBe(errors.NullError);
    expect(root.InvalidShapeError).toBe(errors.InvalidShapeError);
  });

  it("problem-details re-exports are reference-identical to the ./problem-details entry", () => {
    expect(root.ProblemDetailsError).toBe(problemDetails.ProblemDetailsError);
    expect(root.problemDetails).toBe(problemDetails.problemDetails);
  });

  it("logging re-exports are reference-identical to the ./logging entry", () => {
    expect(root.createLogger).toBe(logging.createLogger);
    expect(root.createCaptureTransport).toBe(logging.createCaptureTransport);
  });

  it("a NullError thrown via ./guards is instanceof the ProblemDetailsError from ./problem-details", () => {
    let caught: unknown;
    try {
      guards.throwIfNull(null, "unexpectedly null");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(errors.NullError);
    expect(caught).toBeInstanceOf(problemDetails.ProblemDetailsError);
  });
});
