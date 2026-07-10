/**
 * @file A specialized internal-server-error class for an unexpected `null`/`undefined` value.
 */
import { ProblemDetailsError } from "../problem-details/error.js";

/**
 * A specialized `internalServerError()`-shaped {@link ProblemDetailsError} for an unexpected
 * `null`/`undefined` value. Exists as a distinct, named error class so guard functions
 * (`throwIfNull`, `sqlCount`) have a single, greppable call site — it is still handled uniformly
 * by `problemDetailsErrorHandler` because it remains a `ProblemDetailsError`.
 */
export class NullError extends ProblemDetailsError {
  /**
   * Create a new {@link NullError}.
   *
   * @param message - Human-readable explanation of what was unexpectedly null/undefined.
   */
  constructor(message: string) {
    super({ status: 500, detail: message });
    this.name = "NullError";
  }
}
