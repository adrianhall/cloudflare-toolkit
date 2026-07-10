/**
 * @file A default-config helper that maps an environment + runtime pair to a ready-to-use
 * `{ level, transport }` pair.
 *
 * `resolveLoggerConfig()` is optional policy — `createLogger` does not require it. Applications
 * that need environment-specific configuration without hand-wiring transports can call this
 * helper and pass the result directly to `createLogger`.
 *
 * Policy table:
 *
 * | Environment   | Runtime   | Level   | Transport  |
 * |---------------|-----------|---------|------------|
 * | test          | browser   | trace   | capture    |
 * | test          | worker    | trace   | capture    |
 * | development   | browser   | info    | browser    |
 * | development   | worker    | debug   | console    |
 * | production    | browser   | warn    | browser    |
 * | production    | worker    | warn    | structured |
 * | unknown       | browser   | warn    | browser    |
 * | unknown       | worker    | warn    | structured |
 *
 * There is no `detectRuntime()` helper in the public API. Applications are expected to know
 * whether they are constructing a browser logger or a Worker logger.
 */
import { createBrowserTransport } from "./transports/browser.js";
import { createCaptureTransport } from "./transports/capture.js";
import { createConsoleTransport } from "./transports/console.js";
import { createStructuredTransport } from "./transports/structured.js";
import type { Environment, ResolvedLoggerConfig, Runtime } from "./types.js";

/**
 * Resolve a `{ level, transport }` configuration for the given environment and runtime.
 *
 * Each call creates a **fresh** transport instance. If you call this helper more than once with
 * the same arguments you will receive independent transport instances, which is intentional for
 * test isolation.
 *
 * Unknown or `undefined` environments are treated as `"production"`.
 *
 * @param environment - One of `"test"`, `"development"`, `"production"`, or any other string.
 *   `undefined` maps to production behavior.
 * @param runtime - Either `"browser"` or `"worker"`.
 * @returns A fresh `ResolvedLoggerConfig` ready to pass to `createLogger`.
 */
export function resolveLoggerConfig(
  environment: Environment | undefined,
  runtime: Runtime
): ResolvedLoggerConfig {
  // Normalise: anything that is not a recognised well-known string falls through to the
  // production defaults.
  const env = environment === "test" || environment === "development" ? environment : "production";

  if (env === "test") {
    return { level: "trace", transport: createCaptureTransport() };
  }

  if (env === "development") {
    if (runtime === "browser") {
      return { level: "info", transport: createBrowserTransport() };
    }
    // runtime === "worker"
    return { level: "debug", transport: createConsoleTransport() };
  }

  // production (and all unknown / undefined environments)
  if (runtime === "browser") {
    return { level: "warn", transport: createBrowserTransport() };
  }
  // runtime === "worker"
  return { level: "warn", transport: createStructuredTransport() };
}
