# Error Handling

An API is easier to consume when every failure has the same shape. Without a shared error handler, each route tends to invent its own JSON body, and an unexpected exception may produce a completely different response again.

The Cloudflare Toolkit turns thrown errors and unmatched Hono routes into [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details responses. Your application throws an error that describes the failure; the toolkit handles the HTTP response.

## Wire error handling once

Register [`problemDetailsErrorHandler()`](/reference/lib/hono/functions/problemDetailsErrorHandler.md) with `app.onError()` and [`notFoundHandler()`](/reference/lib/hono/functions/notFoundHandler.md) with `app.notFound()`:

```ts
import { Hono } from "hono";
import { notFound, unprocessableContent } from "@adrianhall/cloudflare-toolkit/errors";
import { notFoundHandler, problemDetailsErrorHandler } from "@adrianhall/cloudflare-toolkit/hono";

const app = new Hono();

app.onError(problemDetailsErrorHandler());
app.notFound(notFoundHandler());

app.get("/orders/:id", async (c) => {
  const id = c.req.param("id");
  const order = await findOrder(id);

  if (!order) {
    throw notFound({ detail: `Order ${id} does not exist` });
  }

  return c.json(order);
});

app.post("/orders", async (c) => {
  const body = await c.req.json<{ sku?: string }>();

  if (!body.sku) {
    throw unprocessableContent({ detail: "sku is required" });
  }

  return c.json(await createOrder(body.sku), 201);
});
```

The two Hono hooks are independent and both are required. `app.onError()` handles thrown errors, while `app.notFound()` handles requests that match no route.

Throwing `notFound({ detail: "Order 42 does not exist" })` produces:

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "about:blank",
  "status": 404,
  "title": "Not Found",
  "detail": "Order 42 does not exist"
}
```

The `type` defaults to `"about:blank"`, and the `title` is derived from the status code. The same handler also converts Hono `HTTPException` instances and unexpected exceptions into Problem Details responses, so clients receive a consistent content type and shape.

## Throw common HTTP errors

We provide a set of generators that are used for common application-level status responses. Every generator accepts optional `detail`, `type`, `instance`, and `extensions` fields and returns a [`ProblemDetailsError`](/reference/index/classes/ProblemDetailsError.md) ready to throw.

| Generator                      | Status |
| ------------------------------ | ------ |
| `badRequest(input?)`           | 400    |
| `unauthorized(input?)`         | 401    |
| `forbidden(input?)`            | 403    |
| `notFound(input?)`             | 404    |
| `methodNotAllowed(input?)`     | 405    |
| `gone(input?)`                 | 410    |
| `contentTooLarge(input?)`      | 413    |
| `unsupportedMediaType(input?)` | 415    |
| `unprocessableContent(input?)` | 422    |
| `internalServerError(input?)`  | 500    |
| `notImplemented(input?)`       | 501    |
| `serviceUnavailable(input?)`   | 503    |

These generators are not tied to Hono. You can throw them from a route, a service function, or a Durable Object method and let the nearest error boundary decide how to turn them into a response.

### Add machine-readable fields

Use `extensions` when a client needs structured information beyond the human-readable `detail`. RFC 9457 extension members are flattened into the response body:

```ts
throw unprocessableContent({
  detail: "sku is required",
  extensions: { missingFields: ["sku"] }
});
```

The response includes `"missingFields": ["sku"]` alongside `type`, `status`, `title`, and `detail`.

## Customize the responses

The default configuration is enough for many APIs. When you need documented problem type URIs, request instances, custom error mapping, or localization, pass options to the handlers.

### Identify problem types and instances

Use the same common options for both Hono hooks so handler-generated errors follow the same conventions:

```ts
const commonProblemOptions = {
  typePrefix: "https://api.example.com/problems",
  autoInstance: true
};

app.onError(problemDetailsErrorHandler(commonProblemOptions));
app.notFound(notFoundHandler(commonProblemOptions));
```

An unmatched route now has a type such as `https://api.example.com/problems/not-found`, while `instance` is populated from the request path. `typePrefix` also applies when `problemDetailsErrorHandler()` converts a Hono `HTTPException` or an unexpected exception.

A thrown `ProblemDetailsError` already has a normalized `type`. Set it directly when the error represents an application-specific category:

```ts
throw notFound({
  type: "https://api.example.com/problems/order-not-found",
  detail: `Order ${id} does not exist`
});
```

An explicit `instance` also takes precedence over `autoInstance`.

### Map application errors

Use `mapError` when your domain layer throws its own `Error` subclasses. Return a problem input for errors you recognize and `undefined` for everything else:

```ts
class OutOfStockError extends Error {}

app.onError(
  problemDetailsErrorHandler({
    mapError(error) {
      if (error instanceof OutOfStockError) {
        return {
          type: "https://api.example.com/problems/out-of-stock",
          status: 409,
          title: "Out of Stock",
          detail: error.message
        };
      }
    }
  })
);
```

Unrecognized errors still fall through to the generic `500 Internal Server Error` response.

### Localize client-facing text

Use `localize` to patch a problem immediately before it is sent. The callback can inspect the request context and return only the fields it wants to change:

```ts
app.onError(
  problemDetailsErrorHandler({
    localize(problem, c) {
      const prefersFrench = c.req.header("accept-language")?.startsWith("fr");

      if (prefersFrench && problem.status === 404) {
        return { title: "Introuvable" };
      }
    }
  })
);
```

If the localizer throws, the handler sends the original problem rather than failing while handling another error.

### Keep stack traces out of production

`includeStack` defaults to `false`. It adds the stack trace to generic `500` responses and is useful only during local development:

```ts
app.onError(
  problemDetailsErrorHandler({
    includeStack: import.meta.env.DEV
  })
);
```

Never enable this unconditionally in a deployed Worker. Stack traces can expose internal paths, implementation details, and sensitive data.

See
[`ProblemDetailsErrorHandlerOptions`](/reference/lib/hono/interfaces/ProblemDetailsErrorHandlerOptions.md) and [`NotFoundHandlerOptions`](/reference/lib/hono/interfaces/NotFoundHandlerOptions.md) for the complete option reference.

## Define application-specific problem types

The common generators intentionally cover only a focused set of HTTP statuses. Use [`problemDetails()`](/reference/index/functions/problemDetails.md) for a one-off status or problem type that does not have a generator:

```ts
import { problemDetails } from "@adrianhall/cloudflare-toolkit/problem-details";

throw problemDetails({
  type: "https://api.example.com/problems/order-conflict",
  status: 409,
  title: "Order Conflict",
  detail: `Order ${orderId} already exists`
});
```

If your API has a fixed catalog of problem types, define it once with [`createProblemTypeRegistry()`](/reference/index/functions/createProblemTypeRegistry.md). The registry keeps problem keys type-safe and avoids repeating each type, status, and title at every throw site:

```ts
import { createProblemTypeRegistry } from "@adrianhall/cloudflare-toolkit/problem-details";

const problems = createProblemTypeRegistry({
  ORDER_CONFLICT: {
    type: "https://api.example.com/problems/order-conflict",
    status: 409,
    title: "Order Conflict"
  }
});

throw problems.create("ORDER_CONFLICT", {
  detail: `Order ${orderId} already exists`
});
```

The `/problem-details` entry point is Hono-free, so these primitives are safe to use in Workers, Durable Objects, Node.js, and browser code.

## Return a response outside Hono

When there is no Hono error handler, catch `ProblemDetailsError` at your own boundary and call [`getResponse()`](/reference/index/classes/ProblemDetailsError.md#getresponse):

```ts
import { ProblemDetailsError } from "@adrianhall/cloudflare-toolkit/problem-details";

try {
  return await handleRequest(request);
} catch (error) {
  if (error instanceof ProblemDetailsError) {
    return error.getResponse();
  }
  throw error;
}
```

`getResponse()` returns the same `application/problem+json` response without depending on Hono.

## Guard failures

[`throwIfNull()`](/reference/index/functions/throwIfNull.md) and [`sqlCount()`](/reference/index/functions/sqlCount.md) throw specialized `ProblemDetailsError` subclasses when a defensive assumption fails. You do not need to catch them separately; `problemDetailsErrorHandler()` handles them like any other internal error. See [Utilities](/guides/utilities) for when to use those guards instead of a user-facing `notFound()`.

## See also

- [Utilities](/guides/utilities) - defensive guards that surface through the same error handler.
- [Authentication](/guides/authentication) - the RFC 9457 shape returned for failed Access authentication.
- [API reference](/reference/) - the complete error, handler, and Problem Details API surface.
