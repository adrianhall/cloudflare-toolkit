/**
 * @file Error serialization for the logging subpath.
 *
 * `serializeError()` converts `Error` instances to plain objects so transports can safely
 * forward structured context without raw `Error` values escaping into JSON serialization or
 * console methods. Only top-level context values are serialized by the logger (`logger.ts`);
 * nested errors are left as-is unless they appear as a direct `cause` of a top-level error.
 */
import { optionalField } from "./internal/optional-field.js";

/**
 * Serialize `value` if it is an `Error`; return it unchanged otherwise.
 *
 * - Non-`Error` values are returned as-is.
 * - `Error` instances become plain objects with `name`, `message`, and optionally `stack` and
 *   `cause`.
 * - `cause` is shallowly serialized when it is itself an `Error`.
 *
 * @param value - The value to serialize, if it is an `Error`.
 * @returns A plain-object serialization of `value` when it is an `Error`, otherwise `value`
 *   unchanged.
 */
export function serializeError(value: unknown): unknown {
  if (!(value instanceof Error)) {
    return value;
  }

  const serialized: Record<string, unknown> = {
    name: value.name,
    message: value.message,
    ...optionalField(value, "stack")
  };

  if (value.cause !== undefined) {
    serialized.cause =
      value.cause instanceof Error ?
        {
          name: value.cause.name,
          message: value.cause.message,
          ...optionalField(value.cause, "stack")
        }
      : value.cause;
  }

  return serialized;
}
