/**
 * @file tsdown build configuration.
 *
 * Configures the production build of this library for distribution to npm:
 * - Builds one entry per subpath so every entry in `package.json#exports` (plus the
 *   `generate-wrangler-types` CLI bin) is actually present in the published `dist/` — see
 *   `docs/specs/SPECv2.md` §5.1 for the full subpath/export list.
 * - Externalizes every runtime dependency (`hono`, `vite`, `jose`, `commander`, `chalk`,
 *   `cross-spawn`) so none of them are bundled into `dist/` — consumers install these
 *   themselves per `package.json`'s own `dependencies`/`peerDependencies` (§2.1–§2.2).
 *
 * Rationale for the less-obvious options below lives in `docs/specs/SPECv2.md` §12.6–§12.7
 * rather than here, to keep this file readable as a config file rather than a design doc.
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
  fixedExtension: false,
  deps: {
    onlyBundle: []
  },
  sourcemap: true,
  clean: true,
  define: {
    CLI_VERSION: JSON.stringify(version)
  },
  dts: true
});
