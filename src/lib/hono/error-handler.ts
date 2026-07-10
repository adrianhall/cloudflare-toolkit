/**
 * @file A Hono `app.onError` handler that converts thrown errors into RFC 9457
 * `application/problem+json` responses.
 *
 * Handles {@link ProblemDetailsError} directly, maps Hono `HTTPException` to an equivalent
 * problem response, and falls back to a generic `500` for any other unhandled exception. Shares
 * the RFC 9457 primitives from `../problem-details/*` (`statusToPhrase`, `buildProblemResponse`,
 * etc.) rather than duplicating them. There is no OpenTelemetry/zod/valibot/openapi integration.
 */
import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ProblemDetailsError } from "../problem-details/error.js";
import { statusToPhrase, statusToSlug } from "../problem-details/status.js";
import type { ProblemDetails, ProblemDetailsInput } from "../problem-details/types.js";
import { buildProblemResponse, normalizeProblemDetails } from "../problem-details/utils.js";

/**
 * Options for {@link problemDetailsErrorHandler}.
 */
export interface ProblemDetailsErrorHandlerOptions {
  /** Prefix for the `type` URI. When set, a status-derived slug is appended. */
  typePrefix?: string;
  /** Default `type` URI. Defaults to `"about:blank"`. */
  defaultType?: string;
  /**
   * Include the stack trace on unhandled `Error` responses (500). The stack is emitted as a
   * top-level `stack` extension member per RFC 9457 §3.1 flattening, not in `detail`, to
   * prevent leakage into UIs that render `detail` verbatim.
   *
   * Security-sensitive: development-only, must default to `false`.
   */
  includeStack?: boolean;
  /**
   * When `true`, populate `instance` from the request path (`c.req.path`) if the thrown problem
   * didn't specify one. Explicit values always win.
   *
   * Default: `false` — opt-in to avoid silently changing response shape.
   */
  autoInstance?: boolean;
  /** Custom error to {@link ProblemDetailsInput} mapping. */
  mapError?: (error: Error) => ProblemDetailsInput | undefined;
  /**
   * Localize `title`/`detail` before sending the response. Returned fields are merged onto the
   * original {@link ProblemDetails}, so callers may return a partial patch (e.g. `{ title: "..."
   * }`) or omit the return entirely.
   */
  localize?: (pd: ProblemDetails, c: Context) => Partial<ProblemDetails> | undefined;
}

function buildType(status: number, options: ProblemDetailsErrorHandlerOptions): string {
  if (options.typePrefix) {
    const slug = statusToSlug(status);
    if (slug) return `${options.typePrefix}/${slug}`;
  }
  return options.defaultType ?? "about:blank";
}

function toResponse(
  input: ProblemDetailsInput,
  c: Context,
  options: ProblemDetailsErrorHandlerOptions
): Response {
  let pd = normalizeProblemDetails(input);

  if (options.autoInstance && pd.instance === undefined) {
    pd = { ...pd, instance: c.req.path };
  }

  if (options.localize) {
    try {
      pd = { ...pd, ...options.localize(pd, c) };
    } catch {
      // Fall through with the un-localized pd. A throwing localize must not cause the error
      // handler itself to throw — that would re-enter onError.
    }
  }

  c.set("problemDetails", pd);

  return buildProblemResponse(pd);
}

/**
 * Create an `app.onError` handler that returns RFC 9457 Problem Details responses. Handles
 * {@link ProblemDetailsError}, Hono `HTTPException`, and unhandled exceptions.
 *
 * @param options - Options controlling `type` URI construction, stack-trace exposure, `instance`
 * auto-population, custom error mapping, and localization.
 * @returns A Hono `ErrorHandler`.
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { problemDetailsErrorHandler } from "@adrianhall/cloudflare-toolkit/hono";
 *
 * const app = new Hono();
 * app.onError(problemDetailsErrorHandler());
 * ```
 */
export function problemDetailsErrorHandler(
  options: ProblemDetailsErrorHandlerOptions = {}
): ErrorHandler {
  return (error, c) => {
    if (error instanceof ProblemDetailsError) {
      return toResponse(error.problemDetails, c, options);
    }

    if (options.mapError) {
      const mapped = options.mapError(error);
      if (mapped) {
        return toResponse(mapped, c, options);
      }
    }

    if (error instanceof HTTPException) {
      return toResponse(
        {
          status: error.status,
          type: buildType(error.status, options),
          title: statusToPhrase(error.status),
          detail: error.message
        },
        c,
        options
      );
    }

    return toResponse(
      {
        status: 500,
        type: buildType(500, options),
        title: "Internal Server Error",
        detail: "An unexpected error occurred",
        extensions: options.includeStack ? { stack: error.stack } : undefined
      },
      c,
      options
    );
  };
}
