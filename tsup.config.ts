// tsup build configuration (docs/SPECv2.md §2.3, §3).
//
// One entry per subpath that exists today (docs/SPECv2.md §5.1): root, `guards`, `errors`,
// `problem-details`, `logging`. `hono`/`vite`/`testing`/`cli` each add their own entry in a
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
    "logging/index": "src/lib/logging/index.ts"
  },
  format: ["esm"],
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
