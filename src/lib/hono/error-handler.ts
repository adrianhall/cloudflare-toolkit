// Vendored/ported from adrianhall/hono-problem-details (MIT), a fork of paveg/hono-problem-details
// (MIT) — see THIRD-PARTY-NOTICES.md. Ported from `src/handler.ts`'s `problemDetailsHandler`,
// renamed `problemDetailsErrorHandler` (docs/SPECv2.md §5.5) to match this toolkit's naming.
//
// This is a **direct re-export**, not a toolkit-authored wrapper (docs/SPECv2.md §5.4/§5.5, §9):
// every generator in `@adrianhall/cloudflare-toolkit/errors` produces a plain `ProblemDetailsError`
// uniformly, so the vendored handler logic below — copied unmodified except for the changes noted
// — needs no toolkit-specific special-casing on top of it.
//
// Two deliberate differences from upstream:
//   1. Imports the shared RFC 9457 primitives from `../problem-details/*` instead of duplicating
//      them, since that subpath is itself a vendored port of the same upstream project
//      (docs/SPECv2.md §5.4) — one copy of `statusToPhrase`/`buildProblemResponse`/etc., not two.
//   2. The `otelApi` option (and its backing `getOtelTraceId`/`integrations/opentelemetry.ts`)
//      is dropped entirely: docs/SPECv2.md §5.4 explicitly excludes the opentelemetry integration
//      (along with zod/valibot/openapi/standard-schema) from what's vendored in v1.
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
   * Development-only. Must default to `false` (docs/SPECv2.md §9).
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
