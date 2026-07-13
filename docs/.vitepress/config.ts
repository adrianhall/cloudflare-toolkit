import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";

const referenceDir = fileURLToPath(new URL("../reference", import.meta.url));

/**
 * Maps a TypeDoc-generated module directory (see `../typedoc.json`'s `entryPoints`) to a
 * human-readable sidebar label matching the subpath table in `docs/specs/SPECv2.md` §5.1.
 * Deliberately an explicit, known list (not a directory scan) so an unexpected top-level
 * TypeDoc output folder never accidentally becomes a sidebar entry.
 */
const REFERENCE_MODULES: ReadonlyArray<{ dir: string; label: string }> = [
  { dir: "index", label: "Root (@adrianhall/cloudflare-toolkit)" },
  { dir: "lib/guards", label: "/guards" },
  { dir: "lib/errors", label: "/errors" },
  { dir: "lib/problem-details", label: "/problem-details" },
  { dir: "lib/logging", label: "/logging" },
  { dir: "lib/hono", label: "/hono" },
  { dir: "lib/vite", label: "/vite" },
  { dir: "lib/testing", label: "/testing" }
];

/**
 * Builds the API Reference sidebar from the TypeDoc-generated `reference/` directory rather
 * than hand-maintaining it, so it can never drift from the actually-generated content.
 * `reference/` is never committed (see root `.gitignore`) — every documented workflow
 * (`npm run dev`/`build` in this package.json) runs the TypeDoc generation step first, but this
 * still degrades gracefully to an Overview-only sidebar if evaluated before that has happened.
 */
function buildReferenceSidebar() {
  const items: { text: string; link: string }[] = [{ text: "Overview", link: "/reference/" }];

  for (const { dir, label } of REFERENCE_MODULES) {
    if (existsSync(join(referenceDir, dir, "index.md"))) {
      items.push({ text: label, link: `/reference/${dir}/` });
    }
  }

  return items;
}

/**
 * VitePress site config for the @adrianhall/cloudflare-toolkit documentation site.
 *
 * `base` matches the known GitHub Pages *project* site URL in the root package.json's
 * `homepage` field (https://adrianhall.github.io/cloudflare-toolkit) so asset paths resolve
 * correctly once the release-triggered deploy (a later issue) publishes this site.
 *
 * `srcExclude` keeps `docs/specs/**` (internal planning docs: SPECv2.md, IDEA.md) out of the
 * published site — those are contributor-facing engineering specs, not site content.
 */
export default defineConfig({
  title: "cloudflare-toolkit",
  description:
    "A toolkit of utilities and skills for developing Workers on the Cloudflare Dev Platform",
  base: "/cloudflare-toolkit/",
  // "specs/**" — internal contributor-facing planning docs (SPECv2.md, IDEA.md), not site
  // content. "README.md" — this directory's own contributor-facing "how to work on the docs
  // site" doc (see ./README.md), not a page for site visitors either.
  srcExclude: ["specs/**", "README.md"],
  cleanUrls: true,

  // Explicit target for the site's own JS bundle (independent of any tsconfig discovery — see
  // below), matching docs/tsconfig.json.
  vite: {
    esbuild: { target: "es2022" }
  },

  themeConfig: {
    nav: [
      { text: "Getting Started", link: "/getting-started" },
      { text: "Guides", link: "/guides/" },
      { text: "API Reference", link: "/reference/" },
      { text: "Changelog", link: "/changelog" }
    ],

    // A single flat array (rather than the path-keyed multi-sidebar form) so the exact same
    // sidebar renders on every "doc" layout page — Getting Started, every guide, every API
    // Reference page, and the changelog — instead of only appearing on whichever section a
    // path-keyed config happens to match (issue #142). The home page (`index.md`,
    // `layout: home`) is unaffected either way: VitePress's home layout never renders the
    // sidebar regardless of this config.
    sidebar: [
      { text: "Getting Started", link: "/getting-started" },
      {
        text: "Guides",
        collapsed: false,
        items: [
          { text: "Overview", link: "/guides/" },
          { text: "Authentication", link: "/guides/authentication" },
          { text: "Logging", link: "/guides/logging" },
          { text: "Error Handling", link: "/guides/error-handling" },
          { text: "Testing", link: "/guides/testing" },
          { text: "Command Line Tools", link: "/guides/cli" },
          { text: "Vite + Vitest configuration", link: "/guides/vite-vitest" }
        ]
      },
      {
        text: "API Reference",
        collapsed: false,
        items: buildReferenceSidebar()
      }
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/adrianhall/cloudflare-toolkit" }],

    search: {
      provider: "local"
    }
  }
});
