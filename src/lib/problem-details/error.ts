// Vendored/ported from adrianhall/hono-problem-details (MIT), a fork of paveg/hono-problem-details
// (MIT) — see THIRD-PARTY-NOTICES.md.
import type { ProblemDetails, ProblemDetailsInput } from "./types.js";
import { buildProblemResponse, normalizeProblemDetails } from "./utils.js";

/**
 * Error class for RFC 9457 Problem Details.
 * Thrown by {@link problemDetails} and caught by the Hono error handler (`@adrianhall/cloudflare-toolkit/hono`)
 * to produce `application/problem+json` responses.
 */
export class ProblemDetailsError extends Error {
  /** The normalized RFC 9457 Problem Details object. */
  readonly problemDetails: ProblemDetails;

  /**
   * Create a new {@link ProblemDetailsError}.
   *
   * @param input - Missing `type` defaults to `"about:blank"`; missing `title` is derived from
   *   the HTTP status code.
   */
  constructor(input: ProblemDetailsInput) {
    const pd = normalizeProblemDetails(input);
    super(pd.detail ?? pd.title);
    this.name = "ProblemDetailsError";
    this.problemDetails = pd;
  }

  /**
   * Build a standalone `application/problem+json` {@link Response} without any Hono handler
   * middleware.
   *
   * @returns The resulting `Response`.
   */
  getResponse(): Response {
    return buildProblemResponse(this.problemDetails);
  }
}
