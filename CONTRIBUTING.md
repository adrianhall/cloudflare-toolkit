# Contributing to @adrianhall/cloudflare-toolkit

This file covers the contribution and release-preparation process. For engineering conventions
(quality gates, the 100%-coverage recipe, project structure, and the live-documentation rule), see
[`AGENTS.md`](./AGENTS.md).

## Ordinary pull requests

All changes land on `main` through a pull request with a green `ci-pass` status check. The `main`
ruleset blocks direct pushes, force-pushes, and deletions and requires the branch to be up to date
before merge.

Ordinary feature, fix, documentation, test, and tooling PRs do **not** carry version metadata. Do
not update `package.json#version` or the corresponding versions in `package-lock.json`. Each new
feature or contribution must add an item under the `Next release` header in `CHANGELOG.md` in this
format:

```md
- <github-checkin-hash> (<level>): <description>
```

Use the seven-character GitHub check-in hash, a level of `patch`, `minor`, or `major`, and a
consumer-facing description.

## Release pull requests

When maintainers decide to release, they explicitly choose the next stable semver and open a
dedicated release PR. That PR changes only release metadata and promotes the prepared release
notes:

- `package.json#version`
- `package-lock.json` top-level `version` and `packages[""]#version`
- `CHANGELOG.md`, by replacing `Next release` with the release version and adding a new empty
  `Next release` header

The release PR uses the same review and `ci-pass` requirements as every other PR. Merging it does
not publish anything. After merge, a maintainer creates an annotated `vX.Y.Z` tag at that release
PR's merge commit; the tag starts [the release pipeline](./RELEASING.md).

Publishing is CI-only. The repository intentionally has no local `release` or `npm publish`
wrapper script. See [`RELEASING.md`](./RELEASING.md) for release, recovery, and one-time setup
instructions.
