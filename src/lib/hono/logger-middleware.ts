/**
 * @file `cloudflareLogger` — Hono middleware that injects a structured logger, backed by
 * `@adrianhall/cloudflare-toolkit/logging`'s core, into the request pipeline for other
 * middleware/handlers to use.
 *
 * This middleware does not perform automatic request/response trace logging, correlation-id
 * derivation, header redaction, or response-body preview capture — it only resolves a `Logger`
 * via `resolveLoggerConfig`/`createLogger` (`../logging/*`) and sets it as the `LOGGER` context
 * variable (`LoggerVariables`, ./types.ts) for downstream code to read.
 */
import type { MiddlewareHandler } from "hono";
import { LOG_LEVELS } from "../logging/levels.js";
import { createLogger } from "../logging/logger.js";
import { resolveLoggerConfig } from "../logging/resolve.js";
import type { Environment, LogLevel, Logger, Transport } from "../logging/types.js";
import type { LoggerVariables } from "./types.js";

/**
 * Worker bindings read by {@link cloudflareLogger} at request time.
 */
interface EnvironmentBindings {
  /** Environment name used to resolve the default level/transport via `resolveLoggerConfig`. */
  readonly ENVIRONMENT?: Environment;
  /**
   * Operational override for the minimum log level. When set to one of the recognised
   * {@link LogLevel} values (`trace`/`debug`/`info`/`warn`/`error`/`fatal`, case-insensitive),
   * it takes precedence over the environment-resolved default. An unrecognised value is ignored
   * with a `console.warn`. See {@link resolveEnvLogLevel}.
   */
  readonly LOG_LEVEL?: string;
}

/**
 * Parse and validate the `LOG_LEVEL` Worker binding into a {@link LogLevel}.
 *
 * Matching is case-insensitive against the six recognised levels. Exported for unit testing but
 * intentionally **not** re-exported from the `hono` barrel (`./index.ts`) — it is an internal
 * helper, not part of the public API.
 *
 * @param raw - The raw `c.env.LOG_LEVEL` value, or `undefined` when the binding is not set.
 * @returns The matching {@link LogLevel} when `raw` is a recognised level; otherwise `undefined`
 * (the binding is unset, or is set to an unrecognised value — in the latter case a `console.warn`
 * is emitted so the caller can fall back to its resolved default).
 */
export function resolveEnvLogLevel(raw: string | undefined): LogLevel | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const normalized = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LOG_LEVELS, normalized)) {
    return normalized as LogLevel;
  }
  console.warn(
    `Invalid LOG_LEVEL "${raw}"; expected one of: ${Object.keys(LOG_LEVELS).join(", ")}. `
      + `Falling back to the resolved default.`
  );
  return undefined;
}

/**
 * Options for {@link cloudflareLogger}.
 */
export interface CloudflareLoggerOptions {
  /**
   * Environment hint passed to `resolveLoggerConfig`. When omitted, the middleware reads
   * `c.env.ENVIRONMENT` at request time; when that is also absent, `resolveLoggerConfig` treats
   * it as `"production"`.
   */
  readonly environment?: Environment;
  /**
   * Minimum severity level to emit. This is the highest-priority source of the level: when set,
   * it wins over both the `LOG_LEVEL` binding and the environment-resolved default. When omitted,
   * the level is taken from `c.env.LOG_LEVEL` if it is a valid {@link LogLevel}, otherwise from
   * `resolveLoggerConfig(environment, "worker")`.
   */
  readonly level?: LogLevel;
  /**
   * Transport to receive emitted records. Defaults to the transport chosen by
   * `resolveLoggerConfig(environment, "worker")`. Inject a capture transport in tests to assert
   * on emitted records.
   */
  readonly transport?: Transport;
}

function resolveEnvironment(
  options: CloudflareLoggerOptions,
  bindings: EnvironmentBindings | undefined
): Environment | undefined {
  if (options.environment !== undefined) {
    return options.environment;
  }
  return bindings?.ENVIRONMENT;
}

/**
 * Create Hono middleware that attaches a request-scoped {@link Logger} to the context as
 * `LOGGER` (`LoggerVariables`, ./types.ts), so downstream middleware and handlers can log
 * through it.
 *
 * The logger's level and transport are resolved via `resolveLoggerConfig(environment, "worker")`
 * (`@adrianhall/cloudflare-toolkit/logging`) unless overridden. The minimum level is chosen in
 * this order of precedence:
 *
 * 1. `options.level`, when supplied.
 * 2. The `LOG_LEVEL` Worker binding (`c.env.LOG_LEVEL`), when it is a recognised {@link LogLevel}
 *    (case-insensitive). A value that is set but unrecognised is ignored with a `console.warn`.
 * 3. The environment-resolved default from `resolveLoggerConfig(environment, "worker")`.
 *
 * The transport defaults to `resolveLoggerConfig`'s choice unless overridden by
 * `options.transport`. This middleware is independently wireable — it has no dependency on
 * `cloudflareAccess`.
 *
 * @param options - Options controlling the environment, level, and transport used to build the
 * logger.
 * @returns A Hono `MiddlewareHandler` parameterised with {@link LoggerVariables}, so
 * `c.set("LOGGER", …)` inside this middleware — and `c.get("LOGGER")` in a consumer's own
 * handlers once composed via `app.use(...)` — are statically checked against
 * {@link LoggerVariables} rather than accepted as an untyped magic string.
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { cloudflareLogger } from "@adrianhall/cloudflare-toolkit/hono";
 *
 * const app = new Hono();
 * app.use(cloudflareLogger());
 *
 * app.get("/", (c) => {
 *   c.get("LOGGER").info("handling request");
 *   return c.text("ok");
 * });
 * ```
 */
export function cloudflareLogger(
  options: CloudflareLoggerOptions = {}
): MiddlewareHandler<{ Variables: LoggerVariables }> {
  return async (c, next) => {
    const bindings = c.env as EnvironmentBindings | undefined;
    const environment = resolveEnvironment(options, bindings);
    const base = resolveLoggerConfig(environment, "worker");
    const envLevel = resolveEnvLogLevel(bindings?.LOG_LEVEL);
    const logger: Logger = createLogger({
      level: options.level ?? envLevel ?? base.level,
      transport: options.transport ?? base.transport
    });

    c.set("LOGGER", logger);

    await next();
  };
}
