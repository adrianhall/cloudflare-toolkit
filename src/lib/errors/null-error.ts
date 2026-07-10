// NullError (docs/SPECv2.md §5.2, §5.3): thrown by the guards subpath's `throwIfNull`/`sqlCount`
// (a later issue) when a value that should never be `null`/`undefined` turns out to be — "this
// should never happen, that's a bug, not a 0/empty result". It's a specialized
// `internalServerError()`-shaped `ProblemDetailsError`, deliberately not a distinct case callers
// need to catch: it flows through standard Hono error handling (the vendored
// `problemDetailsErrorHandler`, §5.4/§5.5, a later issue) exactly like any other
// `ProblemDetailsError`.
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
