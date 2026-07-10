/**
 * @file A specialized internal-server-error class for a non-null value that does not have the
 * shape it was expected to have.
 */
import { ProblemDetailsError } from "../problem-details/error.js";

/**
 * A specialized `internalServerError()`-shaped {@link ProblemDetailsError} for a non-null value
 * that does not have the shape it was expected to have (e.g. not an object, or a property that is
 * missing or the wrong type). Exists as a distinct, named error class — separate from `NullError`
 * — so guard functions (`sqlCount`) have a single, greppable call site for "wrong shape" failures
 * as opposed to "unexpectedly null/undefined" ones. Still handled uniformly by
 * `problemDetailsErrorHandler` because it remains a `ProblemDetailsError`.
 */
export class InvalidShapeError extends ProblemDetailsError {
  /**
   * Create a new {@link InvalidShapeError}.
   *
   * @param message - Human-readable explanation of what had an unexpected shape or type.
   */
  constructor(message: string) {
    super({ status: 500, detail: message });
    this.name = "InvalidShapeError";
  }
}
