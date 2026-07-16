# Error Handling

`@adrianhall/cloudflare-toolkit` turns thrown errors into
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details responses —
`application/problem+json` bodies with a consistent `type`/`status`/`title`/`detail`/`instance`
shape — instead of ad hoc error JSON that differs from route to route.

Three layers, from highest- to lowest-level:

1. **`/errors`** — one generator function per supported HTTP status code. Throw these from a
   plain function, a Durable Object method, or a Hono handler identically.
2. **`/hono`**'s `problemDetailsErrorHandler` / `notFoundHandler` — turn a throw (or an
   unmatched route) into an actual `Response`.
3. **`/problem-details`** — the underlying, Hono-free primitives, for when you need a status
   code or `type` the generators don't cover.

## What a response actually looks like

Throwing `notFound({ detail: "Order 42 does not exist" })` through
`problemDetailsErrorHandler()` produces:

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

`type` defaults to `"about:blank"` when not specified; `title` is derived from `status` via
`statusToPhrase()`. Pass `typePrefix` to `problemDetailsErrorHandler()` to turn `type` into a
real, dereferenceable URI instead (see below).

## `/errors` — one generator per status code

Every generator has the signature `(input?: { detail?, type?, instance?, extensions? }) =>
ProblemDetailsError` and can be thrown from anywhere:

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

```ts
import { Hono } from "hono";
import { notFound, unprocessableContent } from "@adrianhall/cloudflare-toolkit/errors";
import { problemDetailsErrorHandler } from "@adrianhall/cloudflare-toolkit/hono";

const app = new Hono();
app.onError(problemDetailsErrorHandler());

app.get("/orders/:id", async (c) => {
  const order = await findOrder(c.req.param("id"));
  if (!order) {
    throw notFound({ detail: `Order ${c.req.param("id")} does not exist` });
  }
  return c.json(order);
});

app.post("/orders", async (c) => {
  const body = await c.req.json();
  if (!body.sku) {
    throw unprocessableContent({ detail: "sku is required" });
  }
  // ...
});
```

`429 Too Many Requests` is deliberately not included — it's a platform/rate-limiting concern,
not this toolkit's. `304 Not Modified`, `409 Conflict`, and `412 Precondition Failed` aren't
included either; their useful shape is a future Data Access Patterns concern.

### `extensions` — attaching extra fields

Every generator's `input` also accepts `extensions`, a plain object merged into the response body
alongside the standard RFC 9457 members — useful for machine-readable detail beyond `detail`'s
free text:

```ts
throw unprocessableContent({
  detail: "sku is required",
  extensions: { missingFields: ["sku"] }
});
```

### `NullError` / `InvalidShapeError`

Specialized `internalServerError()`-shaped `ProblemDetailsError` subclasses thrown internally by
`/guards`' `throwIfNull`/`sqlCount` (see the [Utilities guide](/guides/utilities)) —
you rarely construct these directly, but because both remain `ProblemDetailsError` instances,
`problemDetailsErrorHandler` handles them exactly like every other thrown error, with no
special-casing required:

```ts
import { InvalidShapeError, NullError } from "@adrianhall/cloudflare-toolkit/errors";

try {
  doSomethingRisky();
} catch (err) {
  if (err instanceof NullError || err instanceof InvalidShapeError) {
    // A defensive guard tripped — this is a bug, not user input. Log it distinctly if you want.
  }
  throw err;
}
```

## `problemDetailsErrorHandler(options?)` — wiring `app.onError`

Converts `ProblemDetailsError`, Hono's own `HTTPException`, and any other unhandled exception
into an RFC 9457 response:

```ts
app.onError(
  problemDetailsErrorHandler({
    typePrefix: "https://api.example.com/problems", // appends a status-derived slug to `type`
    defaultType: "about:blank", // used when typePrefix is unset; this is already the default
    autoInstance: true, // populate `instance` from c.req.path when not set explicitly
    includeStack: false // MUST stay false outside local development — see below
  })
);
```

With `typePrefix` set, a `404` becomes `"https://api.example.com/problems/not-found"` instead of
`"about:blank"` — handy once you want `type` to resolve to real documentation for each problem
category.

`includeStack` defaults to `false` and is **security-sensitive**: never set it `true` in a
deployed Worker. The stack is emitted as a top-level `stack` extension member (not folded into
`detail`), but it's still internal detail you don't want in a production response.

### Custom mapping and localization

Two escape hatches exist for apps that need more than the built-in `ProblemDetailsError` /
`HTTPException` handling:

- `mapError(error: Error)` — map any other thrown `Error` subclass to a `ProblemDetailsInput`
  before it falls through to the generic `500`:

  ```ts
  class OutOfStockError extends Error {}

  app.onError(
    problemDetailsErrorHandler({
      mapError(error) {
        if (error instanceof OutOfStockError) {
          return { status: 409, title: "Out of Stock", detail: error.message };
        }
        // Return undefined to fall through to the default handling for anything else.
      }
    })
  );
  ```

- `localize(pd, c)` — patch `title`/`detail` (or any other field) right before the response is
  sent, e.g. based on an `Accept-Language` header. Return a partial patch merged onto the
  problem; a thrown `localize` is swallowed so a broken localizer can't crash the error handler
  itself:

  ```ts
  app.onError(
    problemDetailsErrorHandler({
      localize(pd, c) {
        if (c.req.header("accept-language")?.startsWith("fr") && pd.status === 404) {
          return { title: "Introuvable" };
        }
      }
    })
  );
  ```

## `notFoundHandler(options?)` — wiring `app.notFound`

Produces the same RFC 9457 `404` shape that throwing `notFound()` through
`problemDetailsErrorHandler` would — without requiring a request to actually throw:

```ts
app.notFound(notFoundHandler({ typePrefix: "https://api.example.com/problems" }));
```

`app.notFound()` and `app.onError()` are **independent** Hono hooks — wiring both (as in
[Getting Started](/getting-started)) is normal and does **not** double-wrap a `404` response,
because `notFoundHandler` builds its `Response` directly rather than throwing into `onError`.
`notFoundHandler` accepts the same `typePrefix`/`defaultType`/`autoInstance` options as
`problemDetailsErrorHandler`, so the two hooks agree on conventions — but it has no `includeStack`
(there's no exception to have a stack trace from) and no `mapError`/`localize` (there's nothing
to map, and a fixed `404` has no per-error localization target beyond what `localize` on the
`onError` side already covers for thrown `notFound()`s).

## `/problem-details` — the underlying primitives

Hono-free by design — nothing under this subpath imports `hono`, so it's safe from any runtime.
It's a vendored port of
[`adrianhall/hono-problem-details`](https://github.com/adrianhall/hono-problem-details) — see
the repo's `THIRD-PARTY-NOTICES.md` for the required upstream attribution.

### `problemDetails(input)` / `ProblemDetailsError`

Use directly when you want a status/type not covered by an `/errors` generator:

```ts
import { problemDetails } from "@adrianhall/cloudflare-toolkit/problem-details";

throw problemDetails({
  status: 409,
  type: "https://api.example.com/problems/order-conflict",
  title: "Order Conflict",
  detail: `Order ${orderId} already exists`
});
```

`ProblemDetailsError#getResponse()` builds a standalone `application/problem+json` `Response`
without any Hono handler involved — useful outside a Hono app entirely, e.g. a Durable Object's
own `fetch`:

```ts
import { ProblemDetailsError } from "@adrianhall/cloudflare-toolkit/problem-details";

export class MyDurableObject {
  async fetch(request: Request): Promise<Response> {
    try {
      return await this.handle(request);
    } catch (err) {
      if (err instanceof ProblemDetailsError) {
        return err.getResponse();
      }
      throw err;
    }
  }
}
```

### `statusToPhrase(status)` / `statusToSlug(status)`

```ts
import { statusToPhrase, statusToSlug } from "@adrianhall/cloudflare-toolkit/problem-details";

statusToPhrase(404); // "Not Found"
statusToSlug(404); // "not-found" — used internally to build a typePrefix-derived `type` URI
```

Both cover the full standard set of 4xx/5xx status codes, not just the ones `/errors` has a named
generator for.

### `createProblemTypeRegistry(definitions)`

Use when an app has a fixed catalog of named problem types it wants type-safe creation for,
rather than constructing ad hoc `problemDetails()` calls at every throw site:

```ts
import { createProblemTypeRegistry } from "@adrianhall/cloudflare-toolkit/problem-details";

const problems = createProblemTypeRegistry({
  ORDER_CONFLICT: {
    type: "https://api.example.com/problems/order-conflict",
    status: 409,
    title: "Order Conflict"
  }
});

throw problems.create("ORDER_CONFLICT", { detail: "Already exists" });
problems.get("ORDER_CONFLICT"); // { type, status, title } — a defensive copy, safe to mutate
problems.types(); // ["ORDER_CONFLICT"]
```

### `ProblemDetails` / `ProblemDetailsInput` types

Use these when authoring a custom `mapError`/`localize` callback (above) that needs to read or
patch the standard RFC 9457 fields (`type`, `status`, `title`, `detail`, `instance`,
`extensions`).

## See also

- [Utilities](/guides/utilities) — why `throwIfNull`/`sqlCount` throw `NullError`/
  `InvalidShapeError` instead of an ad hoc branch.
- [Authentication](/guides/authentication) — the `401` responses `cloudflareAccess` returns use
  this same problem-details shape.
