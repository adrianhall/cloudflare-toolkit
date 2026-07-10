# Third-Party Notices

This package vendors (copies source into this repository, rather than depending on) code from
third-party, MIT-licensed projects. This notice preserves the required copyright/license
attribution for that vendored code, per docs/SPECv2.md §5.4.

## `src/lib/problem-details/`

The RFC 9457 Problem Details core primitives under `src/lib/problem-details/` (`ProblemDetailsError`,
`problemDetails()`, `statusToPhrase`, `statusToSlug`, `createProblemTypeRegistry`, and the
`ProblemDetails`/`ProblemDetailsInput` types) are a vendored port of:

- [`adrianhall/hono-problem-details`](https://github.com/adrianhall/hono-problem-details) — MIT
  License, Copyright (c) 2026 hono-problem-details contributors.
- Itself a fork of [`paveg/hono-problem-details`](https://github.com/paveg/hono-problem-details) —
  MIT License, Copyright (c) 2026 hono-problem-details contributors.

This code is vendored — copied at a point in time — rather than depended upon, because
`adrianhall/hono-problem-details` is not published to npm and so cannot be a resolvable
`dependency`/`peerDependency` of a published package. Vendoring does not imply any ongoing
relationship with, or endorsement by, either upstream project. This notice is the authoritative
record of the vendored files' origin — the files themselves carry only a purpose-focused `@file`
comment, not a source-attribution header.

Only the Hono-free core primitives were ported. The `zod`/`valibot`/`openapi`/`standard-schema`/
`opentelemetry` integrations, and the Hono-specific `problemDetailsHandler`, were intentionally
**not** ported into this subpath — see docs/SPECv2.md §5.4. The Hono-specific handler is instead
vendored separately, directly below.

## `src/lib/hono/error-handler.ts`

The `problemDetailsErrorHandler` function is a vendored port of upstream's `problemDetailsHandler`
(renamed to match this toolkit's naming), from the same two projects and under the same MIT
license as above:

- [`adrianhall/hono-problem-details`](https://github.com/adrianhall/hono-problem-details)'s
  `src/handler.ts` — MIT License, Copyright (c) 2026 hono-problem-details contributors.
- Itself a fork of [`paveg/hono-problem-details`](https://github.com/paveg/hono-problem-details) —
  MIT License, Copyright (c) 2026 hono-problem-details contributors.

It is a **direct re-export**, not a toolkit-authored wrapper (docs/SPECv2.md §5.4/§5.5, §9) — the
only change beyond the rename is dropping the `otelApi` option and its backing
`integrations/opentelemetry.ts` file, since the opentelemetry integration (along with
`zod`/`valibot`/`openapi`/`standard-schema`) is explicitly out of scope for v1 (docs/SPECv2.md
§5.4). It shares the Hono-free primitives above (`statusToPhrase`, `buildProblemResponse`, etc.)
rather than duplicating them.

`notFoundHandler` in the same directory has no vendored equivalent — it is toolkit-authored (see
docs/SPECv2.md §5.5) and is not covered by this notice.

### MIT License text

```text
MIT License

Copyright (c) 2026 hono-problem-details contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
