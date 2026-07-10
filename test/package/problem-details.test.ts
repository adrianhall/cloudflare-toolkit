import { describe, expect, it } from "vitest";
import * as problemDetails from "@adrianhall/cloudflare-toolkit/problem-details";

describe("dist problem-details/index.js — exports", () => {
  it("exports ProblemDetailsError as a class", () => {
    expect(typeof problemDetails.ProblemDetailsError).toBe("function");
  });

  it("exports problemDetails as a function", () => {
    expect(typeof problemDetails.problemDetails).toBe("function");
  });

  it("exports createProblemTypeRegistry as a function", () => {
    expect(typeof problemDetails.createProblemTypeRegistry).toBe("function");
  });

  it("exports statusToPhrase as a function", () => {
    expect(typeof problemDetails.statusToPhrase).toBe("function");
  });

  it("exports statusToSlug as a function", () => {
    expect(typeof problemDetails.statusToSlug).toBe("function");
  });

  it("exports exactly the documented runtime symbols", () => {
    expect(Object.keys(problemDetails).sort()).toStrictEqual(
      [
        "ProblemDetailsError",
        "problemDetails",
        "createProblemTypeRegistry",
        "statusToPhrase",
        "statusToSlug"
      ].sort()
    );
  });

  it("does not leak Hono-wired symbols (problemDetailsErrorHandler is /hono-only)", () => {
    expect(Object.keys(problemDetails)).not.toContain("problemDetailsErrorHandler");
  });
});

describe("problem-details smoke test against the built dist/", () => {
  it("problemDetails() builds a ProblemDetailsError with a derived title", () => {
    const error = problemDetails.problemDetails({ status: 404 });
    expect(error).toBeInstanceOf(problemDetails.ProblemDetailsError);
    expect(error.problemDetails.status).toBe(404);
    expect(error.problemDetails.title).toBe(problemDetails.statusToPhrase(404));
  });

  it("statusToPhrase/statusToSlug agree on the same status code", () => {
    expect(problemDetails.statusToPhrase(404)).toBe("Not Found");
    expect(problemDetails.statusToSlug(404)).toBe("not-found");
  });

  it("createProblemTypeRegistry builds a working registry from definitions", () => {
    const registry = problemDetails.createProblemTypeRegistry({
      ORDER_CONFLICT: {
        type: "https://example.com/problems/order-conflict",
        status: 409,
        title: "Order Conflict"
      }
    });
    expect(registry.types()).toStrictEqual(["ORDER_CONFLICT"]);
    const error = registry.create("ORDER_CONFLICT", { detail: "Already exists" });
    expect(error).toBeInstanceOf(problemDetails.ProblemDetailsError);
    expect(error.problemDetails.status).toBe(409);
    expect(error.problemDetails.detail).toBe("Already exists");
  });
});
