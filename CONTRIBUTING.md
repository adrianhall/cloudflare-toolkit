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

**Current state:** `main` is protected by a repository ruleset that blocks direct pushes,
force-pushes, and deletions, and requires every change to land via a pull request with a green
`ci-pass` status check (strict — the branch must be up to date with `main` before merging). The
ruleset has **no bypass actors configured** (`current_user_can_bypass: "never"`), so this applies
to everyone, including `adrianhall`, who is also presently the only collaborator with push access
to this repository. That means the "Version Packages" PR is subject to the same `ci-pass`-gated
PR flow as any other change — it's not merged directly, and there's nothing to revisit if
collaborators are ever added, since the rule already applies uniformly rather than relying on
"nobody else has push access yet." The ruleset itself doesn't require an approving review
(`required_approving_review_count: 0`); the human-approval gate on top of `ci-pass` for this
specific PR comes from `release-gate` above, not from branch protection.
