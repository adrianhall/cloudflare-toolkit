/**
 * @file Shared path-policy evaluation for the auth internals. Pure logic with no runtime
 * dependencies, so this module is both Worker-safe (for `hono/`) and Node-safe (for `vite/`).
 */
import type { PathPolicy, PolicyMatch } from "./types.js";

/**
 * Evaluate a request pathname against an ordered list of policies.
 *
 * Returns a {@link PolicyMatch} for the **first matching** policy, or `undefined` when no
 * policy matches (the caller decides what to do in that case).
 *
 * The `redirect` field defaults to `true` when the matching {@link PathPolicy} does not specify
 * one. The `audience` field is passed through verbatim (`undefined` when the matching policy
 * does not specify one) — the caller decides whether to fall back to its own top-level audience
 * in that case.
 */
export function matchPolicy(pathname: string, policies: PathPolicy[]): PolicyMatch | undefined {
  for (const { pattern, authenticate, redirect, audience } of policies) {
    if (pattern.test(pathname)) {
      return { authenticate, redirect: redirect ?? true, audience };
    }
  }
  return undefined;
}
