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
  release right now.** It exists so CI can invoke it once release automation lands (see below) —
  it is not a routine command.

## Release process

All changes, including release-prep changes below, land on `main` the same way: via a pull
request with a green `ci-pass` status check. `main` is protected by a repository ruleset that
blocks direct pushes, force-pushes, and deletions, and requires `ci-pass` to be green and the
branch to be up to date before merging (strict status checks). The ruleset has **no bypass actors
configured** (`current_user_can_bypass: "never"`), so this applies to everyone, including
`adrianhall` — who is also presently the only collaborator with push access to this repository.
The ruleset itself doesn't require an approving review (`required_approving_review_count: 0`);
where an approval gate exists (see `release-gate` below), it's layered on top of, not a
substitute for, this PR + `ci-pass` requirement.

### Today (manual, until release automation lands)

There is no CI automation for versioning/publishing yet (tracked in a follow-up issue). Until it
lands, cutting a release is a manual, maintainer-only operation:

1. Ensure every changeset you want included in the release is merged to `main`.
2. From an up-to-date `main` checkout, run `npm run version-packages` to consume the pending
   changesets, bump the version, and generate the `CHANGELOG.md` entries. Review the diff, then
   open it as its own PR — it goes through the same PR + `ci-pass` flow as any other change.
3. Once that PR merges, from an up-to-date `main` checkout with npm publish credentials
   configured locally, run `npm run release` to build fresh and publish.

### Once release automation lands

Once the follow-up release-automation issue lands, the lifecycle becomes:

1. Changeset-bearing PRs merge to `main` as normal.
2. `changesets/action` (running in CI) opens or updates an automatic **"Version Packages" pull
   request** — effectively step 2 above (`npm run version-packages`), but run and committed by
   the bot instead of a person.
3. Merging that "Version Packages" PR is the actual release trigger — not a routine merge. It
   causes the next workflow run to run `npm run release` on your behalf (step 3 above, but run by
   CI), gated by a `release-gate` required-reviewer environment restricted to `adrianhall`. Don't
   merge it casually "to keep things tidy"; merging it kicks off a real publish approval request.
   It's still subject to the PR + `ci-pass` requirement described above like any other PR.
