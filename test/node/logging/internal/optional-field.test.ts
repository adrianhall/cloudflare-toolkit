import { describe, expect, it } from "vitest";
import * as sut from "../../../../src/lib/logging/internal/optional-field.js";

describe("optionalField()", () => {
  it("returns the field when the property is present and non-undefined", () => {
    const result = sut.optionalField({ stack: "trace output" }, "stack");
    expect(result).toStrictEqual({ stack: "trace output" });
  });

  it("returns an empty object when the property value is undefined", () => {
    const result = sut.optionalField({ stack: undefined }, "stack");
    expect(result).toStrictEqual({});
  });

  it("returns an empty object when the property is absent", () => {
    const result = sut.optionalField<{ stack?: string }>({}, "stack");
    expect(result).toStrictEqual({});
  });

  it("works with numeric property values", () => {
    const result = sut.optionalField({ code: 42 }, "code");
    expect(result).toStrictEqual({ code: 42 });
  });

  it("works with falsy-but-defined values (empty string)", () => {
    const result = sut.optionalField({ stack: "" }, "stack");
    expect(result).toStrictEqual({ stack: "" });
  });

  it("works with falsy-but-defined values (zero)", () => {
    const result = sut.optionalField({ code: 0 }, "code");
    expect(result).toStrictEqual({ code: 0 });
  });

  it("works with falsy-but-defined values (false)", () => {
    const result = sut.optionalField({ flag: false }, "flag");
    expect(result).toStrictEqual({ flag: false });
  });

  it("the returned object can be safely spread onto another object", () => {
    const base = { name: "Error", message: "oops" };
    const result = { ...base, ...sut.optionalField({ stack: undefined }, "stack") };
    expect(result).toStrictEqual({ name: "Error", message: "oops" });
    expect(Object.prototype.hasOwnProperty.call(result, "stack")).toBe(false);
  });
});
