import { describe, expect, it } from "vitest";
import { InvalidShapeError, internalServerError } from "../../../src/lib/errors/index.js";
import { ProblemDetailsError } from "../../../src/lib/problem-details/index.js";

describe("InvalidShapeError", () => {
  it("is a ProblemDetailsError (and thus an Error)", () => {
    const error = new InvalidShapeError("value did not have the expected shape");
    expect(error).toBeInstanceOf(ProblemDetailsError);
    expect(error).toBeInstanceOf(Error);
  });

  it("has the same status/title/type shape as internalServerError()", () => {
    const error = new InvalidShapeError("value did not have the expected shape");
    expect(error.problemDetails.status).toBe(500);
    expect(error.problemDetails.title).toBe("Internal Server Error");
    expect(error.problemDetails.type).toBe("about:blank");
  });

  it("produces an identical problemDetails shape to internalServerError({ detail }) for the same message", () => {
    const invalidShapeError = new InvalidShapeError("row is not an object");
    const serverError = internalServerError({ detail: "row is not an object" });
    expect(invalidShapeError.problemDetails).toEqual(serverError.problemDetails);
  });

  it("carries the message as the problem detail and Error#message", () => {
    const error = new InvalidShapeError("value did not have the expected shape");
    expect(error.problemDetails.detail).toBe("value did not have the expected shape");
    expect(error.message).toBe("value did not have the expected shape");
  });

  it("sets its own error name for logging/debugging, without affecting instanceof handling", () => {
    const error = new InvalidShapeError("boom");
    expect(error.name).toBe("InvalidShapeError");
    expect(error).toBeInstanceOf(ProblemDetailsError);
  });

  it("produces the same application/problem+json response shape as internalServerError()", async () => {
    const error = new InvalidShapeError("boom");
    const response = error.getResponse();
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json; charset=utf-8");
    const body = await response.json();
    expect(body).toMatchObject({
      type: "about:blank",
      status: 500,
      title: "Internal Server Error",
      detail: "boom"
    });
  });
});
