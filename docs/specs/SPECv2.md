# Engineering Specification - cloudflare-toolkit

Project: cloudflare-toolkit
Description: A toolkit of utilities and skills for developing Workers on the Cloudflare Dev Platform
Architect: Adrian Hall

## 1. Context

When developing Cloudflare Workers, there is a lot of boiler-plate code and knowledge that has historically been codified across multiple repositories and installed in a Workers project directly from GitHub.

This has caused un-necessary friction:

- Multiple libraries with no consistency on design or implementation.
- "Approved Scripts" functionality is friction in the npm ecosystem.
- Multiple libraries for the same basic functionality.

To remedy these problems, we propose a "cloudflare-toolkit".

- npm installable as `npm install @adrianhall/cloudflare-toolkit`
- generated via CI/CD to ensure the "Approved Scripts" problem doesn't happen
- vendored functionality where necessary
- MIT licensed (see §3)

## 2. Technical Stack

- Node.js `>= 24`, npm `>= 11` (needed for npm 11.x OIDC Trusted Publishing support in CI — §3)
- GitHub Actions for PR checks and Releases
  - **Note**: Many GitHub Actions have new versions because of imminent Node v20 support removal. Check release versions available on GitHub repositories before including.

Every pinned package below links to its npm registry page — the definitive source for the version
being pinned. Versions reflect what was actually published as of this writing, with two
deliberate exceptions (`typescript`, `@cloudflare/workers-types`) explained in §2.3.

### 2.1 Peer Dependencies

Declared in `package.json#peerDependencies`. Consumers install these themselves — the toolkit
never bundles them.

| Package                                      | Version    | Required?                                           |
| -------------------------------------------- | ---------- | --------------------------------------------------- |
| [`hono`](https://www.npmjs.com/package/hono) | `^4.12.28` | Required — everything under `/hono` (§5.5) needs it |
| [`vite`](https://www.npmjs.com/package/vite) | `^8.1.4`   | Optional — only `/vite` (§5.6) needs it             |

### 2.2 Dependencies

Declared in `package.json#dependencies` — installed regardless of which subpath a consumer
actually imports.

| Package                                                    | Version   | Why                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`jose`](https://www.npmjs.com/package/jose)               | `^6.2.3`  | JWT signing/verification for `cloudflareAccess`/`cloudflareAccessPlugin` (§5.5/§5.6) — carried over as-is from `cloudflare-auth`'s own existing dependency on it                                                                                                                                                                 |
| [`commander`](https://www.npmjs.com/package/commander)     | `^15.0.0` | CLI argument parsing for `generate-wrangler-types` (§5.7) — carried over as-is from `cloudflare-scripts`'s own existing dependency on it                                                                                                                                                                                         |
| [`chalk`](https://www.npmjs.com/package/chalk)             | `^5.6.2`  | Colorized stderr log output for `generate-wrangler-types`'s internal CLI logger (§5.7) — carried over as-is from `cloudflare-scripts`'s own existing dependency on it                                                                                                                                                            |
| [`cross-spawn`](https://www.npmjs.com/package/cross-spawn) | `^7.0.6`  | Safely spawns `npx wrangler types` for `generate-wrangler-types` (§5.7) without an unescaped `shell: true` string — fixes [SEC-002/CODE-001](https://github.com/adrianhall/cloudflare-toolkit/issues/47), a command-injection finding, while still resolving Windows `.cmd` shims correctly (`wrangler.ts`, `defaultExecRunner`) |

Only `generate-wrangler-types` (a `bin`, not an import subpath — §5.7) pulls in `commander`/
`chalk`/`cross-spawn`; nothing under `package.json#exports` depends on any of them, so
tree-shaking a consumer's own bundle of one of the importable subpaths never pays for the CLI's
dependencies. The vendored `hono-problem-details` primitives (§5.4) are pure TypeScript with no
dependencies of their own, and everything else (`guards`, `errors`, the `logging` core) is
self-contained.

### 2.3 DevDependencies (build, lint, test tooling)

| Package                                                                                            | Version                        | Purpose                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [`typescript`](https://www.npmjs.com/package/typescript)                                           | `^6.0.3`                       | Deliberately not npm's current `latest` tag — see note below                                                         |
| [`eslint`](https://www.npmjs.com/package/eslint)                                                   | `^10.6.0`                      | Static analysis (§8, rule 3)                                                                                         |
| [`typescript-eslint`](https://www.npmjs.com/package/typescript-eslint)                             | `^8.63.0`                      | Type-checked lint rules                                                                                              |
| [`eslint-plugin-jsdoc`](https://www.npmjs.com/package/eslint-plugin-jsdoc)                         | `^63.0.12`                     | Enforces JSDoc on public exports (§8, rule 2)                                                                        |
| [`prettier`](https://www.npmjs.com/package/prettier)                                               | `^3.9.5`                       | Formatting, run via husky pre-commit (§8, rule 5)                                                                    |
| [`vitest`](https://www.npmjs.com/package/vitest)                                                   | `^4.1.10`                      | Test runner (§7)                                                                                                     |
| [`@vitest/coverage-istanbul`](https://www.npmjs.com/package/@vitest/coverage-istanbul)             | `^4.1.10`                      | Istanbul coverage provider (§7.1) — version tracks `vitest`'s own major                                              |
| [`@cloudflare/vitest-pool-workers`](https://www.npmjs.com/package/@cloudflare/vitest-pool-workers) | `^0.18.3`                      | Runs `test/workers` in real `workerd` (§7.2)                                                                         |
| [`@cloudflare/workers-types`](https://www.npmjs.com/package/@cloudflare/workers-types)             | `5.20260708.1` (exact, no `^`) | Ambient Workers runtime types for the codebase and tests — see note below                                            |
| [`wrangler`](https://www.npmjs.com/package/wrangler)                                               | `^4.109.0`                     | Needed to test `generate-wrangler-types` (§5.7) end-to-end, and used by `@cloudflare/vitest-pool-workers` internally |
| [`husky`](https://www.npmjs.com/package/husky)                                                     | `^9.1.7`                       | Git hooks (§8, rules 5–6)                                                                                            |
| [`npm-run-all2`](https://www.npmjs.com/package/npm-run-all2)                                       | `^9.0.2`                       | `run-s`/`run-p` for composed `npm run check` scripts (§8, rule 1)                                                    |
| [`tsup`](https://www.npmjs.com/package/tsup)                                                       | `^8.5.1`                       | Bundles `src/` into `dist/` (ESM-only, §3) immediately before publish                                                |
| [`@changesets/cli`](https://www.npmjs.com/package/@changesets/cli)                                 | `^2.31.0`                      | Versioning/changelog generation, wired into the release workflow (§3)                                                |
| [`@types/node`](https://www.npmjs.com/package/@types/node)                                         | `^26.1.1`                      | Types for the Node-only surfaces: `vite/*` (§5.6) and `cli/*` (§5.7)                                                 |
| [`@types/cross-spawn`](https://www.npmjs.com/package/@types/cross-spawn)                           | `^6.0.6`                       | Type declarations for the `cross-spawn` dependency above — `cross-spawn` itself ships no `.d.ts`                     |

`@cloudflare/vite-plugin` and `@hono/cloudflare-access` are **not** devDependencies of this repo —
see §5.6 and §5.5 respectively for why each is referenced without being installed here.

**On the `typescript` pin:** npm's `latest` dist-tag for `typescript` is currently `7.0.2`, but
this project pins `^6.0.3` deliberately, not by oversight, and stays there **for the foreseeable
future**. `typescript-eslint@8.63.0`'s own `peerDependencies` still cap out at
`typescript: '>=4.8.4 <6.1.0'` — it does not support TypeScript 7.x at all yet, and §8 rule 3
requires `typescript-eslint`'s type-aware configs; pinning to TS7 today would break linting
outright. `^6.0.3` is also genuinely "latest of the line that works" — there is no `6.1.0`+;
TypeScript went straight from `6.0.3` to `7.0.x`. Revisit only once `typescript-eslint` ships a
release whose peer range actually includes TypeScript 7 — that's the concrete, checkable signal to
watch for, not a calendar date.

**On the `@cloudflare/workers-types` pin:** pinned **exactly** (no `^`), unlike every other
devDependency in this table. Cloudflare republishes this package on a near-daily cadence (its
version embeds a date), so a `^` range would provide no real semver protection here — every
release is "compatible" in the normal sense — and would just pick up continuous, unrelated
type-shape churn. Bump it deliberately, in its own PR, when a new Workers runtime feature is
actually needed.

### 2.4 Documentation-site tooling

Not part of the published library's own dependency tree — this lives in its own, separate
`package.json` under `docs/` (§5.9) rather than the root one, because `vitepress@1.6.4` depends on
`vite@^5.4.14` internally, a completely different major version from this toolkit's own
`vite@^8.1.4` peer dependency (§2.1). Sharing one dependency tree would be a real version
collision, not a theoretical one.

| Package                                                                            | Version    | Purpose                                                                                      |
| ---------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| [`vitepress`](https://www.npmjs.com/package/vitepress)                             | `^1.6.4`   | Docs-site shell + guides (§6.1)                                                              |
| [`typedoc`](https://www.npmjs.com/package/typedoc)                                 | `^0.28.20` | Generates API reference from JSDoc (§6.1)                                                    |
| [`typedoc-plugin-markdown`](https://www.npmjs.com/package/typedoc-plugin-markdown) | `^4.12.0`  | Renders TypeDoc output as markdown VitePress can consume (requires `typedoc@0.28.x` exactly) |

## 3. Package Identity & Distribution

- **License: MIT.** A `LICENSE` file at the repo root, `"license": "MIT"` in `package.json`, and
  `LICENSE` included in the published `files` array. All four source repos are already MIT
  (`cloudflare-auth`, `cloudflare-logger`, `cloudflare-scripts`, and `hono-problem-details` —
  itself a fork of the MIT-licensed `paveg/hono-problem-details`), and the runtime dependencies
  added in §2.2 (`jose`, `commander`) are MIT too — nothing ported or vendored into this repo
  needs a relicensing or compatibility review.
- Distributed via CI/CD to the public npm registry on merge to `main`, using
  [`@changesets/cli`](https://www.npmjs.com/package/@changesets/cli) (§2.3) for
  versioning/changelog generation and **npm Trusted Publishing (OIDC)** with provenance
  (`id-token: write`, no long-lived `NPM_TOKEN` secret) — the same pattern already proven in
  `hono-problem-details`'s `release.yml`.
- The same release workflow also runs a `build-docs` step that builds and publishes the
  documentation site (§6.1) immediately after a successful npm publish — not on every push to
  `main`. This is deliberate: it guarantees the published docs (including the generated API
  reference) always match the version that's actually on npm, never a `main` HEAD that hasn't
  shipped yet.
- `dist/` is **not** committed to the repository. Unlike `cloudflare-auth`/`cloudflare-logger`
  (installed via `github:` refs, where a committed `dist/` is necessary because there's no build
  step at install time), this package is npm-native: CI builds `dist/` fresh via `prepack`/a
  dedicated build job (`tsup`, §2.3) immediately before every publish.
- Module format: **ESM-only** (`"type": "module"`, no CJS build). Every consumer of this toolkit
  is a Vite/Wrangler/Vitest project, all ESM-first, so there's no need to carry a dual ESM/CJS
  build forward — including for the vendored `hono-problem-details` code (§5.4), which ships dual
  ESM/CJS upstream but drops the CJS half in the port.
- Package manager: npm.
- Node/npm/TypeScript versions: per §2.

## 4. Non-Goals

- **Data Access Patterns** (repositories, RBAC, valibot-validated CRUDL, HATEOAS) — a distinct, larger future effort; not designed here.
- **WebSocket Durable Object patterns** — same reasoning; tracked as future work.
- **Full RFC 9110 conditional-request handling** (computing ETags from resource state, parsing `If-Match`/`If-None-Match`, cache-revalidation semantics, and the `notModified()`/`conflict()`/`preconditionFailed()` error generators that would pair with it) — this overlaps with Data Access Patterns above. Rather than ship a placeholder shape now and guess wrong, v1 ships no 304/409/412-specific generators at all (§5.3); the real design work happens once Data Access Patterns actually needs it, informed by what that work learns.
- **Reworking `cloudflare-scripts`'s other CLIs** (`generate-wrangler`, `empty-r2-bucket`, `destroy-containers`) or its Terraform skill — this toolkit is wrangler-only; only `generate-types` (§5.7) is relevant.
- **Modifying, deprecating, or archiving `cloudflare-auth`, `cloudflare-logger`, `cloudflare-scripts`, or `hono-problem-details`** — see §10. Source is read from those repos to port functionality into this one; nothing is written back to them.
- **Documenting a migration path** from the four source repos to this toolkit (e.g. an old-import → new-import mapping table, or a `docs/MIGRATION.md`). This is a **deliberate** omission, not an oversight — the toolkit ships fresh, and mapping any existing consumer's imports is left to whoever undertakes that migration later, using this spec and the source repos directly.
- **React support.** `cloudflare-logger/react` is not carried over.
- **Replacing Hono's own `HTTPException`.** The toolkit interoperates with it rather than replacing it.

## 5. Toolkit Contents

The toolkit consists of four parts:

1. TypeScript library methods for use in Workers-based apps.
2. Vite plugins for running Workers-based apps locally.
3. Scripts for maintaining Workers-based apps.
4. AI Skills to assist LLMs to code Workers-based apps effectively.

### 5.1 Subpath & Export Summary

| Subpath                                          | Exports                                                                                                                                                   | Notes                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@adrianhall/cloudflare-toolkit` (root)          | Re-exports of `guards`, `errors`, `problem-details`, `logging`                                                                                            | Framework-agnostic — safe to import from any runtime (Worker, Node, browser). Does **not** re-export anything from `hono`, `vite`, or `testing`, since those pull in a `hono`/`vite`/Node-only runtime dependency                                                    |
| `@adrianhall/cloudflare-toolkit/guards`          | `throwIfNull`, `valueOrDefault`, `sqlCount`                                                                                                               | No `hono` dependency. Depends only on `errors` (for `NullError`/`InvalidShapeError`) — never the reverse                                                                                                                                                             |
| `@adrianhall/cloudflare-toolkit/errors`          | HTTP error generators (§5.3), `NullError`, `InvalidShapeError`                                                                                            | Depends only on `problem-details`                                                                                                                                                                                                                                    |
| `@adrianhall/cloudflare-toolkit/problem-details` | `ProblemDetailsError`, `problemDetails()`, `statusToPhrase`, `statusToSlug`, `createProblemTypeRegistry`, `ProblemDetails`/`ProblemDetailsInput` types    | Hono-free by design — see §5.4                                                                                                                                                                                                                                       |
| `@adrianhall/cloudflare-toolkit/hono`            | `cloudflareAccess`, `cloudflareLogger`, `problemDetailsErrorHandler`, `notFoundHandler`, `AuthVariables`, `LoggerVariables`, `CloudflareToolkitVariables` | Requires `hono` as a peer dependency — see §5.5. `problemDetailsErrorHandler` is a **direct re-export** of the vendored handler (§5.4), not a toolkit-authored wrapper. No combined/coordinator middleware is exported — all four middleware are wired independently |
| `@adrianhall/cloudflare-toolkit/vite`            | `cloudflareAccessPlugin`                                                                                                                                  | Requires `vite` as a peer dependency. Node-only; never imported from Worker code — see §5.6                                                                                                                                                                          |
| `@adrianhall/cloudflare-toolkit/logging`         | `createLogger`, `resolveLoggerConfig`, transports, logging types                                                                                          | The framework-agnostic logger core that `cloudflareLogger` (hono subpath) wraps                                                                                                                                                                                      |
| `@adrianhall/cloudflare-toolkit/testing`         | Dev-JWT signing + cookie helpers for Vitest/Playwright tests                                                                                              | For writing tests against `cloudflareAccess`-protected routes without a real Cloudflare Access deployment                                                                                                                                                            |

Separately, the package ships a `generate-wrangler-types` **CLI** (`bin`, not an import subpath) —
see §5.7.

### 5.2 Defensive Guards

We want all Cloudflare demo applications to be fully tested. Sometimes, there are defensive guards in our code (including the library code) that is not easily testable. Adding testable defensive guards ensure we can maintain a 100% code coverage.

Three defensive guards are envisioned:

- `sqlCount(row: unknown, countProperty: string = 'count'): number`

  For the `SELECT COUNT(*) AS count FROM t` → `.first<{count:number}>()` D1 pattern. Validates that `value` is a non-null object with a numeric `countProperty`; throws `NullError` (via `throwIfNull`) if `row` itself is `null`/`undefined`, or `InvalidShapeError` if `row` is non-null but does not have the expected shape (not an object, or `countProperty` missing/non-numeric) — since the whole point is "this should never happen — if it does, that's a bug, not a 0".

- `throwIfNull<T>(value: T, message: string): asserts value is NonNullable<T>`

  Throws `NullError` if `value` is `null`/`undefined`; a TS assertion function so callers get narrowing for free.

- `valueOrDefault<T>(value: T | null | undefined, defaultValue: T): T`

  Literally `value ?? defaultValue`. Exists purely so lint rules can flag _ad hoc_ `??` fallbacks used defensively while allowing this one blessed, individually-tested helper.

These guards are located in `src/lib/guards`, so they can be imported using the following lines:

```ts
import { sqlCount, throwIfNull, valueOrDefault } from "@adrianhall/cloudflare-toollkit/guards";
```

The `NullError` and `InvalidShapeError` mentioned above are both specialized versions of the error returned by `internalServerError()` shown in the next section — `NullError` for an unexpectedly `null`/`undefined` value, `InvalidShapeError` for a non-null value that doesn't have the shape it was expected to have. This allows us to avoid catching either as they are logged and returned as an RFC 9457 problem details error using standard Hono error handling.

### 5.3 HTTP Errors

Cloudflare Workers apps are constructed with REST-like APIs. We want to be able to handle the happy-path (that leads to a success status code) while throwing errors for any unhappy-paths. We also want to support RFC 9457 problem detail responses. We have middleware (see below) that handles `ProblemDetailsError` objects and turns them into RFC 9457 problem detail responses. However, we need easy methods to construct problem detail errors.

Each status code in the [HTTP Status Code 300-599](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status) will have a method that can be used to generate an appropriate error:

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

`429 Too Many Requests` is deliberately **not** included — rate limiting is a Cloudflare Workers platform concern, not this toolkit's.

`304 Not Modified`, `409 Conflict`, and `412 Precondition Failed` are also deliberately **not** included in v1 — these are RFC 9110 conditional-request status codes whose useful shape (a 304 with no body, a 409/412 optionally carrying the conflicting resource and its ETag) is a Data Access Patterns concern (§4), not a generic error-generator concern. Rather than guess at that shape now, v1 ships nothing for these three; the future Data Access Patterns work will introduce them once it's clear what they actually need to carry.

`contentTooLarge` (413) was added after v1 to support capping request-body reads outside a Hono
context — specifically the Vite dev-login plugin's `readFormBody` (§5.6), which previously
buffered its `application/x-www-form-urlencoded` POST body with no size limit
([CODE-008](https://github.com/adrianhall/cloudflare-toolkit/issues/59)). It follows the exact
same generator shape as every other entry in this table.

Every generator uniformly has the signature: `(input?: Omit<ProblemDetailsInput, "status">) => ProblemDetailsError`. Each generator sets `status`/`title` and forwards `detail`/`type`/`instance`/`extensions` untouched. These are **not** framework-specific — throwing one inside a plain function, a Durable Object method, or a Hono handler all work identically; only the Hono `onError` hook (`problemDetailsErrorHandler`, §5.5) is what turns the throw into an HTTP response. Because every generator now produces a plain `ProblemDetailsError`, the vendored `problemDetailsErrorHandler` (§5.4) handles all of them without any toolkit-specific wrapper logic — see §5.5.

Error generators live in `src/lib/errors` and can be imported like this:

```ts
import { forbidden, unprocessableContent } from "@adrianhall/cloudflare-toolkit/errors";
```

### 5.4 Hono Problem Details

Contains a **vendored port** of [`adrianhall/hono-problem-details`](https://github.com/adrianhall/hono-problem-details)'s RFC 9457 core primitives — itself a fork of the third-party, MIT-licensed [`paveg/hono-problem-details`](https://github.com/paveg/hono-problem-details). It's vendored rather than depended upon because `adrianhall/hono-problem-details` is **not published to npm**, so it cannot be a resolvable `dependency` (or `peerDependency`) of a package that _is_ published: `npm install @adrianhall/cloudflare-toolkit` would fail to resolve a transitive dependency that doesn't exist on the registry.

This subpath is **Hono-free by design**, matching the toolkit's broader rule that anything safe to import from any runtime (Worker, Node, browser) must never pull in `hono` (or `vite`) as a runtime dependency. It exports: `ProblemDetailsError`, `problemDetails()`, `statusToPhrase`, `statusToSlug`, `createProblemTypeRegistry`, and the `ProblemDetails`/`ProblemDetailsInput` types.

The actual Hono-wired handler, `problemDetailsErrorHandler` (§5.5), is re-exported **directly** from `@adrianhall/cloudflare-toolkit/hono` instead of living here, since it needs Hono's `Context`/`ErrorHandler` types and this subpath must not import `hono`. It's a direct re-export, not a toolkit-authored wrapper — see §5.5 for why no wrapper is needed.

Where, in the past, developers would import these types from `@adrianhall/hono-problem-details`, they would now import from `@adrianhall/cloudflare-toolkit/problem-details`.

Porting notes:

- **License attribution is required.** Both the upstream project and its fork are MIT (§3), so there's no legal blocker to vendoring, but the copyright/license notice must still travel with the code (e.g. a `THIRD-PARTY-NOTICES.md`, or a header comment on the vendored files crediting `paveg`/`hono-problem-details`) — vendored code must not read as if it originated in this repo.
- **Only the core primitives listed above are vendored.** The `zod`/`valibot`/`openapi`/`standard-schema`/`opentelemetry` integrations from `hono-problem-details` are explicitly **not** ported in v1 — an additive change for later if a consumer needs one, not a blocker now.
- **Preserve the sourcemap fix.** `hono-problem-details` exists specifically because upstream `paveg/hono-problem-details` was missing sourcemap support; verify the vendored build config keeps `sourcemap: true`.
- Vendoring has no bearing on the standalone `adrianhall/hono-problem-details` repo — see §10.

### 5.5 Hono Middleware

There are four pieces of middleware exported from this subpath. Two are dealing with standard
error handling, and two deal with Cloudflare specifics. There is deliberately **no** combined/
coordinator middleware wrapping any of these — each is wired independently by the consumer:

- `problemDetailsErrorHandler` handles all the errors that the code throws from the [HTTP Errors](#53-http-errors) section (and any thrown `HTTPException`), returning them to the user as an RFC 9457 problem-details response with the right HTTP status code. This is the vendored handler itself (§5.4), **re-exported directly** from this subpath — no toolkit-authored wrapper is needed, because §5.3's generators all produce a plain `ProblemDetailsError` uniformly, and the vendored handler already knows how to turn any `ProblemDetailsError` into a response. (An earlier draft of this spec had a toolkit-specific `errorHandler` wrapper here, needed only to special-case the now-removed `notModified()`/`conflict()`/`preconditionFailed()` generators — with those gone, the wrapper served no purpose and has been dropped.)
- `notFoundHandler` returns a 404 Not Found with a problem details block. This mimics what happens when `notFound()` is thrown. Unlike `problemDetailsErrorHandler`, this one _is_ toolkit-authored — there's no equivalent primitive in the vendored `hono-problem-details` code, since `app.notFound()` is a separate Hono hook from `app.onError()`.
- `cloudflareLogger` injects a structured logger into the pipeline (backed by `@adrianhall/cloudflare-toolkit/logging`'s core logger, §5.1) that other middleware and APIs can use.
- `cloudflareAccess` handles Cloudflare Access in the same way as the `cloudflare-auth` implementation of this functionality — path-based policies, a fail-closed local-dev token bypass, cookie- _and_ header-based JWT extraction, and a pluggable logger. This is kept as a bespoke implementation rather than switched to the community [`@hono/cloudflare-access`](https://www.npmjs.com/package/@hono/cloudflare-access) package, which lacks all four of those. JWT signing/verification is provided by [`jose`](https://www.npmjs.com/package/jose) (§2.2). Its `401` responses are RFC 9457 `application/problem+json`, built directly via the shared `problem-details` helpers (not by throwing), so they match `problemDetailsErrorHandler`/`notFoundHandler`'s shape even when a consumer hasn't wired `app.onError(problemDetailsErrorHandler())`.

A developer wires all four independently:

```ts
import {
  cloudflareAccess,
  cloudflareLogger,
  problemDetailsErrorHandler,
  notFoundHandler
} from "@adrianhall/cloudflare-toolkit/hono";

const app = new Hono<AppContext>();

app.use(cloudflareLogger({/* ... */}));
app.use(cloudflareAccess({/* ... */}));

app.onError(problemDetailsErrorHandler());
app.notFound(notFoundHandler());
```

#### Hono Bindings Helpers

`cloudflareAccess` sets `AuthVariables` (`userEmail`, `userSub`) and `cloudflareLogger` sets
`LoggerVariables` (`LOGGER`) on the Hono context. These stay two separate, independently
composable types — matching the exact names already used by `cloudflare-auth`/`cloudflare-logger`
today — rather than one merged type, because either middleware may or may not be used at all in a
given app; a single unconditional type would claim a variable is always set when it might not be.

```ts
interface AppVariables extends AuthVariables, LoggerVariables {
  // Custom variables go here
}

type AppContext = { Bindings: Env; Variables: AppVariables };
```

`Env` is the wrangler-generated global binding type (produced by `generate-wrangler-types`, §5.7)
— the standard Hono `Bindings` generic argument, not a toolkit-specific type.

For the common case of using both together, `CloudflareToolkitVariables` is provided as a
convenience alias equal to `AuthVariables & LoggerVariables`:

```ts
interface AppVariables extends CloudflareToolkitVariables {
  // Custom variables go here
}
```

### 5.6 Vite Plugins

There is already a very functional [`@cloudflare/vite-plugin`](https://www.npmjs.com/package/@cloudflare/vite-plugin) plugin for vite that allows the user to run their Worker on Miniflare. However, it doesn't support Cloudflare Access. The `cloudflare-auth` repo has a vite plugin, used like this:

```ts
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareAccessPlugin } from "@adrianhall/cloudflare-toolkit/vite";
import { authPolicies } from "./src/auth-policies";

export default defineConfig({
  plugins: [
    cloudflareAccessPlugin({ policies: authPolicies }),
    cloudflare()
    /* ... other plugins */
  ]
});
```

`@cloudflare/vite-plugin` is referenced above only as something a _consuming_ project also has
installed alongside `cloudflareAccessPlugin` — it is **not** a dependency of this toolkit's own
repo (§2.3). `cloudflareAccessPlugin`'s own tests (§7.2) mock the underlying Vite connect-middleware
layer directly, the same technique `cloudflare-auth` already uses, rather than requiring a live
`@cloudflare/vite-plugin` instance.

`cloudflareAccessPlugin` supersedes `cloudflare-auth`'s standalone `developerAuthentication` Hono
middleware, which is **not** carried into this toolkit — local-dev authentication is now handled
entirely at the Vite dev-server layer instead of inside the Worker. Concretely, when porting
`cloudflare-auth`'s source: `developer-authentication.ts` and its `login-page.ts` renderer are
dropped; `vite-login-page.ts` (the dev login form rendered by the Vite plugin itself) is kept,
moved under this subpath, since `cloudflareAccessPlugin` still needs it.

### 5.7 NPM Scripts

Most of the scripts within `cloudflare-scripts` are relevant only in Terraform deployments. This toolkit is explicitly for wrangler-only deployments. The only script that is relevant is the `generate-types` script, which generates the `worker-configuration.d.ts` file only when the `wrangler.jsonc` file changes.

This script will be ported from `cloudflare-scripts/src/cli/generate-types/*` with only the bin name changed (`generate-types` → `generate-wrangler-types`) and the CLI's internal `--help`/`--version` banner text updated to match. Behavior, flags (`-c/--config`, `-d/--dir`, `-f/--force`, `-o/--output`, `-q/--quiet`, `-v/--verbose`, `--` passthrough to `wrangler types`), and exit codes are unchanged — this is a rename, not a rewrite. Its runtime dependencies are [`commander`](https://www.npmjs.com/package/commander) (§2.2) for argument parsing and [`chalk`](https://www.npmjs.com/package/chalk) (§2.2) for colorized stderr log output, both carried over from `cloudflare-scripts`; testing it end-to-end needs [`wrangler`](https://www.npmjs.com/package/wrangler) (§2.3) as a devDependency, since the whole script wraps `wrangler types`. Wired into a consuming project:

```jsonc
// package.json
{
  "scripts": {
    "prebuild": "generate-wrangler-types",
    "build": "vite build"
    /* ... */
  }
}
```

Scripts will be stored in `src/cli/generate-wrangler-types`.

### 5.8 AI Skills

Installable via `npx skills add adrianhall/cloudflare-toolkit`. Must:

- Document every export above with a short "when to use" and a copy-pasteable example, in the same
  style as `cloudflare-logger`'s existing `SKILL.md` (front-matter `name`/`description`, then
  "When to use this package," "Installation," "Import rules," per-feature sections).
- Explicitly reference (not duplicate) the sibling skills a consumer likely already has installed:
  `cloudflare`, `wrangler`, `workers-best-practices`, `durable-objects` — telling the agent to
  consult those for platform-level concerns and this skill only for toolkit-specific API surface.
- Include a dedicated section on Vite + Vitest configuration for a Hono/Workers project — this is
  a common problem that most Hono-based Wrangler apps get wrong. This section must link to the
  Cloudflare docs pages for Vite and Vitest integration already gathered in §10 (Cloudflare Plugin
  for Vite, Cloudflare Vitest Information, Reference Samples) and should show a working
  `vite.config.ts`/`vitest.config.ts` pair for: (a) a Worker using `@cloudflare/vite-plugin` +
  `cloudflareAccessPlugin`, and (b) a Vitest suite using `@cloudflare/vitest-pool-workers` against
  that same Worker.

AI Skill will be stored in `skills/cloudflare-toolkit/SKILL.md`.

### 5.9 Repository Structure (hint, not a mandate)

A starting point for the implementation plan, not a locked-in directory layout:

```text
src/
  index.ts                    # root barrel: guards + errors + problem-details + logging only
  lib/
    guards/
      index.ts
      guards.ts                # throwIfNull, valueOrDefault, sqlCount
    errors/
      index.ts
      generators.ts            # badRequest, forbidden, notFound, ...
      null-error.ts
    problem-details/
      index.ts                 # barrel
      error.ts factory.ts status.ts registry.ts types.ts utils.ts
      # vendored/ported from adrianhall/hono-problem-details (§5.4) — not a dependency.
      # Retain upstream MIT license attribution.
    logging/
      index.ts                 # createLogger, resolveLoggerConfig, transports, types
    hono/
      index.ts
      cloudflare-access.ts      # cloudflareAccess
      logger-middleware.ts      # cloudflareLogger
      error-handler.ts          # problemDetailsErrorHandler (direct re-export from problem-details)
      not-found-handler.ts      # notFoundHandler
      types.ts                  # AuthVariables, LoggerVariables, CloudflareToolkitVariables
    vite/
      index.ts
      plugin.ts                 # cloudflareAccessPlugin
      login-page.ts             # dev login form, ported from cloudflare-auth's vite-login-page.ts
    auth-internal/
      jwt.ts jwks.ts policy.ts  # shared by hono/cloudflare-access.ts AND vite/plugin.ts —
                                 # must stay both Worker-safe (for hono/) and Node-safe (for vite/)
    testing/
      index.ts                  # dev-JWT signing + cookie helpers
  cli/
    generate-wrangler-types/
      index.ts run.ts types.ts fs.ts wrangler.ts __tests__/
test/
  node/       # errors, guards, problem-details, logging, vite plugin (mock req/res), CLI
  workers/    # workerd via @cloudflare/vitest-pool-workers: hono/* middleware
  package/    # built dist/ import/export surface smoke test
skills/
  cloudflare-toolkit/SKILL.md
docs/                            # separate package.json — VitePress + TypeDoc site (§2.4, §6.1)
AGENTS.md
```

The `auth-internal` module (JWT/JWKS/policy matching, currently duplicated across
`cloudflare-access.ts` and `vite.ts` in `cloudflare-auth`) should be lifted into one shared
internal module imported by both `hono/cloudflare-access.ts` and `vite/plugin.ts`, rather than
living under either subpath. It must never use Node-only APIs — even though one of its two
consumers (`vite/plugin.ts`) is Node-only, the other (`hono/cloudflare-access.ts`) runs in
`workerd`. This is also why §9 (Security Considerations) treats it as a single audited unit: a fix
applied to one call site and missed in the other is the main risk of sharing code across two
runtime-constrained subpaths at all.

## 6. Documentation

Documentation has three distinct artifacts, each with a different audience. All three need to
exist — one of them (README/CHANGELOG maintenance) was missing from earlier drafts of this spec.

### 6.1 Documentation Site

The primary destination for developers is a dedicated, generated `github.io` site
(`adrianhall.github.io/cloudflare-toolkit`), living in its own `docs/` subfolder with its own
`package.json` (§2.4, §5.9). It is built and published by the `build-docs` CI step (§3) as part
of the release workflow — triggered by a successful npm publish, **not** on every push to `main`
— so the published docs (including the generated API reference) always match the version that's
actually on npm. It needs to be comprehensive enough that a developer never has to go spelunking
through source or this spec to figure out how to use the toolkit:

- **Getting Started** — install (`npm install`, `npx skills add`), a minimal end-to-end Hono +
  Vite + Workers example wiring everything together.
- **Guides**, one per functional area, each expanding on the corresponding §5 subsection with
  fuller worked examples than fit in this spec:
  - Authentication (`cloudflareAccess` + `cloudflareAccessPlugin` — path policies, the local-dev
    token bypass, and why it's fail-closed by default)
  - Logging (`cloudflareLogger` + the underlying `/logging` core, transports)
  - Error Handling (the HTTP error generators, `problemDetailsErrorHandler`, `notFoundHandler`,
    and how RFC 9457 problem details show up in a response)
  - Defensive Guards (why `throwIfNull`/`valueOrDefault`/`sqlCount` exist, tied to the
    100%-coverage philosophy in §7/§8)
  - The `generate-wrangler-types` CLI
  - Testing a toolkit-based app (`/testing` helpers, `@cloudflare/vitest-pool-workers` recipes)
  - Vite + Vitest configuration for a Hono/Workers project (this content is shared with, not
    duplicated from, the AI skill in §5.8 — one should link to the other, not fork it)
- **API Reference** — generated directly from the same JSDoc comments that §8 rule 2 already
  requires on every public export, so it's always in sync with the code and costs nothing extra to
  maintain, via [`typedoc`](https://www.npmjs.com/package/typedoc) and
  [`typedoc-plugin-markdown`](https://www.npmjs.com/package/typedoc-plugin-markdown) (§2.4), since
  the latter can render straight into the docs-site framework below rather than as a separate,
  disconnected static site.
- **Changelog** — links out to `CHANGELOG.md` (§6.2) / GitHub Releases rather than duplicating it.

Technology is **locked**: [`vitepress`](https://www.npmjs.com/package/vitepress) (§2.4) for the
site shell and the hand-written guides/getting-started content, with
[`typedoc`](https://www.npmjs.com/package/typedoc)/`typedoc-plugin-markdown`'s output folded in
as the API Reference section.

Per §4 (Non-Goals), the docs site does **not** include a migration guide from the four source
repos — that's deliberately out of scope.

### 6.2 README.md and CHANGELOG.md

These are repo-root artifacts, not part of the docs site, and were missing from earlier drafts of
this spec:

- **`README.md`** is the GitHub/npm landing page — kept intentionally short (elevator pitch, install
  command, a minimal quickstart snippet showing how the four middleware from §5.5 are wired, the
  `npx skills add` command, the MIT license, §3) with a prominent link to the documentation
  site (§6.1) for everything else. It is explicitly **not** the place for exhaustive API reference
  or guide-length content — that duplication is exactly what the docs site exists to avoid.
- **`CHANGELOG.md`** is auto-generated by Changesets on every release (§3) — one entry per published
  version, sourced from the changeset files merged in each contributing PR. This falls out of the
  CI/CD pipeline already specified in §3 with no extra authoring effort; it just needs to actually
  be enabled and kept in the release flow, which earlier drafts of this spec didn't call out
  explicitly.

### 6.3 AGENTS.md

The toolkit's own repo needs an `AGENTS.md` (distinct from the installable skill, which teaches _consumers_; this teaches _contributors to the toolkit itself_) with one non-negotiable rule: **always consult live documentation via MCP** for Cloudflare, Hono, Vite, and Vitest before writing or reviewing code that touches those surfaces — explicitly calling out that Vite and Vitest each have Cloudflare-specific documentation pages that differ from their generic docs and **must** be consulted whenever this repo's code interacts with either. This should follow the structure already used in `cloudflare-logger/AGENTS.md` (quality gates, coverage recipe, project structure map, architectural rules) rather than inventing a new template.

## 7. Testing Plan

### 7.1 Framework and thresholds

- Vitest, multi-project (`test/*/vitest.config.ts` referenced from a root `vitest.config.ts` via
  `projects: [...]`), exactly mirroring `cloudflare-logger`'s existing setup.
- Coverage provider: **Istanbul**, not V8 — required because part of the surface (`hono/*` under
  `workerd`) runs in a runtime where the V8 coverage profiler isn't available, and Istanbul
  instruments uniformly at transpile time across every target runtime.
- Global thresholds: 100% statements/branches/functions/lines, enforced in `vitest.config.ts`
  (`coverage.thresholds`), not merely reported. A drop below 100% must fail CI, not just print a
  warning.
- Coverage `exclude`: `src/**/*.d.ts`, `src/**/index.ts` (barrels), and the CLI's `index.ts`
  shebang entry (mirrors `cloudflare-scripts`'s exclude comment convention — the shebang file is a
  1-line re-export of `run()`, and `run()` itself is fully covered).

### 7.2 Test projects (proposed, adjustable in the implementation plan)

| Project        | Runtime                                                                                                          | Covers                                                                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/node`    | Plain Node                                                                                                       | `errors/*`, `guards/*`, `problem-details/*`, `logging/*`, `vite/*` (mock `IncomingMessage`/`ServerResponse` objects, same technique `cloudflare-auth` already uses), `cli/generate-wrangler-types/*` (injected `WranglerRunner`/`FileSystem` fakes, same technique `cloudflare-scripts` already uses) |
| `test/workers` | `workerd` via [`@cloudflare/vitest-pool-workers`](https://www.npmjs.com/package/@cloudflare/vitest-pool-workers) | `hono/*` (`cloudflareAccess`, `cloudflareLogger`, `problemDetailsErrorHandler`, `notFoundHandler`) — exercises real WebCrypto/JWKS-fetch/`c.env` semantics rather than a Node polyfill of them                                                                                                        |
| `test/package` | Plain Node                                                                                                       | Imports the **built** `dist/` (not `src/`) for every subpath in §5.1 and asserts the expected named exports exist with the expected runtime type (`typeof x === "function"`, etc.) — catches `package.json#exports`/`tsup` entry-point misconfiguration before publish                                |

A `browser` project (present in `cloudflare-logger` for its `/react` subpath) is **not** included,
since nothing in this package's scope runs in a browser. If a future subpath changes that, add the
project then.

### 7.3 Coverage-gap decision procedure (copied from `cloudflare-logger/AGENTS.md`, binding here too)

When a line/branch is not covered:

1. **Write a test.** Default, strongly preferred outcome — this is true for the overwhelming
   majority of gaps in this kind of code (pure functions, thin middleware).
2. **Extract a small testable helper** if the gap is buried inside a larger function and awkward to
   reach from the public surface — export it from the _module_, not the _barrel_, and unit-test it
   directly (`cloudflare-logger`'s `replaceNonJsonValue()` pattern).
3. **`/* istanbul ignore next -- @preserve */` — last resort**, requires: (a) a same-line/preceding
   comment stating _why_ the branch is genuinely unreachable in any test runtime, and (b) explicit
   maintainer approval before merge, per this toolkit's own repository rules (§8). Target: **zero**
   ignore annotations at initial release, same starting bar `cloudflare-logger` holds today.

### 7.4 Specific test-worthy risk areas (not exhaustive, flagged because they're easy to get wrong)

- `problemDetailsErrorHandler`/`notFoundHandler` interaction: a request that 404s must **not**
  double-wrap through both `notFoundHandler` and `problemDetailsErrorHandler`; verify the exact
  RFC 9457 shape produced by each path independently and that they agree on `type`/`title`
  conventions (`typePrefix`, `autoInstance`). Both are wired directly by the consumer (§5.5) — via
  `app.onError()`/`app.notFound()` on a bare `Hono` instance — so this test exercises them exactly
  as a real app would.
- `cloudflareAccess`'s `enableDevTokens` fail-closed default: a test asserting that, absent
  `enableDevTokens: true`, an HS256 token signed with `DEFAULT_DEV_SECRET` is **rejected** in a
  simulated production-like context (no `CLOUDFLARE_TEAM_DOMAIN` shortcuts) — this is a security
  invariant, not just a feature test.
- `sqlCount`/`throwIfNull` against the actual shapes D1's `.first()` returns (`null` for no rows,
  `undefined` is not a real D1 return value but must still be guarded since the function's input
  type is `unknown`).
- CLI: the freshness-check skip path is easy to accidentally break (`cloudflare-scripts`'s own
  `run.test.ts` already exercises this — port those cases, don't rewrite them from scratch).

### 7.5 CI gate

`npm run check` (format check, `check:types`, `check:lint`, `check:pack` — a dry-run
`npm pack --ignore-scripts` matching `cloudflare-logger`'s `check:pack`) **and**
`npm run test:coverage` must both pass on every PR before merge; the `ci-pass` synthetic job
pattern from `hono-problem-details`'s `ci.yml` (a job that fails if any dependency job
failed/cancelled, used as the single required status check) is recommended so branch protection
only needs one required check.

## 8. Non-Functional Requirements

These are the toolkit's own repository rules, resolving ambiguity where the existing sibling repos
disagree with each other on a given point.

| #   | Rule                                                                                | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `npm run check` runs type-checking + static analysis                                | `run-s check:types check:lint ...` pattern already used by all four repos. `check:types` = `tsc --noEmit` (or `tsc -b` for the multi-tsconfig layout); `check:lint` = `eslint .`                                                                                                                                                                                                                                                                                    |
| 2   | Full JSDoc on all public code, enforced by eslint                                   | Add `eslint-plugin-jsdoc` (§2.3). "Public" = anything exported from a barrel (`index.ts`) under any subpath. Enable `jsdoc/require-jsdoc` scoped to exported `function`/`class`/`interface`/`type` declarations, plus `jsdoc/require-description`, `jsdoc/check-param-names`. None of the four source repos currently run `eslint-plugin-jsdoc` — their JSDoc discipline today is manual convention only — so this is a **net-new lint gate**, not a lift-and-shift |
| 3   | ESLint: `recommendedTypeChecked` + `stylisticTypeChecked` + no deprecated APIs      | All four repos currently use only `tseslint.configs.recommended` (non-type-checked). This is a deliberate tightening for the new package. Requires `parserOptions: { projectService: true }` (or an explicit `project` array covering every `tsconfig*.json`) so type-aware rules can run. Add `@typescript-eslint/no-deprecated` explicitly (it's a "strict" rule, not part of `recommendedTypeChecked`)                                                           |
| 4   | TypeScript version                                                                  | Pin `typescript@^6.0.3` (§2.3), matching all four existing sibling repos exactly, for the foreseeable future. TypeScript 7.0 adoption is deferred until `typescript-eslint` supports it — see §2.3 for the concrete evidence behind this                                                                                                                                                                                                                            |
| 5   | Husky auto-formats on commit                                                        | Pre-commit hook runs Prettier against staged files only and re-stages (`cloudflare-logger`'s pattern), not a full `npm run check`                                                                                                                                                                                                                                                                                                                                   |
| 6   | Husky blocks commits that fail `tsc`/`eslint`                                       | This is `cloudflare-auth`'s pattern (`npm run check && npm run build && git add dist` in `pre-commit`), tightened here to run only `check:types` + `check:lint` at commit time (not the full test suite, to keep commits fast) — full `npm run check` including tests is the CI merge gate. Since `dist/` is not committed at all (§3), the hook does **not** run a build or `git add dist`                                                                         |
| 7   | Vitest, 100% coverage target, Istanbul provider                                     | Mirrors `cloudflare-logger/vitest.config.ts` exactly: multi-project setup, `coverage.provider: "istanbul"`, `thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 }`, `exclude: ["src/**/*.d.ts", "src/**/index.ts"]` (barrels aren't measured)                                                                                                                                                                                                 |
| 8   | Functional testing focus; use guards for unreachable branches                       | This is the entire reason `guards` (§5.2) exists as public/importable, not just internal-only like `cloudflare-logger`'s private `defensive-guards.ts`. The toolkit's own source should eat its own dog food: use `throwIfNull`/`valueOrDefault` internally wherever the existing repos currently have an inline defensive `??`/`if (!x) throw`                                                                                                                     |
| 9   | Trivially-testable branches must be tested                                          | No blanket ignores for "it's just a defensive check" — see §7 (Testing Plan) for the exact decision procedure, copied from `cloudflare-logger/AGENTS.md`'s "How to reach 100% coverage" section, which already codifies this                                                                                                                                                                                                                                        |
| 10  | Untestable code requires approval + a justified `istanbul ignore next -- @preserve` | Same wording/mechanics as `cloudflare-logger/AGENTS.md`. "Approval" in this repo's workflow = a maintainer sign-off comment on the PR before the ignore annotation is merged, not a self-granted exception                                                                                                                                                                                                                                                          |

## 9. Security Considerations

- `cloudflareAccess`'s `enableDevTokens` fail-closed default must be preserved exactly (tested in
  §7.4) — this is the single highest-consequence security property in the merged codebase; a
  regression here means a deployed Worker trusts a forgeable HS256 token.
- `cloudflareAccess`'s `audience` option is opt-in, not fail-closed: omitting it skips `aud`
  validation entirely and allows cross-application Access token replay within the same team
  (every app in a team shares the same JWKS). Rather than making `audience` required (a breaking
  change), `cloudflareAccess` logs a one-time warning at construction time whenever `audience` is
  omitted **and** `enableDevTokens` is not `true` — i.e. in the default, production-shaped
  configuration — and stays silent when `enableDevTokens` signals a local-development posture.
  This warning must be preserved (SEC-001).
- `includeStack` on `problemDetailsErrorHandler` must default to `false`. Since `problemDetailsErrorHandler`
  is now a **direct re-export** of the vendored handler (§5.4/§5.5) with no toolkit-authored wrapper
  at all, there is no code path that could silently flip this default — the only place it changes
  is the option the consumer explicitly passes to the vendored handler itself.
- CI publishing uses OIDC Trusted Publishing + provenance (§3) specifically to avoid a long-lived
  `NPM_TOKEN` secret sitting in repository/organization settings.
- The JWT/JWKS/policy internals shared between `cloudflareAccess` (§5.5) and
  `cloudflareAccessPlugin` (§5.6) — the `auth-internal` module, §5.9 — must be treated as a single
  audited unit even though they're consumed from two different subpaths — a security fix applied
  to one call site and missed in the other is the main risk of splitting them across `hono/` and
  `vite/` at all.

## 10. Reference Material

Source for each of the repositories to be replaced is in [repos/adrianhall](../..):

- [`adrianhall/cloudflare-auth`](https://github.com/adrianhall/cloudflare-auth)
- [`adrianhall/cloudflare-logger`](https://github.com/adrianhall/cloudflare-logger)
- [`adrianhall/cloudflare-scripts`](https://github.com/adrianhall/cloudflare-scripts)
- [`adrianhall/hono-problem-details`](https://github.com/adrianhall/hono-problem-details) (fork of [`paveg/hono-problem-details`](https://github.com/paveg/hono-problem-details))

These repositories will **NOT** be touched as part of this work (see also §4). Source material will be copied from the source repositories when building cloudflare-toolkit. All four are already MIT-licensed (§3), so nothing ported or vendored from them needs a license/compatibility review.

- [Cloudflare Plugin for Vite](https://developers.cloudflare.com/workers/vite-plugin/)
- [Cloudflare Vitest Information](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Reference Samples](https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/)

## 11. Open Questions

**None remaining.** All five items raised in this pass have been resolved; the table below is a
record of what was asked and where the resolution now lives, in case the reasoning is useful
later.

| #   | Question                                     | Resolution                                                                                                                                                                                                               | Where it lives now |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| 1   | TypeScript 6 vs. 7 — when to revisit?        | Stay on TypeScript 6 for the foreseeable future; revisit only once `typescript-eslint` ships a release supporting TypeScript 7 in its peer range                                                                         | §2.3               |
| 2   | Documentation-site technology                | Locked: VitePress + TypeDoc/`typedoc-plugin-markdown`                                                                                                                                                                    | §6.1               |
| 3   | Documentation-site location & deploy cadence | `docs/` subfolder, own `package.json`; built and published by the `build-docs` CI step as part of the release workflow (triggered by a successful npm publish), so the published docs always match the published release | §3, §6.1           |
| 4   | `@cloudflare/workers-types` pinning strategy | Pin exactly (no `^`); bump deliberately                                                                                                                                                                                  | §2.3               |
| 5   | `@types/node` scope                          | No action needed — confirmed                                                                                                                                                                                             | §2.3               |

## 12. Known and Accepted Issues

Findings surfaced by architecture or code review that were evaluated and explicitly **not**
fixed, because remediation would introduce more risk or complexity than the finding itself. This
section is a living record, distinct from §11 (Open Questions) above, which tracks now-resolved
questions from spec authoring — entries here remain permanently "open" in the sense that a future
architecture review should re-evaluate them, not treat them as settled forever. Each entry should
capture: the originating finding ID and issue link, the affected file(s)/line(s), a concise
statement of the issue, and the explicit reasoning for accepting it as-is.

### 12.1 ARCH-002: Duplicate `safeStringify` implementations (problem-details vs. logging)

**Source:** [Issue #61](https://github.com/adrianhall/cloudflare-toolkit/issues/61), severity low,
`Architecture` label.

**Files:**

- `src/lib/problem-details/utils.ts:92` —
  `safeStringify(body: unknown): { json: string; fallback: boolean }`
- `src/lib/logging/internal/safe-json.ts:63` — `safeStringify(value: unknown): string`

**Finding:** Two independent, internal, unexported `safeStringify` implementations exist under the
same "`JSON.stringify` with a fallback for non-serializable values" umbrella, but with divergent
contracts:

- `problem-details/utils.ts`'s version wraps a single `JSON.stringify` call and, on **any** thrown
  error (circular reference, `BigInt`, or otherwise), discards the entire payload and returns a
  fixed, generic RFC 9457 body (`type` `about:blank`, `status` `500`, `title`
  `Internal Server Error`) plus a `fallback: true` flag that `buildProblemResponse` uses to force
  the response status to 500.
- `logging/internal/safe-json.ts`'s version uses a custom `JSON.stringify` replacer to substitute
  individual non-serializable _values_ in place (`bigint` → `"<n>n"`, circular references →
  `"[Circular]"`, `symbol` → `"Symbol(description)"`, `function` → `"[Function name]"`), only
  falling back to a fixed `"[FormattingError]"` string in the rarer case where `JSON.stringify`
  still throws despite the replacer (e.g. a throwing getter).

**Why accepted as-is (not unified into one shared implementation):**

1. **Different origin.** `problem-details/utils.ts`'s `safeStringify` is part of the vendored port
   of `adrianhall/hono-problem-details` (§5.4; see `THIRD-PARTY-NOTICES.md`) — tracked against an
   upstream source, not toolkit-authored. `logging/internal/safe-json.ts` is toolkit-authored.
   Merging the two would blur that vendoring boundary and complicate future upstream diffs.
2. **Genuinely incompatible failure semantics, not just different names.** An HTTP error response
   needs an all-or-nothing outcome — a partially-serialized `problem+json` body is worse than a
   generic fallback, and `buildProblemResponse` actively uses the "did we fall back?" flag to force
   the response status to 500. A structured log record needs best-effort partial serialization —
   losing an entire log line because one field had a circular reference is worse than replacing
   just that one field.
3. **Small, contained, already individually tested.** Both functions are internal, unexported, and
   covered by dedicated unit tests (`test/node/problem-details/utils.test.ts`,
   `test/node/logging/internal/safe-json.test.ts`) — the duplication is not spreading or drifting
   silently.

**Revisit if:** a third consumer needs a `safeStringify` variant, or upstream
`hono-problem-details` changes its own fallback contract in a way that removes reason (1) above.

### 12.2 ARCH-003: Evaluated and rejected `safe-stringify` (npm) as a replacement for `logging/internal/safe-json.ts`

**Source:** [Issue #57](https://github.com/adrianhall/cloudflare-toolkit/issues/57), severity low,
`Code Quality` label (originating finding `CODE-006` — `logging/internal/safe-json.ts`'s
all-seen `Set` produced `"[Circular]"` false positives for shared/diamond references). While
fixing `CODE-006`, consolidating onto the well-regarded npm package
[`safe-stringify`](https://www.npmjs.com/package/safe-stringify) (Sindre Sorhus) was evaluated as
an alternative to a toolkit-authored fix, given its direct relevance to §12.1's
`safeStringify`-duplication discussion above.

**File:** `src/lib/logging/internal/safe-json.ts:63` — `safeStringify(value: unknown): string`

**Finding:** The npm package's core algorithm (a recursive walk with a `WeakMap`-based `seen`
set that calls `seen.delete(value)` once a node's children finish processing) is the same
correct "ancestor path, not all-seen objects" technique `CODE-006` recommended, and its own
README explicitly calls out this exact bug class in other libraries ("many packages incorrectly
replaced all duplicate objects, not just circular references") — good independent validation
that the chosen fix direction (implemented in-house, see the `safeStringify` JSDoc) is the
standard, correct one. However, the package was rejected as a **drop-in dependency** after
downloading and running it (via `npm pack`) against this module's actual contract:

| Input                                     | `logging/internal/safe-json.ts` (this repo)   | npm `safe-stringify` 1.3.0                                              |
| ----------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| Shared/diamond reference                  | Serializes in full at every location          | Serializes in full at every location (bug fixed, same)                  |
| True circular reference                   | `"[Circular]"`                                | `"[Circular]"` (same)                                                   |
| `bigint` anywhere in the value            | `"<n>n"` string                               | **Throws** `TypeError: Do not know how to serialize a BigInt`, uncaught |
| A property getter that throws             | Returns `"[FormattingError]"`                 | **Throws** the getter's own error, uncaught                             |
| `function` / `symbol` nested in an object | `"[Function name]"` / `"Symbol(description)"` | Silently dropped (native `JSON.stringify` omits both)                   |
| `undefined` at the top level              | Returns the **string** `"undefined"`          | Returns the JS value `undefined` (not a string)                         |

**Why rejected:**

1. **Violates the one non-negotiable property of a logging helper: never throw.** A log call
   must not alter or abort the caller's control flow. The npm package has no `try`/`catch`
   anywhere in its implementation and no replacer hook (its own README: _"There is no replacer
   option as I didn't need that"_), so a `BigInt` field or a throwing getter anywhere in a
   logged value — both realistic in a Workers context (D1/KV row IDs and counters are
   frequently `BigInt`; lazily-computed getters are common) — propagates an uncaught exception
   out of `safeStringify` and into the logging call site.
2. **Drops information this module's tests assert on.** `function` and `symbol` values are
   silently omitted rather than rendered as the descriptive placeholders
   (`"[Function name]"`, `"Symbol(description)"`) this module's contract and tests require.
3. **Breaks the declared return type in one case.** `safeStringify(undefined)` returns the
   actual JS `undefined` value, not a string, contradicting its own `(value: unknown, options?)
=> string` signature and this module's `"undefined"`-string top-level contract.
4. **Adopting it would not actually remove the custom logic it was meant to replace.** To
   restore points 1–3, `bigint`/`symbol`/`function` values would need to be normalized in a
   pre-pass before handing the value to the library — but that pre-pass would itself need to be
   circular-reference-aware to avoid infinite recursion on a cyclic input, duplicating the exact
   ancestor-tracking logic the dependency was meant to provide. Net effect: an added runtime
   dependency (to a subpath documented as "Any runtime" — browsers included, per `AGENTS.md`'s
   subpath table) while keeping nearly all of the current logic anyway.
5. **Irrelevant to (and would regress) the other `safeStringify` from §12.1.**
   `problem-details/utils.ts`'s version is deliberately all-or-nothing (§12.1 point 2): any
   serialization failure, including a circular reference, must force the generic 500 fallback.
   Swapping in a library that successfully serializes circular references (with `"[Circular]"`
   markers) instead of throwing would silently defeat that intentional behavior.

**Revisit if:** the package's maintainer adds a `try`/`catch`-safe mode or a
`bigint`/`symbol`/`function` replacer hook (their README invites "pull request welcome" for a
replacer option) that closes gaps 1–3 above without requiring a pre-pass on the toolkit's side.
