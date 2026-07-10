/**
 * @file The `problemDetails()` factory function for creating a {@link ProblemDetailsError}.
 */
import { ProblemDetailsError } from "./error.js";
import type { ProblemDetailsInput } from "./types.js";

/**
 * Create a {@link ProblemDetailsError} from the given input.
 * Missing `type` defaults to `"about:blank"`; missing `title` is derived from the status code.
 *
 * @param input - The problem details input.
 * @returns A {@link ProblemDetailsError} ready to `throw`.
 * @example
 * ```ts
 * throw problemDetails({
 *   status: 404,
 *   detail: `Order ${orderId} does not exist`,
 * });
 * ```
 */
export function problemDetails<T extends Record<string, unknown>>(
  input: ProblemDetailsInput<T>
): ProblemDetailsError {
  return new ProblemDetailsError(input);
}
