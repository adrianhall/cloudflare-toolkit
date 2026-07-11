import { describe, expect, it } from "vitest";
import * as sut from "../../../../src/lib/logging/internal/safe-json.js";

describe("replaceNonJsonValue()", () => {
  it("converts a positive bigint to '<n>n'", () => {
    expect(sut.replaceNonJsonValue(42n)).toBe("42n");
  });

  it("converts zero bigint to '0n'", () => {
    expect(sut.replaceNonJsonValue(0n)).toBe("0n");
  });

  it("converts a negative bigint to '-<n>n'", () => {
    expect(sut.replaceNonJsonValue(-1n)).toBe("-1n");
  });

  it("converts a large bigint beyond Number.MAX_SAFE_INTEGER", () => {
    expect(sut.replaceNonJsonValue(9007199254740993n)).toBe("9007199254740993n");
  });

  it("converts a symbol with a description to 'Symbol(description)'", () => {
    expect(sut.replaceNonJsonValue(Symbol("key"))).toBe("Symbol(key)");
  });

  it("converts a symbol without a description to 'Symbol()'", () => {
    expect(sut.replaceNonJsonValue(Symbol())).toBe("Symbol()");
  });

  it("converts a named function to '[Function name]'", () => {
    function myFn() {
      /* noop */
    }
    expect(sut.replaceNonJsonValue(myFn)).toBe("[Function myFn]");
  });

  it("converts an anonymous function to '[Function (anonymous)]'", () => {
    const fn = Object.defineProperty(() => undefined, "name", { value: "" });
    expect(sut.replaceNonJsonValue(fn)).toBe("[Function (anonymous)]");
  });

  it("converts an arrow function with an inferred name", () => {
    const arrowFn = () => undefined;
    // Inferred name is "arrowFn" in V8; the exact name is environment-dependent so assert only
    // the prefix shape rather than a hardcoded name.
    expect(sut.replaceNonJsonValue(arrowFn)).toMatch(/^\[Function /);
  });

  it("returns a string unchanged", () => {
    expect(sut.replaceNonJsonValue("hello")).toBe("hello");
  });

  it("returns a number unchanged", () => {
    expect(sut.replaceNonJsonValue(99)).toBe(99);
  });

  it("returns zero unchanged", () => {
    expect(sut.replaceNonJsonValue(0)).toBe(0);
  });

  it("returns NaN unchanged", () => {
    expect(sut.replaceNonJsonValue(NaN)).toBeNaN();
  });

  it("returns Infinity unchanged", () => {
    expect(sut.replaceNonJsonValue(Infinity)).toBe(Infinity);
  });

  it("returns boolean true unchanged", () => {
    expect(sut.replaceNonJsonValue(true)).toBe(true);
  });

  it("returns boolean false unchanged", () => {
    expect(sut.replaceNonJsonValue(false)).toBe(false);
  });

  it("returns null unchanged", () => {
    expect(sut.replaceNonJsonValue(null)).toBeNull();
  });

  it("returns undefined unchanged", () => {
    expect(sut.replaceNonJsonValue(undefined)).toBeUndefined();
  });

  it("returns a plain object unchanged (same reference)", () => {
    const obj = { x: 1 };
    expect(sut.replaceNonJsonValue(obj)).toBe(obj);
  });

  it("returns an array unchanged (same reference)", () => {
    const arr = [1, 2, 3];
    expect(sut.replaceNonJsonValue(arr)).toBe(arr);
  });
});

describe("safeStringify()", () => {
  it("serializes a plain object", () => {
    expect(sut.safeStringify({ a: 1, b: "hello" })).toBe('{"a":1,"b":"hello"}');
  });

  it("serializes an array", () => {
    expect(sut.safeStringify([1, 2, 3])).toBe("[1,2,3]");
  });

  it("serializes a string", () => {
    expect(sut.safeStringify("hello")).toBe('"hello"');
  });

  it("serializes a number", () => {
    expect(sut.safeStringify(42)).toBe("42");
  });

  it("serializes null", () => {
    expect(sut.safeStringify(null)).toBe("null");
  });

  it("serializes a boolean", () => {
    expect(sut.safeStringify(true)).toBe("true");
  });

  it("serializes a nested object", () => {
    expect(sut.safeStringify({ outer: { inner: 99 } })).toBe('{"outer":{"inner":99}}');
  });

  it("returns the string 'undefined' for undefined at top level", () => {
    expect(sut.safeStringify(undefined)).toBe("undefined");
  });

  it("omits undefined object properties (standard JSON behaviour)", () => {
    const result = JSON.parse(sut.safeStringify({ a: 1, b: undefined })) as Record<string, unknown>;
    expect(result).toStrictEqual({ a: 1 });
  });

  it("serializes a bigint as '<n>n'", () => {
    expect(sut.safeStringify(42n)).toBe('"42n"');
  });

  it("serializes a negative bigint", () => {
    expect(sut.safeStringify(-9007199254740993n)).toBe('"-9007199254740993n"');
  });

  it("serializes a bigint nested inside an object", () => {
    const result = JSON.parse(sut.safeStringify({ count: 100n })) as Record<string, unknown>;
    expect(result["count"]).toBe("100n");
  });

  it("serializes a symbol with a description", () => {
    expect(sut.safeStringify(Symbol("myKey"))).toBe('"Symbol(myKey)"');
  });

  it("serializes a symbol without a description", () => {
    expect(sut.safeStringify(Symbol())).toBe('"Symbol()"');
  });

  it("serializes a symbol nested inside an object", () => {
    const result = JSON.parse(sut.safeStringify({ key: Symbol("id") })) as Record<string, unknown>;
    expect(result["key"]).toBe("Symbol(id)");
  });

  it("serializes a named function as '[Function name]'", () => {
    function myHandler() {
      /* noop */
    }
    expect(sut.safeStringify(myHandler)).toBe('"[Function myHandler]"');
  });

  it("serializes an anonymous arrow function as '[Function (anonymous)]'", () => {
    const fn = Object.defineProperty(() => undefined, "name", { value: "" });
    expect(sut.safeStringify(fn)).toBe('"[Function (anonymous)]"');
  });

  it("serializes a function nested inside an object", () => {
    const result = JSON.parse(
      sut.safeStringify({
        handler: function doThing() {
          /* noop */
        }
      })
    ) as Record<string, unknown>;
    expect(result["handler"]).toBe("[Function doThing]");
  });

  it("replaces a direct circular reference with '[Circular]'", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj["self"] = obj;
    const result = JSON.parse(sut.safeStringify(obj)) as Record<string, unknown>;
    expect(result["self"]).toBe("[Circular]");
  });

  it("replaces a deep circular reference with '[Circular]'", () => {
    const parent: Record<string, unknown> = { name: "parent" };
    const child: Record<string, unknown> = { name: "child", parent };
    parent["child"] = child;
    const result = JSON.parse(sut.safeStringify(parent)) as Record<string, unknown>;
    const childResult = result["child"] as Record<string, unknown>;
    expect(childResult["parent"]).toBe("[Circular]");
  });

  it("replaces a circular array reference with '[Circular]'", () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr);
    const result = JSON.parse(sut.safeStringify(arr)) as unknown[];
    expect(result[2]).toBe("[Circular]");
  });

  it("does not treat a shared/diamond object reference as circular", () => {
    const shared = { x: 1 };
    const result = JSON.parse(sut.safeStringify({ a: shared, b: shared })) as Record<
      string,
      unknown
    >;
    expect(result["a"]).toStrictEqual({ x: 1 });
    expect(result["b"]).toStrictEqual({ x: 1 });
  });

  it("does not treat a shared/diamond array reference as circular", () => {
    const sharedArr = [1, 2];
    const result = JSON.parse(sut.safeStringify({ a: sharedArr, b: sharedArr })) as Record<
      string,
      unknown
    >;
    expect(result["a"]).toStrictEqual([1, 2]);
    expect(result["b"]).toStrictEqual([1, 2]);
  });

  it("does not treat a reference shared across three or more sibling keys as circular", () => {
    const shared = { id: "shared" };
    const result = JSON.parse(sut.safeStringify({ a: shared, b: shared, c: shared })) as Record<
      string,
      unknown
    >;
    expect(result["a"]).toStrictEqual({ id: "shared" });
    expect(result["b"]).toStrictEqual({ id: "shared" });
    expect(result["c"]).toStrictEqual({ id: "shared" });
  });

  it("still detects a true circular reference alongside an unrelated shared/diamond reference", () => {
    const shared = { id: "shared" };
    const root: Record<string, unknown> = { a: shared, b: shared };
    root["self"] = root;
    const result = JSON.parse(sut.safeStringify(root)) as Record<string, unknown>;
    expect(result["a"]).toStrictEqual({ id: "shared" });
    expect(result["b"]).toStrictEqual({ id: "shared" });
    expect(result["self"]).toBe("[Circular]");
  });

  it("does not treat a reference reused after a prior sibling subtree finished as circular", () => {
    // Regression for the ancestor-path fix: after fully serializing `a` (which uses `shared`
    // as a nested value), `shared` must be evictable from the ancestor stack so that visiting
    // sibling key `b` with the SAME reference does not see a stale "still on the stack" entry.
    const shared = { x: 1 };
    const a = { nested: shared };
    const result = JSON.parse(sut.safeStringify({ a, b: shared })) as Record<string, unknown>;
    expect(result["a"]).toStrictEqual({ nested: { x: 1 } });
    expect(result["b"]).toStrictEqual({ x: 1 });
  });

  it("returns '[FormattingError]' when a getter throws during serialization", () => {
    const obj = Object.defineProperty({}, "boom", {
      get() {
        throw new Error("getter explosion");
      },
      enumerable: true
    });
    expect(() => sut.safeStringify(obj)).not.toThrow();
    expect(sut.safeStringify(obj)).toBe("[FormattingError]");
  });

  it("handles an array with bigint and symbol elements", () => {
    const result = JSON.parse(sut.safeStringify([1n, Symbol("x"), "ok"])) as unknown[];
    expect(result[0]).toBe("1n");
    expect(result[1]).toBe("Symbol(x)");
    expect(result[2]).toBe("ok");
  });
});
