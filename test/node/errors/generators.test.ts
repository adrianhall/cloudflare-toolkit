import { describe, expect, it } from "vitest";
import {
  badRequest,
  contentTooLarge,
  forbidden,
  gone,
  internalServerError,
  methodNotAllowed,
  notFound,
  notImplemented,
  serviceUnavailable,
  unauthorized,
  unprocessableContent,
  unsupportedMediaType
} from "../../../src/lib/errors/index.js";
import { ProblemDetailsError } from "../../../src/lib/problem-details/index.js";
import type { ProblemDetailsError as ProblemDetailsErrorType } from "../../../src/lib/problem-details/index.js";
import type { HttpErrorInput } from "../../../src/lib/errors/generators.js";

const GENERATORS: [
  name: string,
  generator: (input?: HttpErrorInput) => ProblemDetailsErrorType,
  status: number,
  title: string
][] = [
  ["badRequest", badRequest, 400, "Bad Request"],
  ["unauthorized", unauthorized, 401, "Unauthorized"],
  ["forbidden", forbidden, 403, "Forbidden"],
  ["notFound", notFound, 404, "Not Found"],
  ["methodNotAllowed", methodNotAllowed, 405, "Method Not Allowed"],
  ["gone", gone, 410, "Gone"],
  ["contentTooLarge", contentTooLarge, 413, "Content Too Large"],
  ["unsupportedMediaType", unsupportedMediaType, 415, "Unsupported Media Type"],
  ["unprocessableContent", unprocessableContent, 422, "Unprocessable Content"],
  ["internalServerError", internalServerError, 500, "Internal Server Error"],
  ["notImplemented", notImplemented, 501, "Not Implemented"],
  ["serviceUnavailable", serviceUnavailable, 503, "Service Unavailable"]
];

describe.each(GENERATORS)("%s(input?)", (_name, generator, status, title) => {
  it(`produces a ${status} ProblemDetailsError with no input`, () => {
    const error = generator();
    expect(error).toBeInstanceOf(ProblemDetailsError);
    expect(error.problemDetails.status).toBe(status);
    expect(error.problemDetails.title).toBe(title);
    expect(error.problemDetails.type).toBe("about:blank");
    expect(error.problemDetails.detail).toBeUndefined();
    expect(error.problemDetails.instance).toBeUndefined();
    expect(error.problemDetails.extensions).toBeUndefined();
  });

  it("forwards detail/type/instance/extensions untouched", () => {
    const error = generator({
      detail: "custom detail message",
      type: "https://example.com/problems/custom",
      instance: "/resource/123",
      extensions: { field: "value" }
    });
    expect(error.problemDetails.status).toBe(status);
    expect(error.problemDetails.title).toBe(title);
    expect(error.problemDetails.detail).toBe("custom detail message");
    expect(error.problemDetails.type).toBe("https://example.com/problems/custom");
    expect(error.problemDetails.instance).toBe("/resource/123");
    expect(error.problemDetails.extensions).toEqual({ field: "value" });
  });
});

describe("HTTP error generators", () => {
  it("are not framework-specific — throwing/catching works outside any Hono context", () => {
    expect(() => {
      throw notFound({ detail: "Order 123 does not exist" });
    }).toThrow(ProblemDetailsError);
  });

  it("429/304/409/412 generators are deliberately not exported", async () => {
    const generatorsModule: Record<string, unknown> =
      await import("../../../src/lib/errors/generators.js");
    for (const forbiddenName of [
      "tooManyRequests",
      "notModified",
      "conflict",
      "preconditionFailed"
    ]) {
      expect(generatorsModule[forbiddenName]).toBeUndefined();
    }
  });
});
