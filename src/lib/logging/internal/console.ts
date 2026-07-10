// Internal console method fallback helpers for the logging subpath. Ported from
// adrianhall/cloudflare-logger's `src/internal/console.ts` (same author, MIT — see
// docs/SPECv2.md §10; source repo is read-only and not modified by this port).
//
// Transports use specific `console` methods (`debug`, `info`, `warn`, `error`, `log`) to route
// records to the appropriate DevTools channel or log level in the host environment. Some
// environments (notably older Workers runtimes and custom test harnesses) may not expose every
// console method.
//
// `getConsoleMethod()` returns the requested console method when available and falls back to
// `console.log` otherwise, preventing a missing-method crash from surfacing into application
// code.
//
// Not exported from `src/lib/logging/index.ts`.

/** The subset of `console` method names used by built-in transports. */
export type ConsoleMethodName = "debug" | "info" | "log" | "warn" | "error";

/**
 * Minimal console interface used internally by transports.
 *
 * Typed as `(...args: unknown[]) => void` so that both the real `console` object and
 * test-injected spies satisfy the shape without needing to reference DOM or Workers globals.
 */
export type ConsoleMethod = (...args: unknown[]) => void;

/**
 * A minimal console-like object that transports write to.
 *
 * Transports accept an optional `console` parameter (defaulting to the global `console`) so
 * that tests can inject a spy without patching the global.
 */
export type ConsoleLike = Partial<Record<ConsoleMethodName, ConsoleMethod>> & {
  log: ConsoleMethod;
};

/**
 * Return the named console method from `c`, falling back to `c.log` if the method is absent or
 * not a function.
 *
 * Rationale: logging must not crash because a host environment is missing a specific console
 * method. `console.log` is the safest baseline and is present in every JS environment that
 * supports `console` at all.
 *
 * @param c - The console-like object to query.
 * @param method - The preferred method name.
 * @returns The requested method if callable, otherwise `c.log`.
 */
export function getConsoleMethod(c: ConsoleLike, method: ConsoleMethodName): ConsoleMethod {
  const candidate = c[method];
  if (typeof candidate === "function") {
    return candidate.bind(c);
  }
  return c.log.bind(c);
}
