# Utilities

`/guards` collects a small number of testable defensive helpers that replace inline, ad hoc
`if (!x) throw ...` or `??` fallback branches with a single, individually-tested function. The
motivating goal, straight from this toolkit's own engineering spec: keep **100% branch coverage**
achievable in application code without reaching for `istanbul ignore` annotations.

Every ad hoc defensive branch you write yourself is a branch someone has to cover with a test to
hit 100% coverage — often an awkward one, because "this should never happen" paths are exactly
the ones real test fixtures don't naturally exercise. Centralizing them into `/guards` means:

- The awkward branch (the guard's own `if`) is tested **once**, inside this toolkit, not
  separately at every call site.
- A lint rule can allowlist the one blessed helper (`valueOrDefault`) while still flagging other
  ad hoc `??` usage as suspicious.
- Every guard failure throws a distinctly-named error (`NullError` / `InvalidShapeError` — see
  the [Error Handling guide](/guides/error-handling)) with a single, greppable call site, instead
  of an anonymous inline throw scattered across the codebase.

## `throwIfNull(value, message)`

Use when a value must not be `null`/`undefined` and you want TypeScript narrowing for free. This
is a genuine [assertion function](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html#assertion-functions)
— after it returns without throwing, `value` is narrowed to `NonNullable<T>` for the rest of the
scope, no separate `if`/cast required.

```ts
import { throwIfNull } from "@adrianhall/cloudflare-toolkit/guards";

const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
throwIfNull(row, `User ${id} not found in a context where it must exist`);
row.email; // narrowed — no longer `T | null`
```

This is the right tool specifically for the **"this should never happen"** case — a D1 query you
expect to always return a row given the caller's contract, not a legitimate "not found" the user
triggered (that's a `notFound()` from the [Error Handling guide](/guides/error-handling)
instead). Throws `NullError` when `value` is `null`/`undefined`.

## `valueOrDefault(value, defaultValue)`

Literally `value ?? defaultValue`. It exists purely so a lint rule can allowlist this **one**
helper while flagging other defensive `??` fallbacks in application code as something to review
— every `/logging` transport in this toolkit itself uses it internally for exactly that reason
(see the [Logging guide](/guides/logging)'s transport internals):

```ts
import { valueOrDefault } from "@adrianhall/cloudflare-toolkit/guards";

const level = valueOrDefault(options.level, "info");
```

## `sqlCount(row, countProperty?)`

Use for the common D1 `SELECT COUNT(*) AS count FROM t` → `.first<{ count: number }>()` pattern,
where a missing or malformed row means a bug in the query or schema — not a legitimate `0`:

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

`sqlCount` throws two different, distinctly-named errors depending on exactly what went wrong —
useful when you're debugging _why_ a count query failed, rather than just that it did:

- **`NullError`** — `row` itself is `null`/`undefined` (D1's `.first()` returned no rows at all).
- **`InvalidShapeError`** — `row` is non-null but doesn't have the expected shape: it isn't an
  object, or `countProperty` on it is missing or not a number.

Both are `ProblemDetailsError` subclasses, so `problemDetailsErrorHandler` (`/hono`) handles a
guard failure exactly like every other thrown error, with no special-casing — see the
[Error Handling guide](/guides/error-handling) for the full response shape.

## See also

- [Error Handling](/guides/error-handling) — the `NullError`/`InvalidShapeError` classes these
  guards throw, and how they surface in an HTTP response.
- The toolkit's own contributor documentation (`AGENTS.md`) documents the same 100%-coverage
  philosophy that motivates these guards, applied to this package's own source.
