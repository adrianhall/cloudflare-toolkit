/** @file Bounded, retrying Cloudflare REST helpers. */
import type { InventoryContext, InventoryError } from "./types.js";

const API_BASE = "https://api.cloudflare.com/client/v4";

interface ApiMessage {
  code?: number;
  message?: string;
}
interface Envelope<T> {
  success: boolean;
  errors: ApiMessage[];
  result: T;
  result_info?: { total_pages?: number; cursor?: string; total_count?: number };
}

/** Sanitized Cloudflare request failure. */
export class CloudflareRequestError extends Error {
  /** Creates a request failure. */
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number
  ) {
    super(message);
    this.name = "CloudflareRequestError";
  }
}

function validEnvelope<T>(value: unknown): value is Envelope<T> {
  if (value === null || typeof value !== "object") return false;
  const envelope = value as Partial<Envelope<T>>;
  return (
    typeof envelope.success === "boolean"
    && Array.isArray(envelope.errors)
    && "result" in envelope
    && (envelope.result_info === undefined
      || (envelope.result_info !== null
        && typeof envelope.result_info === "object"
        && !Array.isArray(envelope.result_info)))
  );
}

function safeMessage(ctx: InventoryContext, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(ctx.token, "[redacted]");
}

/** Requests and validates one Cloudflare API envelope. */
export async function request<T>(
  ctx: InventoryContext,
  path: string,
  init: RequestInit = {}
): Promise<Envelope<T>> {
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
    let response: Response;
    try {
      response = await ctx.fetchImpl(`${API_BASE}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${ctx.token}`, ...init.headers }
      });
    } catch (error) {
      clearTimeout(timer);
      if (attempt < ctx.retries) {
        await ctx.sleep(100 * 2 ** attempt);
        continue;
      }
      const message = safeMessage(ctx, error);
      throw new CloudflareRequestError(`request failed for ${path}: ${message}`, 0);
    }
    clearTimeout(timer);
    if ((response.status === 429 || response.status >= 500) && attempt < ctx.retries) {
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
      await ctx.sleep(
        Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 100 * 2 ** attempt
      );
      continue;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CloudflareRequestError(`non-JSON response from ${path}`, response.status);
    }
    if (!validEnvelope<T>(body))
      throw new CloudflareRequestError(
        `invalid Cloudflare API envelope from ${path}`,
        response.status
      );
    if (!response.ok || !body.success) {
      const first = body.errors[0];
      throw new CloudflareRequestError(
        safeMessage(ctx, first?.message ?? `HTTP ${response.status} from ${path}`),
        response.status,
        first?.code
      );
    }
    return body;
  }
}

/** Gets an unpaginated result. */
export async function get<T>(ctx: InventoryContext, path: string): Promise<T> {
  return (await request<T>(ctx, path)).result;
}

/** Gets all pages from a standard page-based endpoint. */
export async function list<T>(ctx: InventoryContext, path: string, perPage = 100): Promise<T[]> {
  const values: T[] = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const envelope = await request<T[]>(ctx, `${path}${separator}page=${page}&per_page=${perPage}`);
    if (!Array.isArray(envelope.result))
      throw new CloudflareRequestError(`expected array result from ${path}`, 200);
    values.push(...envelope.result);
    const totalPages = envelope.result_info?.total_pages;
    if (
      totalPages !== undefined
      && (typeof totalPages !== "number" || !Number.isInteger(totalPages) || totalPages < 1)
    )
      throw new CloudflareRequestError(`invalid total_pages from ${path}`, 200);
    if (totalPages === undefined ? envelope.result.length < perPage : page >= totalPages)
      return values;
  }
}

/** Percent-encodes a dynamic URL path segment. */
export function segment(value: string): string {
  return encodeURIComponent(value);
}

/** Converts an unknown failure to a safe inventory error. */
export function inventoryError(product: string, operation: string, error: unknown): InventoryError {
  if (error instanceof CloudflareRequestError)
    return {
      product,
      operation,
      status: error.status,
      code: error.code,
      message: error.message,
      permissionDenied:
        error.status === 401
        || error.status === 403
        || /permission|authoriz|access denied/i.test(error.message)
    };
  return {
    product,
    operation,
    message: error instanceof Error ? error.message : String(error),
    permissionDenied: false
  };
}

/** Creates a dependency-free concurrency limiter. */
export function createLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}
