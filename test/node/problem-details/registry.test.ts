import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createProblemTypeRegistry,
  ProblemDetailsError
} from "../../../src/lib/problem-details/index.js";

describe("createProblemTypeRegistry", () => {
  const registry = createProblemTypeRegistry({
    ORDER_CONFLICT: {
      type: "https://api.example.com/problems/order-conflict",
      status: 409,
      title: "Order Conflict"
    },
    RATE_LIMITED: {
      type: "https://api.example.com/problems/rate-limited",
      status: 429,
      title: "Too Many Requests"
    },
    NOT_FOUND: {
      type: "https://api.example.com/problems/not-found",
      status: 404,
      title: "Not Found"
    }
  });

  it("create() returns ProblemDetailsError with registered type", () => {
    const error = registry.create("ORDER_CONFLICT");
    expect(error.problemDetails.type).toBe("https://api.example.com/problems/order-conflict");
    expect(error.problemDetails.status).toBe(409);
    expect(error.problemDetails.title).toBe("Order Conflict");
  });

  it("create() accepts overrides for detail and instance", () => {
    const error = registry.create("NOT_FOUND", {
      detail: "User 123 not found",
      instance: "/users/123"
    });
    expect(error.problemDetails.detail).toBe("User 123 not found");
    expect(error.problemDetails.instance).toBe("/users/123");
  });

  it("create() accepts extensions", () => {
    const error = registry.create("RATE_LIMITED", {
      extensions: { retryAfter: 60 }
    });
    expect(error.problemDetails.extensions).toEqual({ retryAfter: 60 });
  });

  it("create() returns ProblemDetailsError instance", () => {
    const error = registry.create("ORDER_CONFLICT");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ProblemDetailsError");
  });

  it("getResponse() works on registry-created errors", async () => {
    const error = registry.create("NOT_FOUND", { detail: "Item missing" });
    const res = error.getResponse();
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json; charset=utf-8");

    const body = await res.json();
    expect(body.type).toBe("https://api.example.com/problems/not-found");
    expect(body.detail).toBe("Item missing");
  });

  it("get() returns the registered type definition", () => {
    const def = registry.get("ORDER_CONFLICT");
    expect(def).toEqual({
      type: "https://api.example.com/problems/order-conflict",
      status: 409,
      title: "Order Conflict"
    });
  });

  it("get() returns a fresh object on every call, not a shared reference", () => {
    expect(registry.get("ORDER_CONFLICT")).not.toBe(registry.get("ORDER_CONFLICT"));
  });

  it("mutating the object returned by get() does not affect the registry", () => {
    const def = registry.get("ORDER_CONFLICT");
    // Bypass the readonly typing to simulate a consumer mutating the returned value at runtime
    // (e.g. plain JS, or a TS caller that casts around the readonly guard).
    (def as { title: string }).title = "Mutated Title";

    expect(registry.get("ORDER_CONFLICT").title).toBe("Order Conflict");
    expect(registry.create("ORDER_CONFLICT").problemDetails.title).toBe("Order Conflict");
  });

  it("types() returns all registered type keys", () => {
    const keys = registry.types();
    expect(keys).toEqual(["ORDER_CONFLICT", "RATE_LIMITED", "NOT_FOUND"]);
  });

  it("create() returns correct type", () => {
    const error = registry.create("ORDER_CONFLICT");
    expectTypeOf(error).toMatchTypeOf<ProblemDetailsError>();
  });

  it("empty registry returns empty types array", () => {
    const empty = createProblemTypeRegistry({});
    expect(empty.types()).toEqual([]);
  });

  it("create() without options omits detail and instance", () => {
    const error = registry.create("ORDER_CONFLICT");
    expect(error.problemDetails.detail).toBeUndefined();
    expect(error.problemDetails.instance).toBeUndefined();
    expect(error.problemDetails.extensions).toBeUndefined();
  });
});
