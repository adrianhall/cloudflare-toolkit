/**
 * @file tsup build configuration.
 *
 * One entry per subpath: root, `guards`, `errors`, `problem-details`, `logging`, `hono`, `vite`,
 * `testing` — plus one entry for the `generate-wrangler-types` bin, which is not part of
 * `package.json#exports` at all.
 *
 * ESM-only — no CJS output, since every consumer of this toolkit is a Vite/Wrangler/Vitest
 * project and all of those are ESM-first.
 *
 * Entry names use a `<subpath>/index` shape (not a flat `<subpath>`) so the built `dist/`
 * mirrors `src/lib/<subpath>/index.ts` — this keeps `package.json#exports` easy to read.
 * `cli/generate-wrangler-types/index` mirrors `src/cli/generate-wrangler-types/index.ts` the
 * same way, matching `package.json#bin`'s own `./dist/cli/generate-wrangler-types/index.js`.
 *
 * tsup enables ESM code-splitting by default, which is required here, not optional: `guards`
 * depends on `errors` (for `NullError`), and `logging` depends on `guards` (for
 * `valueOrDefault`). Splitting extracts that shared code into a common chunk that every entry
 * imports, so a class like `NullError` has exactly one identity across every built entry point;
 * disabling splitting would silently duplicate these classes per bundle and break `instanceof`
 * checks for real consumers.
 *
 * `CLI_VERSION` is a build-time constant referenced by `src/cli/generate-wrangler-types/run.ts`
 * (`declare const CLI_VERSION: string`) for Commander's `--version` output — substituted here
 * from the package's own `version` field.
 */
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
  // `hono` and `vite` are both peerDependencies and must never be bundled:
  //
  // - `hono`: `hono/index.ts` imports the runtime `HTTPException` class from
  //   `hono/http-exception` (`error-handler.ts`). Without this, tsup would inline its own
  //   private copy of that class into `dist/hono/index.js`, and a consumer's own
  //   `new HTTPException(...)` (from *their* installed `hono`) would come back `false` for
  //   `instanceof HTTPException` against our bundled copy — silently breaking
  //   `problemDetailsErrorHandler`'s `HTTPException` handling. Verified in
  //   `test/package/hono.test.ts`.
  // - `vite`: `vite/plugin.ts` only imports *type* declarations (`Connect`/`Plugin`) from `vite`
  //   today, so there is no live bundling risk yet, but marking it external keeps that guarantee
  //   explicit and avoids ever baking in a Vite-version-specific shape mismatch against a
  //   consumer's own `@cloudflare/vite-plugin`-adjacent `vite` install.
  //
  // `jose` (a real `dependency`, not a peer) is external for a related but distinct reason:
  // `auth-internal` is imported by the `hono`, `vite`, AND `testing` entries for its shared
  // JWT/JWKS/policy primitives. Without this, each entry would bundle its own private copy of
  // `jose`, doubling (tripling) bundle size for no benefit since it's the same npm package
  // either way, and risking the same `instanceof`-mismatch class of bug as `HTTPException`
  // above should any entry ever branch on one of `jose`'s own error classes.
  //
  // `commander`/`chalk` (both real `dependencies`) are external for a simpler reason than either
  // of the above: they're only ever imported by the `cli/generate-wrangler-types/index` entry,
  // npm already installs them for the consumer regardless (they're declared `dependencies`, not
  // bundled-in extras), and leaving them un-external would have tsup inline a full private copy
  // into the CLI's own `dist/cli/generate-wrangler-types/index.js` for no benefit — a spike build
  // of a small `commander`-using CLI came out at ~107 KB/3,385 lines with `commander` inlined vs.
  // a handful of lines with it marked `external`, while still keeping the entry's shebang intact.
  external: ["hono", "vite", "jose", "commander", "chalk"],
  // Sourcemaps are enabled toolkit-wide, including for the vendored `problem-details` subpath.
  sourcemap: true,
  clean: true,
  define: {
    CLI_VERSION: JSON.stringify(version)
  },
  dts: {
    compilerOptions: {
      // tsup's dts build step (rollup-plugin-dts) unconditionally injects a `baseUrl` into the
      // compiler options it hands to TypeScript. TypeScript 6.0.3 (pinned in package.json) now
      // raises that as error TS5101 ("Option 'baseUrl' is deprecated...") unless 6.0-line
      // deprecation diagnostics are silenced. Scoped to this dts build only; the project's own
      // tsconfig.json (used by `check:types`) never sets `baseUrl` and is left untouched.
      ignoreDeprecations: "6.0"
    }
  }
});
