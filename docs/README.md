# cloudflare-toolkit docs site

VitePress + TypeDoc documentation site for `@adrianhall/cloudflare-toolkit`, published to
<https://adrianhall.github.io/cloudflare-toolkit>.

This directory has its **own** `package.json`/lockfile, fully separate from the root project's
(see `AGENTS.md` and `docs/specs/SPECv2.md` §2.4) — `vitepress` depends on a different major
version of `vite` internally than this toolkit's own `vite` peer dependency, so the two
dependency trees must never be merged.

## Local development

```sh
npm install       # once, from inside this directory
npm run dev       # generates the API Reference from source JSDoc, then starts the VitePress dev server
```

Or, from the repo root: `npm run docs:dev` (after the one-time `npm install` above).

## Build

```sh
npm run build     # from inside this directory, or `npm run docs:build` from the repo root
```

Output is a static site at `docs/.vitepress/dist`. The generated API Reference markdown
(`docs/reference/`) is regenerated on every build from the toolkit's current JSDoc comments and is
never committed — same as the root project's own `dist/`.

## Structure

- `index.md` — home page
- `getting-started.md` — install + a minimal end-to-end example
- `guides/` — one guide per functional area (stub for now — full content is a follow-up issue)
- `reference/` — **generated**, gitignored — TypeDoc + `typedoc-plugin-markdown` output
- `changelog.md` — links out to GitHub Releases / root `CHANGELOG.md`
- `.vitepress/config.ts` — site config (nav, sidebar, `srcExclude: ['specs/**']` to keep the
  contributor-facing planning docs in `docs/specs/` out of the published site)
- `typedoc.json` — TypeDoc entry points (one per package subpath) and output settings
- `tsconfig.json` — scoped to `.vitepress/**/*.ts` only; intentionally not the root project's
  tsconfig (different runtime target — this is Node-only VitePress config, not Worker code)

## Known build warning

`npm run build`/`dev` prints one cosmetic warning:
`[WARNING] Unrecognized target environment "ES2024" [tsconfig.json]` pointing at the **root**
`tsconfig.json`. This comes from VitePress's own internal config-loading step (which transpiles
`.vitepress/config.ts` before any of this package's own `vite.esbuild.target` override can apply)
resolving a tsconfig one level up from `docs/`, ahead of — or instead of — `docs/tsconfig.json`.
It does not affect build output or exit code (root cause not fully isolated; low priority given
it's non-fatal — revisit if a future `vitepress` release changes this behavior).
