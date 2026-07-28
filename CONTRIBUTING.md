# Contributing to @adrianhall/cloudflare-toolkit

This file covers the contribution and release-preparation process. For engineering conventions
(quality gates, the 100%-coverage recipe, project structure, and the live-documentation rule), see
[`AGENTS.md`](./AGENTS.md).

## Ordinary pull requests

All changes land on `main` through a pull request with a green `ci-pass` status check. The `main`
ruleset blocks direct pushes, force-pushes, and deletions and requires the branch to be up to date
before merge.

Ordinary feature, fix, documentation, test, and tooling PRs do **not** carry version or release
metadata. Do not update `package.json#version`, the corresponding versions in `package-lock.json`,
or `CHANGELOG.md` in an ordinary PR. Describe consumer-visible changes clearly in the PR so a
maintainer can include them in the next release.

## Release pull requests

When maintainers decide to release, they explicitly choose the next stable semver and open a
dedicated release PR. That PR changes only release metadata and any necessary release-note edits:

- `package.json#version`
- `package-lock.json` top-level `version` and `packages[""]#version`
- `CHANGELOG.md`, with a user-facing entry for that version

The release PR uses the same review and `ci-pass` requirements as every other PR. Merging it does
not publish anything. After merge, a maintainer creates an annotated `vX.Y.Z` tag at that release
PR's merge commit; the tag starts [the release pipeline](./RELEASING.md).

Publishing is CI-only. The repository intentionally has no local `release` or `npm publish`
wrapper script. See [`RELEASING.md`](./RELEASING.md) for release, recovery, and one-time setup
instructions.
