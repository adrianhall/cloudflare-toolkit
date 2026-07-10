import { describe, expect, expectTypeOf, it } from "vitest";
import { throwIfNull } from "../../../src/lib/guards/index.js";
import { NullError } from "../../../src/lib/errors/index.js";

describe("throwIfNull", () => {
  it("throws a NullError when value is null", () => {
    expect(() => {
      throwIfNull(null, "value must not be null");
    }).toThrow(NullError);
  });

  it("throws a NullError when value is undefined", () => {
    expect(() => {
      throwIfNull(undefined, "value must not be undefined");
    }).toThrow(NullError);
  });

  it("carries the provided message on the thrown NullError", () => {
    expect(() => {
      throwIfNull(null, "widget id was unexpectedly null");
    }).toThrow("widget id was unexpectedly null");
  });

  it("does not throw for a defined, non-null value", () => {
    expect(() => {
      throwIfNull("hello", "should not throw");
    }).not.toThrow();
  });

  it("does not throw for falsy-but-defined values (0, '', false)", () => {
    expect(() => {
      throwIfNull(0, "zero is defined");
    }).not.toThrow();
    expect(() => {
      throwIfNull("", "empty string is defined");
    }).not.toThrow();
    expect(() => {
      throwIfNull(false, "false is defined");
    }).not.toThrow();
  });

  it("is a genuine TypeScript assertion function that narrows the value's type", () => {
    // This is a type-level assertion, not a runtime one: if `throwIfNull` were a plain
    // `(value) => boolean` type guard instead of an `asserts` function, the read of `value`
    // below would still be typed `string | null | undefined` and this `expectTypeOf` check
    // would fail to compile under `tsc`.
    const value: string | null | undefined = "hello";
    throwIfNull(value, "value must be defined");
    expectTypeOf(value).toEqualTypeOf<string>();
  });
});
