# Utilities

While building the toolkit, we noticed a small number of situations where helper methods would be useful. These are useful when attempting to get full coverage of a function or when working with D1.

Getting to 100% coverage is useful when coding with LLMs as regressions become very obvious.

## `throwIfNull(value, message)`

Use when a value must not be `null`/`undefined` and you want TypeScript narrowing for free. This is a genuine [assertion function](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html#assertion-functions). After it returns without throwing, `value` is narrowed to `NonNullable<T>` for the rest of the
scope.

```ts
import { throwIfNull } from "@adrianhall/cloudflare-toolkit/guards";

const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
throwIfNull(row, `User ${id} not found in a context where it must exist`);
row.email; // narrowed — no longer `T | null`
```

This is the right tool specifically for the **"this should never happen"** case — a D1 query you expect to always return a row given the caller's contract, not a legitimate "not found" the user triggered (that's a [`notFound()`](/reference/index/functions/notFound.md) from the [Error Handling guide](/guides/error-handling) instead).

This method throws [`NullError`](/reference/index/classes/NullError.md) when `value` is `null`/`undefined`.

## `valueOrDefault(value, defaultValue)`

Literally `value ?? defaultValue`. It exists purely so a lint rule can allowlist this **one** helper while flagging other defensive `??` fallbacks in application code as something to review:

```ts
import { valueOrDefault } from "@adrianhall/cloudflare-toolkit/guards";

const level = valueOrDefault(options.level, "info");
```

In many cases, the right-hand side of `??` can never happen - you include it to narrow the scope and avoi da nullable or optional value. Since the right-hand side can never occur, you will suffer a branch coverage issue. This function avoids that situation.

## `sqlCount(row, countProperty?)`

Use for the common D1 `SELECT COUNT(*) AS count FROM t` → `.first<{ count: number }>()` pattern, where a missing or malformed row means a bug in the query or schema — not a legitimate `0`:

```ts
import { sqlCount } from "@adrianhall/cloudflare-toolkit/guards";

const row = await db
  .prepare("SELECT COUNT(*) AS count FROM orders WHERE user_id = ?")
  .bind(userId)
  .first();
const total = sqlCount(row); // number — throws otherwise, never silently returns 0
```

Pass a second argument for a differently-named count column:

```ts
const row2 = await db.prepare("SELECT COUNT(*) AS n FROM orders").first();
const total2 = sqlCount(row2, "n");
```

[`sqlCount`](/reference/index/functions/sqlCount.md) throws two different, distinctly-named errors depending on exactly what went wrong — useful when you're debugging _why_ a count query failed, rather than just that it did:

- **[`NullError`](/reference/index/classes/NullError.md)** — `row` itself is `null`/`undefined` (D1's `.first()` returned no rows at all).
- **[`InvalidShapeError`](/reference/index/classes/InvalidShapeError.md)** — `row` is non-null but doesn't have the expected shape: it isn't an object, or `countProperty` on it is missing or not a number.

Both are [`ProblemDetailsError`](/reference/index/classes/ProblemDetailsError.md) subclasses, so our standard [`problemDetailsErrorHandler`](/reference/lib/hono/functions/problemDetailsErrorHandler.md) handles a guard failure exactly like every other thrown error. See the[Error Handling guide](/guides/error-handling) for the full response shape.

## See also

- [Error Handling](/guides/error-handling) — the [`NullError`](/reference/index/classes/NullError.md)/[`InvalidShapeError`](/reference/index/classes/InvalidShapeError.md) classes these guards throw, and how they surface in an HTTP response.
- The toolkit's own contributor documentation (`AGENTS.md`) documents the same 100%-coverage philosophy that motivates these guards, applied to this package's own source.
