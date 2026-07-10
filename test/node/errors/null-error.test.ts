import { describe, expect, it } from "vitest";
import { NullError, internalServerError } from "../../../src/lib/errors/index.js";
import { ProblemDetailsError } from "../../../src/lib/problem-details/index.js";

describe("NullError", () => {
  it("is a ProblemDetailsError (and thus an Error)", () => {
    const error = new NullError("value was unexpectedly null");
    expect(error).toBeInstanceOf(ProblemDetailsError);
    expect(error).toBeInstanceOf(Error);
  });

  it("has the same status/title/type shape as internalServerError()", () => {
    const error = new NullError("value was unexpectedly null");
    expect(error.problemDetails.status).toBe(500);
    expect(error.problemDetails.title).toBe("Internal Server Error");
    expect(error.problemDetails.type).toBe("about:blank");
  });

  it("produces an identical problemDetails shape to internalServerError({ detail }) for the same message", () => {
    const nullError = new NullError("row missing");
    const serverError = internalServerError({ detail: "row missing" });
    expect(nullError.problemDetails).toEqual(serverError.problemDetails);
  });

  it("carries the message as the problem detail and Error#message", () => {
    const error = new NullError("value was unexpectedly null");
    expect(error.problemDetails.detail).toBe("value was unexpectedly null");
    expect(error.message).toBe("value was unexpectedly null");
  });

  it("sets its own error name for logging/debugging, without affecting instanceof handling", () => {
    const error = new NullError("boom");
    expect(error.name).toBe("NullError");
    expect(error).toBeInstanceOf(ProblemDetailsError);
  });

  it("produces the same application/problem+json response shape as internalServerError()", async () => {
    const error = new NullError("boom");
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
