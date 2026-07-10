// InvalidShapeError (docs/SPECv2.md §5.2, §5.3): thrown by the guards subpath's `sqlCount` when a
// non-null value does not have the shape it was expected to have (not an object, or missing/wrong
// -typed property) — "this should never happen, that's a bug, not a 0/empty result". Sibling to
// `NullError` (which covers the `null`/`undefined` case specifically): both are specialized
// `internalServerError()`-shaped `ProblemDetailsError`s, deliberately not distinct cases callers
// need to catch differently — each flows through standard Hono error handling (the vendored
// `problemDetailsErrorHandler`, §5.4/§5.5, a later issue) exactly like any other
// `ProblemDetailsError`.
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
