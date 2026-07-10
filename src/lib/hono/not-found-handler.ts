// notFoundHandler (docs/SPECv2.md §5.5) — toolkit-authored, no vendored equivalent exists in
// hono-problem-details: `app.notFound()` is a separate Hono hook from `app.onError()`, so there's
// nothing analogous to port.
//
// This mimics the RFC 9457 shape that throwing `notFound()` (`@adrianhall/cloudflare-toolkit/errors`)
// through `problemDetailsErrorHandler` would produce, and deliberately reuses the same
// `../problem-details/*` helpers `problemDetailsErrorHandler` uses so the two independently-wired
// hooks agree on `type`/`title` conventions (`typePrefix`, `autoInstance` — docs/SPECv2.md §7.4)
// without needing a combined/coordinator middleware (§5.5). Because this handler builds its
// `Response` directly rather than throwing, `app.onError()` is never involved for a 404 produced
// this way — that's what prevents the double-wrap risk flagged in §7.4.
import type { Context, NotFoundHandler as HonoNotFoundHandler } from "hono";
import { statusToPhrase, statusToSlug } from "../problem-details/status.js";
import type { ProblemDetails } from "../problem-details/types.js";
import { buildProblemResponse } from "../problem-details/utils.js";

const NOT_FOUND_STATUS = 404;

/**
 * Options for {@link notFoundHandler}.
 */
export interface NotFoundHandlerOptions {
  /** Prefix for the `type` URI. When set, a status-derived slug is appended. */
  typePrefix?: string;
  /** Default `type` URI when `typePrefix` is not set. Defaults to `"about:blank"`. */
  defaultType?: string;
  /**
   * When `true`, populate `instance` from the request path (`c.req.path`).
   *
   * Default: `false`, matching `problemDetailsErrorHandler`'s own default (docs/SPECv2.md §7.4).
   */
  autoInstance?: boolean;
}

function buildType(options: NotFoundHandlerOptions): string {
  // Unlike `problemDetailsErrorHandler`'s own `buildType` (which must handle arbitrary statuses,
  // some of which have no known slug), this handler only ever deals with the fixed `404` status
  // — `statusToSlug(404)` is guaranteed to resolve (it's in `STATUS_SLUGS`), so there's no
  // "unknown slug" fallback branch to guard here.
  if (options.typePrefix) {
    return `${options.typePrefix}/${statusToSlug(NOT_FOUND_STATUS)}`;
  }
  return options.defaultType ?? "about:blank";
}

/**
 * Create an `app.notFound` handler that returns an RFC 9457 Problem Details `404` response. This
 * mimics what throwing `notFound()` (`@adrianhall/cloudflare-toolkit/errors`) through
 * {@link problemDetailsErrorHandler} would produce, without requiring a request to actually throw
 * — `app.notFound()` is wired independently of `app.onError()` (docs/SPECv2.md §5.5).
 *
 * @param options - Options controlling the `type` URI and whether `instance` is auto-populated.
 * @returns A Hono `NotFoundHandler`.
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { notFoundHandler } from "@adrianhall/cloudflare-toolkit/hono";
 *
 * const app = new Hono();
 * app.notFound(notFoundHandler());
 * ```
 */
export function notFoundHandler(options: NotFoundHandlerOptions = {}): HonoNotFoundHandler {
  return (c: Context) => {
    let pd: ProblemDetails = {
      type: buildType(options),
      status: NOT_FOUND_STATUS,
      // `statusToPhrase(404)` is guaranteed to resolve (it's in `STATUS_PHRASES`), so there's no
      // "unknown phrase" fallback branch to guard here — unlike `problemDetailsErrorHandler`'s
      // handling of arbitrary statuses.
      title: statusToPhrase(NOT_FOUND_STATUS)!
    };

    if (options.autoInstance) {
      pd = { ...pd, instance: c.req.path };
    }

    return buildProblemResponse(pd);
  };
}
