import { describe, expect, it } from "vitest";
import { sqlCount } from "../../../src/lib/guards/index.js";
import { InvalidShapeError, NullError } from "../../../src/lib/errors/index.js";

describe("sqlCount", () => {
  it("returns the numeric count for a valid { count: number } row (default countProperty)", () => {
    expect(sqlCount({ count: 5 })).toBe(5);
  });

  it("returns 0 for a valid { count: 0 } row", () => {
    expect(sqlCount({ count: 0 })).toBe(0);
  });

  it("throws a NullError when row is null (D1 .first() returned no rows)", () => {
    expect(() => sqlCount(null)).toThrow(NullError);
  });

  it("throws a NullError when row is undefined (not a real D1 shape, but row is typed unknown)", () => {
    expect(() => sqlCount(undefined)).toThrow(NullError);
  });

  it("throws an InvalidShapeError when row is a non-object value", () => {
    expect(() => sqlCount("not an object")).toThrow(InvalidShapeError);
    expect(() => sqlCount(42)).toThrow(InvalidShapeError);
  });

  it("throws an InvalidShapeError when row is an object missing countProperty", () => {
    expect(() => sqlCount({ other: 5 })).toThrow(InvalidShapeError);
  });

  it("throws an InvalidShapeError when countProperty is present but non-numeric", () => {
    expect(() => sqlCount({ count: "5" })).toThrow(InvalidShapeError);
  });

  it("supports a custom countProperty argument", () => {
    expect(sqlCount({ total: 12 }, "total")).toBe(12);
    expect(() => sqlCount({ count: 12 }, "total")).toThrow(InvalidShapeError);
  });
});
