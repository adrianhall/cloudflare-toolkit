# Contributing to @adrianhall/cloudflare-toolkit

This file covers the parts of contributing that are about _process_ — when a changeset is
required, what the Changesets-related npm scripts actually do, and what happens after your PR
merges. For engineering conventions (quality gates, the 100%-coverage recipe, project structure,
and the "always consult live docs via MCP" rule), see [`AGENTS.md`](./AGENTS.md).

## Adding a changeset

This repo uses [Changesets](https://github.com/changesets/changesets) to version the package and
generate `CHANGELOG.md`. Every PR that changes the **published surface area** — anything a
consumer could observe after `npm install @adrianhall/cloudflare-toolkit` (the root export or any
of the `guards`/`errors`/`problem-details`/`logging`/`hono`/`vite`/`testing` subpaths, or the
`generate-wrangler-types` CLI) — must include a changeset:

```sh
npm run changeset
```

(equivalent to `npx changeset` — the script is just a shorter alias). This walks you through
picking a semver bump (patch/minor/major) and writing a short summary, then writes a Markdown
file under `.changeset/`. Commit that file along with your change.

PRs that only touch internal tooling, tests, or docs (no change a consumer of the package would
ever see) don't need one — see ["Not every change requires a
changeset"](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md#not-every-change-requires-a-changeset)
in the Changesets docs. (This PR is an example: it only touches devDependencies/tooling, so it
doesn't carry a changeset of its own.)

You can check what changesets are currently pending, and what release they'd produce, with:

```sh
npx changeset status
```

## npm scripts reference

Three Changesets-related scripts exist in `package.json`:

- **`npm run changeset`** — alias for `npx changeset`. Contributors run this for any PR that
  needs one, as above. Safe to run any time; only writes a file under `.changeset/`.
- **`npm run version-packages`** — runs `changeset version` (consumes every pending changeset,
  bumps `package.json#version`, and writes the `CHANGELOG.md` entries), then `prettier --write .`
  to clean up the resulting formatting. This is a **release-prep** step, not something a
  contributor runs as part of a normal PR — see "Release process" below for who runs it and when.
- **`npm run release`** — runs `npm run build` followed by `changeset publish`, which **actually
  publishes to the npm registry** using whatever npm publish credentials are active on the
  machine that runs it. **Never run this locally unless you specifically intend to publish a real
  release right now.** This is the command CI's release workflow invokes on your behalf (see
  "Release process" below) — it is not a routine command for a contributor to run.

## Release process

All changes, including release-prep changes below, land on `main` the same way: via a pull
request with a green `ci-pass` status check. `main` is protected by a repository ruleset that
blocks direct pushes, force-pushes, and deletions, and requires `ci-pass` to be green and the
branch to be up to date before merging (strict status checks). The ruleset has **no bypass actors
configured** (`current_user_can_bypass: "never"`), so this applies to everyone, including
`adrianhall` — who is also presently the only collaborator with push access to this repository.
The ruleset itself doesn't require an approving review (`required_approving_review_count: 0`);
the `release-gate` approval gate described below is layered on top of, not a substitute for, this
PR + `ci-pass` requirement.

Versioning and publishing are automated by
[`.github/workflows/release.yml`](./.github/workflows/release.yml): changeset-bearing PRs merge
to `main` as normal, `changesets/action` (running in CI) opens or updates an automatic
**"Version Packages" pull request**, and merging _that_ PR is the actual release trigger — it
causes the next workflow run to build fresh and publish under npm **Trusted Publishing (OIDC)**,
gated by a `release-gate` required-reviewer environment restricted to `adrianhall`. Don't merge
the Version Packages PR casually "to keep things tidy"; merging it kicks off a real publish
approval request.

As a contributor, none of this requires anything from you beyond adding a changeset when one is
needed (above). **If you're the one actually cutting a release** — reviewing/merging the Version
Packages PR, approving the `release-gate` deployment, or troubleshooting the pipeline — see
[`RELEASING.md`](./RELEASING.md) for the full step-by-step and the one-time npm/GitHub
configuration the pipeline depends on.
