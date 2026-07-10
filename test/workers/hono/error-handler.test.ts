// Adapted from adrianhall/hono-problem-details's tests/handler.test.ts (MIT) — see
// THIRD-PARTY-NOTICES.md. Runs under workerd (@cloudflare/vitest-pool-workers, docs/SPECv2.md
// §7.2) against a bare `Hono` instance wired exactly as a real consumer would (docs/SPECv2.md
// §5.5) — `app.onError(problemDetailsErrorHandler(options))`. The `otelApi` cases from upstream
// are omitted: that integration is intentionally not ported (docs/SPECv2.md §5.4).
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  badRequest,
  forbidden,
  gone,
  internalServerError,
  methodNotAllowed,
  notFound,
  notImplemented,
  serviceUnavailable,
  unauthorized,
  unprocessableContent,
  unsupportedMediaType
} from "../../../src/lib/errors/generators.js";
import { problemDetails } from "../../../src/lib/problem-details/factory.js";
import {
  problemDetailsErrorHandler,
  type ProblemDetailsErrorHandlerOptions
} from "../../../src/lib/hono/error-handler.js";

function createApp(options?: ProblemDetailsErrorHandlerOptions) {
  const app = new Hono();
  app.onError(problemDetailsErrorHandler(options));
  return app;
}

describe("problemDetailsErrorHandler — every errors/ generator", () => {
  it.each([
    ["badRequest", badRequest, 400, "Bad Request"],
    ["unauthorized", unauthorized, 401, "Unauthorized"],
    ["forbidden", forbidden, 403, "Forbidden"],
    ["notFound", notFound, 404, "Not Found"],
    ["methodNotAllowed", methodNotAllowed, 405, "Method Not Allowed"],
    ["gone", gone, 410, "Gone"],
    ["unsupportedMediaType", unsupportedMediaType, 415, "Unsupported Media Type"],
    ["unprocessableContent", unprocessableContent, 422, "Unprocessable Content"],
    ["internalServerError", internalServerError, 500, "Internal Server Error"],
    ["notImplemented", notImplemented, 501, "Not Implemented"],
    ["serviceUnavailable", serviceUnavailable, 503, "Service Unavailable"]
  ] as const)(
    "%s produces the correct RFC 9457 shape and status",
    async (name, generator, status, title) => {
      const app = createApp();
      app.get("/", () => {
        throw generator({ detail: `${name} detail` });
      });
      const res = await app.request("/");
      expect(res.status).toBe(status);
      expect(res.headers.get("Content-Type")).toBe("application/problem+json; charset=utf-8");
      const body = await res.json();
      expect(body).toMatchObject({
        type: "about:blank",
        status,
        title,
        detail: `${name} detail`
      });
    }
  );
});

describe("problemDetailsErrorHandler — ProblemDetailsError", () => {
  it("returns a ProblemDetailsError response as-is", async () => {
    const app = createApp();
    app.get("/", () => {
      throw problemDetails({
        status: 409,
        type: "https://example.com/conflict",
        title: "Conflict",
        detail: "Resource already exists"
      });
    });
    const res = await app.request("/");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.type).toBe("https://example.com/conflict");
    expect(body.title).toBe("Conflict");
    expect(body.detail).toBe("Resource already exists");
  });

  it("typePrefix does not override a ProblemDetailsError's pre-set type", async () => {
    const app = createApp({ typePrefix: "https://api.example.com/problems" });
    app.get("/", () => {
      throw problemDetails({ status: 409, type: "https://custom.example.com/conflict" });
    });
    const res = await app.request("/");
    const body = await res.json();
    expect(body.type).toBe("https://custom.example.com/conflict");
  });

  it("sets problemDetails on context", async () => {
    let captured: unknown;
    const app = new Hono();
    app.use(async (c, next) => {
      await next();
      captured = c.get("problemDetails");
    });
    app.onError(problemDetailsErrorHandler());
    app.get("/", () => {
      throw problemDetails({ status: 409, title: "Conflict" });
    });
    await app.request("/");
    expect(captured).toBeDefined();
    expect((captured as { status: number }).status).toBe(409);
  });
});

describe("problemDetailsErrorHandler — plain HTTPException", () => {
  it("converts HTTPException to Problem Details", async () => {
    const app = createApp();
    app.get("/", () => {
      throw new HTTPException(403, { message: "Forbidden" });
    });
    const res = await app.request("/");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.type).toBe("about:blank");
    expect(body.status).toBe(403);
    expect(body.title).toBe("Forbidden");
    expect(body.detail).toBe("Forbidden");
  });

  it("HTTP response status matches body status (RFC 9457)", async () => {
    const app = createApp();
    app.get("/", () => {
      throw new HTTPException(422);
    });
    const res = await app.request("/");
    const body = await res.json();
    expect(res.status).toBe(body.status);
  });
});

describe("problemDetailsErrorHandler — unhandled Error fallback", () => {
  it("converts a generic Error to a 500 Problem Details with a safe detail", async () => {
    const app = createApp();
    app.get("/", () => {
      throw new Error("Something broke");
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.type).toBe("about:blank");
    expect(body.status).toBe(500);
    expect(body.title).toBe("Internal Server Error");
    expect(body.detail).toBe("An unexpected error occurred");
    expect(body.detail).not.toContain("Something broke");
  });
});

describe("problemDetailsErrorHandler — includeStack (docs/SPECv2.md §9)", () => {
  it("defaults to false: never leaks a stack trace by default", async () => {
    const app = createApp();
    app.get("/", () => {
      throw new Error("Secret error");
    });
    const res = await app.request("/");
    const body = await res.json();
    expect(body.detail).toBe("An unexpected error occurred");
    expect(body.detail).not.toContain("Secret error");
    expect(body.stack).toBeUndefined();
  });

  it("exposes the stack in extensions.stack (not detail) only when explicitly true", async () => {
    const app = createApp({ includeStack: true });
    app.get("/", () => {
      throw new Error("Debug error");
    });
    const res = await app.request("/");
    const body = await res.json();
    expect(body.stack).toContain("Debug error");
    expect(body.detail).toBe("An unexpected error occurred");
    expect(body.detail).not.toContain("Debug error");
  });
});

describe("problemDetailsErrorHandler — typePrefix/defaultType", () => {
  it("uses typePrefix to build the type URI", async () => {
    const app = createApp({ typePrefix: "https://api.example.com/problems" });
    app.get("/", () => {
      throw new HTTPException(422);
    });
    const res = await app.request("/");
    const body = await res.json();
    expect(body.type).toBe("https://api.example.com/problems/unprocessable-content");
  });

  it("uses about:blank when typePrefix is not set", async () => {
    const app = createApp();
    app.get("/", () => {
      throw new HTTPException(404);
    });
    const res = await app.request("/");
    const body = await res.json();
    expect(body.type).toBe("about:blank");
  });

  it("uses defaultType when set and typePrefix is not", async () => {
    const app = createApp({ defaultType: "https://example.com/default" });
    app.get("/", () => {
      throw new HTTPException(400);
    });
    const res = await app.request("/");
    const body = await res.json();
    expect(body.type).toBe("https://example.com/default");
  });

  it("falls back to about:blank when typePrefix is set but the status has no known slug", async () => {
    const app = createApp({ typePrefix: "https://api.example.com/problems" });
    app.get("/", () => {
      // 419 has no entry in statusToSlug's map — cast through unknown since HTTPException's
      // constructor only accepts known ContentfulStatusCode literals (mirrors upstream's own
      // H18 test, which uses the same cast to reach this branch).
      throw new HTTPException(419 as unknown as 400);
    });
    const res = await app.request("/");
    const body = await res.json();
    expect(body.type).toBe("about:blank");
  });

  it("falls back to defaultType (not about:blank) when typePrefix is set but the slug is unknown", async () => {
    const app = createApp({
      typePrefix: "https://api.example.com/problems",
      defaultType: "https://api.example.com/problems/unknown"
    });
    app.get("/", () => {
      throw new HTTPException(419 as unknown as 400);
    });
    const res = await app.request("/");
    const body = await res.json();
    expect(body.type).toBe("https://api.example.com/problems/unknown");
  });
});

describe("problemDetailsErrorHandler — mapError", () => {
  it("uses a custom mapError mapping", async () => {
    class CustomError extends Error {
      statusCode = 418;
    }
    const app = createApp({
      mapError: (error) => {
        if (error instanceof CustomError) {
          return { status: error.statusCode, title: "I'm a Teapot", detail: error.message };
        }
        return undefined;
      }
    });
    app.get("/", () => {
      throw new CustomError("Custom error");
    });
    const res = await app.request("/");
    expect(res.status).toBe(418);
    const body = await res.json();
    expect(body.title).toBe("I'm a Teapot");
    expect(body.detail).toBe("Custom error");
  });

  it("falls back to the default 500 when mapError returns undefined", async () => {
    const app = createApp({ mapError: () => undefined });
    app.get("/", () => {
      throw new Error("Unmapped error");
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.title).toBe("Internal Server Error");
  });

  it("mapError takes precedence over HTTPException handling", async () => {
    const app = createApp({
      mapError: (error) => {
        if (error instanceof HTTPException) {
          return { status: 409, title: "Mapped HTTPException" };
        }
        return undefined;
      }
    });
    app.get("/", () => {
      throw new HTTPException(403, { message: "Forbidden" });
    });
    const res = await app.request("/");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.title).toBe("Mapped HTTPException");
  });
});

describe("problemDetailsErrorHandler — localize", () => {
  it("transforms ProblemDetails before the response is sent", async () => {
    const app = createApp({
      localize: (pd) => ({
        title: `[ja] ${pd.title}`,
        detail: pd.detail ? `[ja] ${pd.detail}` : undefined
      })
    });
    app.get("/", () => {
      throw new HTTPException(404, { message: "Resource not found" });
    });
    const res = await app.request("/");
    const body = await res.json();
    expect(body.title).toBe("[ja] Not Found");
    expect(body.detail).toBe("[ja] Resource not found");
  });

  it("receives the Hono context (e.g. for Accept-Language access)", async () => {
    const app = createApp({
      localize: (pd, c) => {
        const lang = c.req.header("Accept-Language");
        return lang?.startsWith("ja") ? { title: "見つかりません" } : undefined;
      }
    });
    app.get("/", () => {
      throw new HTTPException(404);
    });
    const res = await app.request("/", { headers: { "Accept-Language": "ja-JP" } });
    const body = await res.json();
    expect(body.title).toBe("見つかりません");
  });

  it("falls back to the un-localized response when localize throws", async () => {
    const app = createApp({
      localize: () => {
        throw new Error("boom");
      }
    });
    app.get("/", () => {
      throw problemDetails({ status: 400, title: "Bad Request", detail: "original detail" });
    });
    const res = await app.request("/");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.title).toBe("Bad Request");
    expect(body.detail).toBe("original detail");
  });
});

describe("problemDetailsErrorHandler — autoInstance", () => {
  it("defaults to off: no instance is populated", async () => {
    const app = createApp();
    app.get("/orders/:id", () => {
      throw problemDetails({ status: 404, title: "Not Found" });
    });
    const res = await app.request("/orders/123");
    const body = await res.json();
    expect(body.instance).toBeUndefined();
  });

  it("populates instance from the request path when enabled", async () => {
    const app = createApp({ autoInstance: true });
    app.get("/orders/:id", () => {
      throw problemDetails({ status: 404, title: "Not Found" });
    });
    const res = await app.request("/orders/123");
    const body = await res.json();
    expect(body.instance).toBe("/orders/123");
  });

  it("does not overwrite an explicit instance", async () => {
    const app = createApp({ autoInstance: true });
    app.get("/orders/:id", () => {
      throw problemDetails({ status: 404, title: "Not Found", instance: "urn:order:123" });
    });
    const res = await app.request("/orders/123");
    const body = await res.json();
    expect(body.instance).toBe("urn:order:123");
  });
});

describe("problemDetailsErrorHandler — extension safety (shared with problem-details/utils)", () => {
  it("strips dangerous extension keys", async () => {
    const app = createApp({
      mapError: () => ({
        status: 400,
        extensions: { constructor: "bad", prototype: "bad", safe: "ok" }
      })
    });
    app.get("/", () => {
      throw new Error("test");
    });
    const res = await app.request("/");
    const body = await res.json();
    expect(body.safe).toBe("ok");
    expect(Object.hasOwn(body, "constructor")).toBe(false);
    expect(Object.hasOwn(body, "prototype")).toBe(false);
  });

  it("returns a fallback 500 when extensions contain a circular reference", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const app = createApp({ mapError: () => ({ status: 422, extensions: circular }) });
    app.get("/", () => {
      throw new Error("test");
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.type).toBe("about:blank");
    expect(body.title).toBe("Internal Server Error");
  });
});
