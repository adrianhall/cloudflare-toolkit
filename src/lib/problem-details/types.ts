/**
 * @file Core RFC 9457 Problem Details types: the `ProblemDetails` object shape and the
 * `ProblemDetailsInput` accepted by the `problemDetails()` factory.
 */

/**
 * RFC 9457 Problem Details object.
 * Supports 5 standard fields + extension members.
 */
export interface ProblemDetails<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Problem type URI. Default: "about:blank" */
  type: string;
  /** HTTP status code */
  status: number;
  /** Short summary of the problem type */
  title: string;
  /** Human-readable explanation specific to this occurrence */
  detail?: string;
  /** URI that identifies the specific occurrence */
  instance?: string;
  /** RFC 9457 extension members (flattened to top level on serialization) */
  extensions?: T;
}

/**
 * Input for the {@link problemDetails} factory.
 * `type` and `title` are optional (auto-derived from `status`).
 */
export interface ProblemDetailsInput<T extends Record<string, unknown> = Record<string, unknown>> {
  /** HTTP status code */
  status: number;
  /** Problem type URI. Defaults to "about:blank" when omitted */
  type?: string;
  /** Short summary of the problem type. Derived from `status` when omitted */
  title?: string;
  /** Human-readable explanation specific to this occurrence */
  detail?: string;
  /** URI that identifies the specific occurrence */
  instance?: string;
  /** RFC 9457 extension members (flattened to top level on serialization) */
  extensions?: T;
}
