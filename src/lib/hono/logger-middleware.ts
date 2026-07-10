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
import type { Context, MiddlewareHandler } from "hono";
import { createLogger } from "../logging/logger.js";
import { resolveLoggerConfig } from "../logging/resolve.js";
import type { Environment, LogLevel, Logger, Transport } from "../logging/types.js";

/**
 * Worker binding read by {@link cloudflareLogger} when `options.environment` is not supplied.
 */
interface EnvironmentBindings {
  /** Environment name used to resolve the default level/transport via `resolveLoggerConfig`. */
  readonly ENVIRONMENT?: Environment;
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
   * Minimum severity level to emit. Defaults to the level chosen by
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

function resolveEnvironment(options: CloudflareLoggerOptions, c: Context): Environment | undefined {
  if (options.environment !== undefined) {
    return options.environment;
  }
  const bindings = c.env as EnvironmentBindings | undefined;
  return bindings?.ENVIRONMENT;
}

/**
 * Create Hono middleware that attaches a request-scoped {@link Logger} to the context as
 * `LOGGER` (`LoggerVariables`, ./types.ts), so downstream middleware and handlers can log
 * through it.
 *
 * The logger's level and transport are resolved via `resolveLoggerConfig(environment, "worker")`
 * (`@adrianhall/cloudflare-toolkit/logging`) unless overridden by `options.level`/
 * `options.transport`. This middleware is independently wireable — it has no dependency on
 * `cloudflareAccess`.
 *
 * @param options - Options controlling the environment, level, and transport used to build the
 * logger.
 * @returns A Hono `MiddlewareHandler`.
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
export function cloudflareLogger(options: CloudflareLoggerOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const environment = resolveEnvironment(options, c);
    const base = resolveLoggerConfig(environment, "worker");
    const logger: Logger = createLogger({
      level: options.level ?? base.level,
      transport: options.transport ?? base.transport
    });

    c.set("LOGGER", logger);

    await next();
  };
}
