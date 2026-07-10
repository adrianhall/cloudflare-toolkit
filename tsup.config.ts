// tsup build configuration (docs/SPECv2.md §2.3, §3).
//
// One entry per subpath that exists today (docs/SPECv2.md §5.1): root, `guards`, `errors`,
// `problem-details`, `logging`, `hono`, `vite`, `testing` — plus one entry for the
// `generate-wrangler-types` **bin** (docs/SPECv2.md §5.7, issue #16), which is not part of
// `package.json#exports` at all (§5.1's table is import subpaths only).
//
// ESM-only (docs/SPECv2.md §3) — no CJS output, since every consumer of this toolkit is a
// Vite/Wrangler/Vitest project and all of those are ESM-first.
//
// Entry names use a `<subpath>/index` shape (not a flat `<subpath>`) so the built `dist/`
// mirrors `src/lib/<subpath>/index.ts` — this keeps `package.json#exports` easy to read and
// matches the nested-output convention already used by `@adrianhall/cloudflare-logger`.
// `cli/generate-wrangler-types/index` mirrors `src/cli/generate-wrangler-types/index.ts` the
// same way, matching `package.json#bin`'s own `./dist/cli/generate-wrangler-types/index.js`.
//
// tsup enables ESM code-splitting by default, which is required here, not optional: `guards`
// depends on `errors` (for `NullError`), and `logging` depends on `guards` (for
// `valueOrDefault`) — docs/SPECv2.md §5.1. Splitting extracts that shared code into a common
// chunk that every entry imports, so a class like `NullError` has exactly one identity across
// every built entry point; disabling splitting would silently duplicate these classes per
// bundle and break `instanceof` checks for real consumers (verified while planning this
// build — see the PR description).
//
// `CLI_VERSION` is a build-time constant referenced by `src/cli/generate-wrangler-types/run.ts`
// (`declare const CLI_VERSION: string`) for Commander's `--version` output — substituted here
// from the package's own `version` field, mirroring `cloudflare-scripts`'s own `tsup.config.ts`
// (docs/SPECv2.md §10).
import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  version: string;
};

export default defineConfig({
  entry: {
    "index": "src/index.ts",
    "guards/index": "src/lib/guards/index.ts",
    "errors/index": "src/lib/errors/index.ts",
    "problem-details/index": "src/lib/problem-details/index.ts",
    "logging/index": "src/lib/logging/index.ts",
    "hono/index": "src/lib/hono/index.ts",
    "vite/index": "src/lib/vite/index.ts",
    "testing/index": "src/lib/testing/index.ts",
    "cli/generate-wrangler-types/index": "src/cli/generate-wrangler-types/index.ts"
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
  // distinct reason: `auth-internal` (issue #12) is imported by the `hono`, `vite`, AND
  // `testing` entries (issues #13/#14/#15) for its shared JWT/JWKS/policy primitives
  // (docs/SPECv2.md §5.9, §9). Without this, each entry would bundle its own private copy of
  // `jose`, doubling (tripling) bundle size for no benefit since it's the same npm package
  // either way, and risking the same `instanceof`-mismatch class of bug as `HTTPException`
  // above should any entry ever branch on one of `jose`'s own error classes.
  //
  // `commander`/`chalk` (both real `dependencies` — docs/SPECv2.md §2.2, issue #16) are external
  // for a simpler reason than either of the above: they're only ever imported by the
  // `cli/generate-wrangler-types/index` entry, npm already installs them for the consumer
  // regardless (they're declared `dependencies`, not bundled-in extras), and leaving them
  // un-external would have tsup inline a full private copy into the CLI's own
  // `dist/cli/generate-wrangler-types/index.js` for no benefit — verified while planning this
  // issue: a spike build of a small `commander`-using CLI came out at ~107 KB/3,385 lines with
  // `commander` inlined vs. a handful of lines with it marked `external`, while still keeping
  // the entry's shebang intact.
  external: ["hono", "vite", "jose", "commander", "chalk"],
  // Preserves the sourcemap fix noted in the problem-details vendoring issue (docs/SPECv2.md
  // §5.4) for that subpath specifically, applied toolkit-wide.
  sourcemap: true,
  clean: true,
  define: {
    CLI_VERSION: JSON.stringify(version)
  },
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
