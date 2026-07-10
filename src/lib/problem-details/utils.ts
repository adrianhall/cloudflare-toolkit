// Vendored/ported from adrianhall/hono-problem-details (MIT), a fork of paveg/hono-problem-details
// (MIT) — see THIRD-PARTY-NOTICES.md.
import { statusToPhrase } from "./status.js";
import type { ProblemDetails, ProblemDetailsInput } from "./types.js";

/** RFC 9457 media type: `application/problem+json; charset=utf-8`. */
export const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json; charset=utf-8";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Strip keys that could cause prototype pollution in downstream consumers.
 *
 * @param extensions - The extension members to sanitize, or `undefined`.
 * @returns The sanitized extensions, or the original reference when nothing was stripped.
 */
export function sanitizeExtensions(
  extensions: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!extensions) return extensions;
  let filtered: Record<string, unknown> | undefined;
  for (const key of Object.keys(extensions)) {
    if (DANGEROUS_KEYS.has(key)) {
      filtered ??= { ...extensions };
      delete filtered[key];
    }
  }
  return filtered ?? extensions;
}

/**
 * Clamp an HTTP status to the 200-599 integer range.
 *
 * @param status - The status to clamp.
 * @returns `status` unchanged when it's an integer in `[200, 599]`; otherwise `500`.
 */
export function clampHttpStatus(status: number): number {
  return Number.isInteger(status) && status >= 200 && status <= 599 ? status : 500;
}

const FALLBACK_BODY = JSON.stringify({
  type: "about:blank",
  status: 500,
  title: "Internal Server Error"
});

/**
 * Normalize a {@link ProblemDetailsInput} to a {@link ProblemDetails}, applying defaults for
 * `type` and `title`.
 *
 * @param input - The input to normalize.
 * @returns The normalized problem details object.
 */
export function normalizeProblemDetails<T extends Record<string, unknown>>(
  input: ProblemDetailsInput<T>
): ProblemDetails<T> {
  return {
    type: input.type ?? "about:blank",
    status: input.status,
    title: input.title ?? statusToPhrase(input.status) ?? "Unknown Error",
    detail: input.detail,
    instance: input.instance,
    extensions: input.extensions
  };
}

/**
 * Build an RFC 9457 `application/problem+json` {@link Response} from a {@link ProblemDetails}
 * object.
 *
 * @param pd - The problem details to serialize.
 * @returns The resulting `Response`.
 */
export function buildProblemResponse(pd: ProblemDetails): Response {
  const { extensions, ...standard } = pd;
  const body = { ...sanitizeExtensions(extensions), ...standard };
  const { json, fallback } = safeStringify(body);
  return new Response(json, {
    status: fallback ? 500 : clampHttpStatus(pd.status),
    headers: { "Content-Type": PROBLEM_JSON_CONTENT_TYPE }
  });
}

/**
 * `JSON.stringify` with a fallback for non-serializable values (circular references, `BigInt`).
 *
 * @param body - The value to stringify.
 * @returns The JSON string and whether the fallback body was used.
 */
export function safeStringify(body: unknown): { json: string; fallback: boolean } {
  try {
    return { json: JSON.stringify(body), fallback: false };
  } catch {
    return { json: FALLBACK_BODY, fallback: true };
  }
}
