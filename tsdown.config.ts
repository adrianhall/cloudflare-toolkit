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
  // `hono`, `vite`, `jose`, `commander`, `chalk`, and `cross-spawn` all live in `package.json`'s
  // `dependencies`/`peerDependencies`, which tsdown already externalizes by default — nothing
  // above ever needs bundling. `deps.onlyBundle: []` turns that expectation into a hard build
  // error the moment anything from `node_modules` ends up in the bundle instead (e.g. one of the
  // above accidentally moving to `devDependencies` while still imported), without having to name
  // and maintain the list of packages this protects — see `docs/specs/SPECv2.md` §12.6 (#92).
  deps: {
    onlyBundle: []
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
