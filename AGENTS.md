# AGENTS.md

Guidance for coding agents contributing to `@adrianhall/cloudflare-toolkit` **itself**. This is
distinct from `skills/cloudflare-toolkit/SKILL.md` (the installable Agent Skill, `npx skills add
adrianhall/cloudflare-toolkit`), which teaches _consumers_ how to use the published package. This
file teaches _contributors_ how the toolkit's own repository is built, tested, and structured. The
authoritative engineering contract is [`docs/SPECv2.md`](./docs/SPECv2.md); this file captures the
conventions and quality gates that are easy to miss.

## What this package is

A toolkit of framework-agnostic and Hono/Vite-specific utilities for building Cloudflare Workers
apps: defensive guards, RFC 9457 HTTP error generators, structured logging, Cloudflare
Access-aware Hono middleware, a Vite plugin, Vitest testing helpers, and a `generate-wrangler-types`
CLI. See [`README.md`](./README.md) for the consumer-facing quickstart and
[`docs/SPECv2.md`](./docs/SPECv2.md) §5 for the full contents.

| Subpath                                          | Runtime constraint                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `@adrianhall/cloudflare-toolkit` (root)          | Any runtime — re-exports `guards`/`errors`/`problem-details`/`logging` only |
| `@adrianhall/cloudflare-toolkit/guards`          | Any runtime                                                                 |
| `@adrianhall/cloudflare-toolkit/errors`          | Any runtime                                                                 |
| `@adrianhall/cloudflare-toolkit/problem-details` | Any runtime — Hono-free by design                                           |
| `@adrianhall/cloudflare-toolkit/logging`         | Any runtime                                                                 |
| `@adrianhall/cloudflare-toolkit/hono`            | `workerd` (or any Hono runtime) — requires `hono` peer                      |
| `@adrianhall/cloudflare-toolkit/vite`            | Node only — requires `vite` peer, never imported from Worker code           |
| `@adrianhall/cloudflare-toolkit/testing`         | Vitest/Playwright test runtime                                              |

## Non-negotiable: consult live documentation via MCP

**Before writing or reviewing any code that touches Cloudflare, Hono, Vite, or Vitest surfaces,
consult current documentation via an MCP documentation tool** (or, if none is configured, the
canonical docs URLs below) — do not rely solely on pre-trained/memorized knowledge. These
platforms move quickly; a model's training cutoff is frequently stale with respect to current
APIs, binding shapes, compatibility flags, and deprecations.

This applies in particular to:

- **Cloudflare Workers platform APIs** (bindings, `wrangler.jsonc` fields, compatibility dates) —
  consult [developers.cloudflare.com](https://developers.cloudflare.com/) or an equivalent MCP
  docs tool before changing anything that touches a binding shape or Workers runtime API.
- **Hono** routing/middleware/context APIs.
- **Vite** — and specifically, **Vite has a Cloudflare-specific documentation page that differs
  from Vite's generic docs**, required reading whenever this repo's code interacts with
  `@cloudflare/vite-plugin` or the Vite `Connect`/`Plugin` APIs `src/lib/vite/plugin.ts` depends
  on: [Cloudflare Plugin for Vite](https://developers.cloudflare.com/workers/vite-plugin/).
- **Vitest** — and specifically, **Vitest also has a Cloudflare-specific documentation page that
  differs from Vitest's generic docs**, required reading whenever this repo's code interacts with
  `@cloudflare/vitest-pool-workers` (i.e. anything under `test/workers/`):
  [Cloudflare Vitest Integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
  and its [Reference Samples/Recipes](https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/).

## Non-negotiable quality gates

Before considering any task complete, **both** of these MUST pass:

```sh
npm run check          # types, lint, format, pack
npm run test:coverage  # all Vitest projects + 100% coverage
```

- `npm run check` must report **zero errors**. It runs `check:types` (`tsc --noEmit`),
  `check:lint` (`eslint .`, scoped to `src/**/*.ts`), `check:format` (`prettier --check .`, which
  **does** cover this file and every other Markdown file in the repo), and `check:pack`
  (`npm pack --ignore-scripts --dry-run`) via `run-s`. Unlike `cloudflare-logger`, there is no
  `check:dist` gate — `dist/` is `.gitignore`d in this repo (built and published by CI, never
  committed), so there is nothing for a dist-freshness check to compare against.
- `npm run test:coverage` runs `vitest run --coverage` across the three Vitest projects
  (`test/node`, `test/workers`, `test/package` — see Project structure below) and must report
  **100% coverage** on statements, branches, functions, and lines. The thresholds are enforced in
  `vitest.config.ts` (`coverage.thresholds`, Istanbul provider), so a drop below 100% fails the
  run — it is not merely informational.

Do not lower the thresholds in `vitest.config.ts` to make a run pass. Close the gap properly (see
below).

### Pre-commit hook

A Husky pre-commit hook (`.husky/pre-commit`) auto-formats staged files with Prettier and
re-stages the result, then blocks the commit if `check:types` or `check:lint` fail. It does
**not** run tests or a build — `npm run check` (types/lint/format/pack) plus
`npm run test:coverage` together are the CI merge gate, not the commit-time hook. The hook is
activated automatically via the `prepare` script on `npm install` (this repo publishes to the npm
registry rather than distributing via a git tag, so — unlike `cloudflare-logger` — a `prepare`
script does not burden consumers).

## How to reach 100% coverage

When coverage drops below 100%, analyze the uncovered line and resolve it in this priority order
(copied from `cloudflare-logger/AGENTS.md`, binding here too — `docs/SPECv2.md` §7.3):

1. **Write a test.** If the gap is trivial to fill, or it is a path a real user can reach, add a
   test that exercises it. This is the default and strongly preferred outcome.
2. **Extract a small testable helper.** If a line is hard to reach because it is buried inside a
   larger function, factor it into a tiny, directly-importable helper and unit-test it in
   isolation. Export the helper from its own module — **not** from a barrel (`index.ts`) — so it
   stays out of the public API while still being unit-testable.
3. **Ignore the line — last resort only.** If, and only if, the test environment makes a line
   genuinely impractical to exercise, annotate it with:

   ```ts
   /* istanbul ignore next -- @preserve */
   ```

   Always include a short justification on the same or preceding line explaining _why_ the line
   cannot be tested, and get explicit maintainer sign-off (a review comment on the PR, not a
   self-granted exception) before merging it, per `docs/SPECv2.md` §8 rule 10.

There are currently **zero** `istanbul ignore` annotations anywhere in `src/`. Keep it that way
unless absolutely necessary — the target is zero at initial release, same starting bar
`cloudflare-logger` holds today.

Note: `src/**/index.ts` files (barrels) and `src/**/*.d.ts` are excluded from coverage. Everything
else under `src/` is measured.

## Project structure

```text
README.md                          # npm/GitHub landing page — short quickstart, links to the docs site
THIRD-PARTY-NOTICES.md             # required MIT attribution for vendored problem-details code (see below)
src/
  index.ts                         # root barrel: guards + errors + problem-details + logging ONLY
  lib/
    guards/
      index.ts guards.ts           # throwIfNull, valueOrDefault, sqlCount — depends only on errors
    errors/
      index.ts generators.ts null-error.ts invalid-shape-error.ts
                                    # badRequest/forbidden/notFound/... — depends only on problem-details
    problem-details/
      index.ts error.ts factory.ts status.ts registry.ts types.ts utils.ts
                                    # vendored/ported from adrianhall/hono-problem-details (§5.4) — Hono-free
    logging/
      index.ts logger.ts resolve.ts serialize.ts levels.ts types.ts
      internal/                    # console.ts, safe-json.ts, optional-field.ts (not exported from barrel)
      transports/                  # browser, capture, combine, console, silent, structured
    hono/
      index.ts cloudflare-access.ts logger-middleware.ts error-handler.ts not-found-handler.ts types.ts
                                    # requires hono; depends on auth-internal + logging + problem-details
    vite/
      index.ts plugin.ts login-page.ts
                                    # requires vite; Node-only; depends on auth-internal
    auth-internal/
      jwt.ts jwks.ts policy.ts types.ts
                                    # shared by hono/cloudflare-access.ts AND vite/plugin.ts — Worker-safe
    testing/
      index.ts                     # dev-JWT signing + cookie helpers for tests against cloudflareAccess
  cli/
    generate-wrangler-types/
      index.ts run.ts types.ts fs.ts wrangler.ts logger.ts
test/
  node/       # plain Node — guards, errors, problem-details, logging, auth-internal, vite (mock req/res), CLI
  workers/    # workerd via @cloudflare/vitest-pool-workers — hono/* middleware
  package/    # plain Node — imports the built dist/ for every subpath, asserts expected exports/types
skills/
  cloudflare-toolkit/SKILL.md      # installable Agent Skill (consumer-facing) — see docs/SPECv2.md §5.8
docs/
  SPECv2.md IDEA.md REVIEW.md REVIEW_FINDINGS.md
                                    # this repo's own engineering spec + review notes, NOT the published
                                    # docs site. The VitePress + TypeDoc docs site (§6.1) is scaffolded and
                                    # populated by later issues in the SPECv2.md sequence and will add its
                                    # own package.json/guide pages under this same docs/ directory — update
                                    # this map again once that lands.
AGENTS.md                          # this file
```

`skills/cloudflare-toolkit/SKILL.md` is being authored in a parallel workstream (tracking issue
sequence in `docs/SPECv2.md`); if it is not yet present in your checkout, treat the path above as
the intended location rather than an error.

## Architectural rules (do not violate)

- **Dependency direction is one-way: `guards` → `errors` → `problem-details`.** `guards` depends
  only on `errors` (for `NullError`/`InvalidShapeError`); `errors` depends only on
  `problem-details`. Never introduce a reverse dependency.
- **`hono` and `vite` both depend on the shared `auth-internal` module** (JWT/JWKS/policy
  matching) — never duplicate that logic in either subpath. `auth-internal` must stay
  **Worker-safe** (no Node-only APIs) even though `vite/plugin.ts` is Node-only, because
  `hono/cloudflare-access.ts` runs in `workerd`.
- **The root barrel (`src/index.ts`) never re-exports anything from `hono`, `vite`, or `testing`** —
  each pulls in a `hono`/`vite`/Node-only runtime dependency and stays import-by-subpath-only. This
  exact set of runtime exports is asserted by `test/package/index.test.ts`; do not add to it
  without updating that test.
- **No combined/coordinator middleware.** `cloudflareAccess`, `cloudflareLogger`,
  `problemDetailsErrorHandler`, and `notFoundHandler` are wired independently by the consumer
  (`docs/SPECv2.md` §5.5). Do not add a bundling helper that wires more than one of them together.
- **`auth-internal` is a single audited unit** (`docs/SPECv2.md` §9): a fix to JWT verification,
  JWKS fetching, or policy matching applied to one of its two consumers
  (`hono/cloudflare-access.ts`, `vite/plugin.ts`) and missed in the other is a security regression,
  not just an inconsistency. Treat any change under `src/lib/auth-internal/` as touching both call
  sites, and review/test both when either one changes.
- **Vendored code requires attribution.** `src/lib/problem-details/` (core primitives) and
  `src/lib/hono/error-handler.ts` (the Hono-wired handler) are vendored ports of
  `adrianhall/hono-problem-details`, not toolkit-authored code — see
  [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) for the required upstream attribution. When
  modifying either, keep `THIRD-PARTY-NOTICES.md` in sync and preserve the upstream sourcemap fix
  (`sourcemap: true`) rather than reverting to the original `paveg/hono-problem-details` behavior.
- **Use the guards, don't reinvent them.** Prefer `throwIfNull`/`valueOrDefault`/`sqlCount` over an
  inline defensive `??`/`if (!x) throw` in this repo's own source (`docs/SPECv2.md` §8 rule 8) —
  the toolkit should eat its own dog food, and it keeps ad hoc defensive branches centralized and
  individually testable per the coverage recipe above.
