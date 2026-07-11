# Contributing to @adrianhall/cloudflare-toolkit

This file covers the parts of contributing that are about _process_ — when a changeset is
required and what happens after your PR merges. For engineering conventions (quality gates, the
100%-coverage recipe, project structure, and the "always consult live docs via MCP" rule), see
[`AGENTS.md`](./AGENTS.md).

## Adding a changeset

This repo uses [Changesets](https://github.com/changesets/changesets) to version the package and
generate `CHANGELOG.md`. Every PR that changes the **published surface area** — anything a
consumer could observe after `npm install @adrianhall/cloudflare-toolkit` (the root export or any
of the `guards`/`errors`/`problem-details`/`logging`/`hono`/`vite`/`testing` subpaths, or the
`generate-wrangler-types` CLI) — must include a changeset:

```sh
npx changeset
```

This walks you through picking a semver bump (patch/minor/major) and writing a short summary,
then writes a Markdown file under `.changeset/`. Commit that file along with your change.

PRs that only touch internal tooling, tests, or docs (no change a consumer of the package would
ever see) don't need one — see ["Not every change requires a
changeset"](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md#not-every-change-requires-a-changeset)
in the Changesets docs.

You can check what changesets are currently pending, and what release they'd produce, with:

```sh
npx changeset status
```

## Release process

There is no release automation wired up yet (that's tracked separately). Once it lands, the
lifecycle will look like this:

1. Changeset-bearing PRs merge to `main` as normal.
2. `changesets/action` (running in CI) opens or updates an automatic **"Version Packages" pull
   request** that consumes the pending changesets, bumps `package.json#version`, and writes the
   `CHANGELOG.md` entries.
3. Merging that "Version Packages" PR is the actual release trigger — not a routine merge. It
   causes the next workflow run to build and publish to npm, gated by a `release-gate`
   required-reviewer environment restricted to `adrianhall`. Don't merge it casually "to keep
   things tidy"; merging it kicks off a real publish approval request.

**Current state:** `main` has no branch-protection rules configured, and `adrianhall` is
presently the only collaborator with push access to this repository — so today, nobody but the
repo owner can merge anything into `main`, including that "Version Packages" PR. That's an
implicit second gate on top of `release-gate`, but it relies on "nobody else has push access yet"
rather than an explicit rule. If collaborators are ever granted push access, this should be
revisited — e.g. by adding branch protection that requires `adrianhall`'s review specifically on
the "Version Packages" PR — so the gate stays real rather than becoming an oversight.
