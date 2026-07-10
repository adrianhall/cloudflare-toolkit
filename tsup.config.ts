// tsup build configuration (docs/SPECv2.md §2.3, §3).
//
// One entry per subpath that exists today (docs/SPECv2.md §5.1): root, `guards`, `errors`,
// `problem-details`, `logging`, `hono`, `vite`. `testing`/`cli` each add their own entry in a
// later issue, once those subpaths actually have content.
//
// ESM-only (docs/SPECv2.md §3) — no CJS output, since every consumer of this toolkit is a
// Vite/Wrangler/Vitest project and all of those are ESM-first.
//
// Entry names use a `<subpath>/index` shape (not a flat `<subpath>`) so the built `dist/`
// mirrors `src/lib/<subpath>/index.ts` — this keeps `package.json#exports` easy to read and
// matches the nested-output convention already used by `@adrianhall/cloudflare-logger`.
//
// tsup enables ESM code-splitting by default, which is required here, not optional: `guards`
// depends on `errors` (for `NullError`), and `logging` depends on `guards` (for
// `valueOrDefault`) — docs/SPECv2.md §5.1. Splitting extracts that shared code into a common
// chunk that every entry imports, so a class like `NullError` has exactly one identity across
// every built entry point; disabling splitting would silently duplicate these classes per
// bundle and break `instanceof` checks for real consumers (verified while planning this
// build — see the PR description).
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "index": "src/index.ts",
    "guards/index": "src/lib/guards/index.ts",
    "errors/index": "src/lib/errors/index.ts",
    "problem-details/index": "src/lib/problem-details/index.ts",
    "logging/index": "src/lib/logging/index.ts",
    "hono/index": "src/lib/hono/index.ts",
    "vite/index": "src/lib/vite/index.ts"
  },
  format: ["esm"],
  // `hono` and `vite` are both peerDependencies (docs/SPECv2.md §2.1) and must never be bundled:
  //
  // - `hono`: `hono/index.ts` imports the runtime `HTTPException` class from
  //   `hono/http-exception` (issue #10, `error-handler.ts`). Without this, tsup would inline its
  //   own private copy of that class into `dist/hono/index.js`, and a consumer's own
  //   `new HTTPException(...)` (from *their* installed `hono`) would come back `false` for
  //   `instanceof HTTPException` against our bundled copy — silently breaking
  //   `problemDetailsErrorHandler`'s `HTTPException` handling. Verified in
  //   `test/package/hono.test.ts`.
  // - `vite`: `vite/plugin.ts` (issue #14) only imports *type* declarations (`Connect`/`Plugin`)
  //   from `vite` today, so there is no live bundling risk yet, but marking it external keeps
  //   that guarantee explicit and avoids ever baking in a Vite-version-specific shape mismatch
  //   against a consumer's own `@cloudflare/vite-plugin`-adjacent `vite` install.
  //
  // `jose` (a real `dependency`, not a peer — docs/SPECv2.md §2.2) is external for a related but
  // distinct reason: `auth-internal` (issue #12) is imported by BOTH the `hono` and `vite`
  // entries (issues #13/#14) for its shared JWT/JWKS/policy primitives (docs/SPECv2.md §5.9,
  // §9). Without this, each entry would bundle its own private copy of `jose`, doubling bundle
  // size for no benefit since it's the same npm package either way, and risking the same
  // `instanceof`-mismatch class of bug as `HTTPException` above should either entry ever branch
  // on one of `jose`'s own error classes.
  external: ["hono", "vite", "jose"],
  // Preserves the sourcemap fix noted in the problem-details vendoring issue (docs/SPECv2.md
  // §5.4) for that subpath specifically, applied toolkit-wide.
  sourcemap: true,
  clean: true,
  dts: {
    compilerOptions: {
      // tsup's dts build step (rollup-plugin-dts) unconditionally injects a `baseUrl` into the
      // compiler options it hands to TypeScript. TypeScript 6.0.3 — pinned in package.json,
      // docs/SPECv2.md §2.3 — now raises that as error TS5101 ("Option 'baseUrl' is
      // deprecated...") unless 6.0-line deprecation diagnostics are silenced. Scoped to this
      // dts build only; the project's own tsconfig.json (used by `check:types`) never sets
      // `baseUrl` and is left untouched.
      ignoreDeprecations: "6.0"
    }
  }
});
