/**
 * @file tsdown build configuration.
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
 * tsdown (Rolldown-based, like tsup) enables ESM code-splitting by default, which is required
 * here, not optional: `guards` depends on `errors` (for `NullError`), and `logging` depends on
 * `guards` (for `valueOrDefault`). Splitting extracts that shared code into a common chunk that
 * every entry imports, so a class like `NullError` has exactly one identity across every built
 * entry point; disabling splitting would silently duplicate these classes per bundle and break
 * `instanceof` checks for real consumers. Confirmed empirically after migrating from tsup
 * (`test/package/index.test.ts`'s cross-entry identity assertions) — see #89.
 *
 * `CLI_VERSION` is a build-time constant referenced by `src/cli/generate-wrangler-types/run.ts`
 * (`declare const CLI_VERSION: string`) for Commander's `--version` output — substituted here
 * from the package's own `version` field.
 */
import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

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
  format: "esm",
  // tsdown defaults `fixedExtension` to `true` when `platform` is `node` (the default platform),
  // which forces every output file to `.mjs`/`.d.mts` regardless of `package.json#type`. This
  // repo is `"type": "module"`, so plain `.js`/`.d.ts` extensions are already unambiguously ESM
  // — and `package.json#exports`/`#bin`/`#main`/`#types` all reference `.js`/`.d.ts` paths.
  // Explicitly disabling this keeps the built `dist/` shape identical to tsup's (which always
  // used `.js`/`.d.ts`) rather than requiring a matching `package.json` rewrite.
  fixedExtension: false,
  // `hono` and `vite` are both peerDependencies and must never be bundled:
  //
  // - `hono`: `hono/index.ts` imports the runtime `HTTPException` class from
  //   `hono/http-exception` (`error-handler.ts`). Without this, tsdown would inline its own
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
  // `commander`/`chalk`/`cross-spawn` (all real `dependencies`) are external for a simpler reason
  // than either of the above: they're only ever imported by the `cli/generate-wrangler-types/index`
  // entry, npm already installs them for the consumer regardless (they're declared
  // `dependencies`, not bundled-in extras), and leaving them un-external would have tsdown inline
  // a full private copy into the CLI's own `dist/cli/generate-wrangler-types/index.js` for no
  // benefit — a spike build of a small `commander`-using CLI came out at ~107 KB/3,385 lines with
  // `commander` inlined vs. a handful of lines with it marked external, while still keeping the
  // entry's shebang intact. `cross-spawn` (added to fix SEC-002 — command injection via
  // unescaped `shell: true` spawn) follows the same reasoning.
  //
  // tsdown already externalizes everything under `package.json`'s `dependencies`/
  // `peerDependencies`/`optionalDependencies` by default (identical semantics to tsup's own
  // default), so this list is redundant with that default today — kept anyway, mirroring the
  // rationale above, purely for documentation/defensive clarity should any of these ever move to
  // a different `package.json` dependency bucket. tsdown deprecates the top-level `external`
  // option in favor of the `deps` namespace, hence `deps.neverBundle` rather than `external`
  // here. Tracked for re-evaluation in #92.
  deps: {
    neverBundle: ["hono", "vite", "jose", "commander", "chalk", "cross-spawn"]
  },
  // Sourcemaps are enabled toolkit-wide, including for the vendored `problem-details` subpath.
  sourcemap: true,
  clean: true,
  define: {
    CLI_VERSION: JSON.stringify(version)
  },
  // tsup's dts build step (rollup-plugin-dts) unconditionally injected a `baseUrl` into the
  // compiler options it handed to TypeScript, which TypeScript 6.0.3 (pinned in package.json)
  // raised as error TS5101 ("Option 'baseUrl' is deprecated...") — worked around there with
  // `dts: { compilerOptions: { ignoreDeprecations: "6.0" } }`. tsdown's declaration generation
  // goes through `rolldown-plugin-dts`, a different code path, and does not inject `baseUrl`;
  // confirmed empirically by building against this repo's pinned `typescript@^6.0.3` with no
  // `compilerOptions` override at all and no TS5101. No workaround needed here.
  dts: true
});
