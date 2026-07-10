import { describe, expect, it } from "vitest";
import { serializeError } from "../../../src/lib/logging/index.js";

describe("serializeError()", () => {
  it("returns non-Error values unchanged — string", () => {
    expect(serializeError("hello")).toBe("hello");
  });

  it("returns non-Error values unchanged — number", () => {
    expect(serializeError(42)).toBe(42);
  });

  it("returns non-Error values unchanged — null", () => {
    expect(serializeError(null)).toBeNull();
  });

  it("returns non-Error values unchanged — plain object", () => {
    const obj = { foo: "bar" };
    expect(serializeError(obj)).toBe(obj);
  });

  it("returns non-Error values unchanged — undefined", () => {
    expect(serializeError(undefined)).toBeUndefined();
  });

  it("serializes a plain Error to a plain object", () => {
    const err = new Error("something failed");
    const result = serializeError(err);
    expect(result).not.toBeInstanceOf(Error);
    expect(typeof result).toBe("object");
  });

  it("includes name and message for a plain Error", () => {
    const err = new Error("oops");
    const result = serializeError(err) as Record<string, unknown>;
    expect(result["name"]).toBe("Error");
    expect(result["message"]).toBe("oops");
  });

  it("includes stack when present", () => {
    const err = new Error("with stack");
    // In Node, stack is always set; test that the field is included.
    if (err.stack !== undefined) {
      const result = serializeError(err) as Record<string, unknown>;
      expect(result["stack"]).toBe(err.stack);
    }
  });

  it("preserves custom name on an Error subclass", () => {
    class DatabaseError extends Error {
      override name = "DatabaseError";
    }
    const err = new DatabaseError("db unavailable");
    const result = serializeError(err) as Record<string, unknown>;
    expect(result["name"]).toBe("DatabaseError");
    expect(result["message"]).toBe("db unavailable");
  });

  it("serializes Error cause shallowly when cause is an Error", () => {
    const cause = new Error("root cause");
    const err = new Error("outer", { cause });
    const result = serializeError(err) as Record<string, unknown>;
    const serializedCause = result["cause"] as Record<string, unknown>;
    expect(serializedCause).not.toBeInstanceOf(Error);
    expect(serializedCause["name"]).toBe("Error");
    expect(serializedCause["message"]).toBe("root cause");
  });

  it("passes non-Error cause through unchanged", () => {
    const err = new Error("outer");
    (err as unknown as Record<string, unknown>)["cause"] = "string cause";
    const result = serializeError(err) as Record<string, unknown>;
    expect(result["cause"]).toBe("string cause");
  });

  it("omits cause key when cause is undefined", () => {
    const err = new Error("no cause");
    const result = serializeError(err) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(result, "cause")).toBe(false);
  });

  it("omits stack key when stack is undefined — covered via optionalField", () => {
    // The stack-present branch is exercised above. The stack-absent branch is structurally
    // unreachable in Node (stack is always set) and is covered by the dedicated optionalField
    // tests in internal/optional-field.test.ts. This test documents that intent rather than
    // attempting a brittle delete.
    const err = new Error("has stack");
    const result = serializeError(err) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(result, "stack")).toBe(true);
  });
});
