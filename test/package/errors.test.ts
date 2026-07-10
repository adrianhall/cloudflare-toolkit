import { describe, expect, it } from "vitest";
import * as errors from "@adrianhall/cloudflare-toolkit/errors";
import { ProblemDetailsError } from "@adrianhall/cloudflare-toolkit/problem-details";

const GENERATORS: [name: string, status: number][] = [
  ["badRequest", 400],
  ["unauthorized", 401],
  ["forbidden", 403],
  ["notFound", 404],
  ["methodNotAllowed", 405],
  ["gone", 410],
  ["unsupportedMediaType", 415],
  ["unprocessableContent", 422],
  ["internalServerError", 500],
  ["notImplemented", 501],
  ["serviceUnavailable", 503]
];

describe("dist errors/index.js — exports", () => {
  it.each(GENERATORS)("exports %s as a function", (name) => {
    expect(typeof errors[name as keyof typeof errors]).toBe("function");
  });

  it("exports InvalidShapeError and NullError as classes", () => {
    expect(typeof errors.InvalidShapeError).toBe("function");
    expect(typeof errors.NullError).toBe("function");
  });

  it("exports exactly the documented runtime symbols", () => {
    expect(Object.keys(errors).sort()).toStrictEqual(
      [...GENERATORS.map(([name]) => name), "InvalidShapeError", "NullError"].sort()
    );
  });
});

describe("error generators smoke test against the built dist/", () => {
  it.each(GENERATORS)("%s produces the %i-status ProblemDetailsError", (name, status) => {
    const generator = errors[name as keyof typeof errors] as (input?: {
      detail?: string;
    }) => ProblemDetailsError;
    const error = generator({ detail: "boom" });
    expect(error).toBeInstanceOf(ProblemDetailsError);
    expect(error.problemDetails.status).toBe(status);
    expect(error.problemDetails.detail).toBe("boom");
  });
});

describe("NullError/InvalidShapeError — cross-subpath identity", () => {
  // Both classes are `ProblemDetailsError` subclasses declared in a module that `./errors`
  // depends on. tsup's default ESM code-splitting extracts that shared code into one chunk that
  // both the `./errors` and `./problem-details` built entries import,
  // so a single `NullError`/`InvalidShapeError` thrown here must still satisfy `instanceof
  // ProblemDetailsError` when `ProblemDetailsError` is imported from the *other* built entry
  // point — proving the two entries were not each given their own duplicate copy of the class.
  it("NullError is an instance of ProblemDetailsError imported from a different built entry", () => {
    const error = new errors.NullError("unexpected null");
    expect(error).toBeInstanceOf(ProblemDetailsError);
    expect(error.problemDetails.status).toBe(500);
  });

  it("InvalidShapeError is an instance of ProblemDetailsError imported from a different built entry", () => {
    const error = new errors.InvalidShapeError("unexpected shape");
    expect(error).toBeInstanceOf(ProblemDetailsError);
    expect(error.problemDetails.status).toBe(500);
  });
});
