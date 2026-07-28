# Releasing @adrianhall/cloudflare-toolkit

Releases use an explicit release PR followed by an annotated `vX.Y.Z` tag. The tag triggers
[`.github/workflows/release.yml`](./.github/workflows/release.yml), which uses npm Trusted
Publishing (OIDC): there is no long-lived `NPM_TOKEN`, local publish command, or committed `dist/`.

## Release process

1. Choose the next stable semver version. Prerelease and build metadata are not supported by this
   pipeline.
2. Create a dedicated release PR from current `main`. Update `package.json#version`, both root
   version fields in `package-lock.json`, and `CHANGELOG.md`. Do not include unrelated code.
3. Let the normal PR checks pass, review the version and release notes, and merge the release PR.
4. Record the merge commit and create an annotated tag whose name is exactly `v` plus the package
   version:

   ```sh
   git fetch origin main
   git tag -a vX.Y.Z <release-pr-merge-sha> -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. Open the triggered **Release** workflow run and approve the `release-gate` deployment. Only the
   publish job waits for this approval; validation and the documentation build happen first.
6. Confirm the workflow completes in this order: npm publish (or confirmation that the exact
   version already exists), documentation deploy, then GitHub Release creation using that
   version's `CHANGELOG.md` entry.

Do not tag the release PR's head commit before merge. The workflow requires the tagged commit to
be contained in `origin/main`, and the intended release point is the merge commit.

## Pipeline guarantees

The workflow runs only for tags matching the broad GitHub filter `v*.*.*`, then rejects anything
other than strict stable semver (`vX.Y.Z`, with no leading zeroes, prerelease, or build suffix).
Before approval it verifies:

- the tag is exactly `v` plus `package.json#version`;
- package names and the top-level and `packages[""]` lockfile versions match `package.json`;
- the tagged commit is contained in `origin/main`;
- `CHANGELOG.md` contains non-empty release notes for the package version;
- an unpublished candidate is newer than every stable version already on npm;
- `npm ci`, `npm run check`, `npm run test:coverage`, the docs dependency install, and the full
  TypeDoc/VitePress build all succeed.

The generated Pages site is uploaded as an artifact before approval. After approval, the publish
job checks out the tag again, installs with `npm ci`, and builds `dist/` fresh before publishing.
Jobs have only their required permissions, and the release concurrency group prevents release
versions from racing each other.

## Recovery and reruns

Rerun the same workflow for the same tag after fixing an external configuration or transient
failure. Do not move, delete, or recreate a published release tag.

The publish job queries the registry immediately before publishing. If an earlier run already
published to npm but failed during docs deployment or GitHub Release creation, the rerun confirms
the existing version, skips duplicate `npm publish`, and continues. A rerun is rejected if a newer
stable version has since been published, preventing an old tag from rolling the docs site back.
Pages deployment is safe to repeat. GitHub Release creation checks for an existing release first
and is also idempotent.

If validation fails because release metadata is wrong, do not retarget the existing tag. Delete it
only if no package was published and no release artifacts were created, then fix the metadata
through a new PR and create the correct tag at that new merge commit. If npm publication may have
succeeded, inspect the exact version with:

```sh
npm view @adrianhall/cloudflare-toolkit@X.Y.Z version
```

If that version exists, preserve the tag and rerun its workflow. npm versions are immutable.

Publishing remains CI-only even during recovery. Do not use a local `npm publish`; doing so would
bypass the approval gate, Trusted Publishing identity, provenance, and ordered docs/release steps.

## One-time setup

These settings are maintained outside the workflow and must remain aligned with it:

- **npm Trusted Publisher** for `@adrianhall/cloudflare-toolkit`:
  organization/user `adrianhall`, repository `cloudflare-toolkit`, workflow filename `release.yml`,
  environment `release-gate`, allowed action `npm publish`.
- **GitHub environment `release-gate`**: keep the required reviewer (`adrianhall`) and change the
  deployment tag restriction to allow `v*.*.*`. The `publish` job must continue to use this exact
  environment name for both approval and npm's OIDC trust policy.
- **GitHub environment `github-pages`**: allow deployment from `v*.*.*` tags so the post-publish
  docs job is not blocked by a branch-only policy.
- **GitHub Pages**: keep GitHub Actions selected as the deployment source.
- **`main` ruleset**: continue requiring pull requests and the `ci-pass` status check for release
  PRs as well as ordinary PRs.

Protecting `v*.*.*` tags with a repository ruleset is recommended so only maintainers can create,
update, or delete canonical release tags. This is defense in depth; the workflow still validates
tag syntax, version consistency, and `main` ancestry.

## Troubleshooting

- **No workflow run appears:** the pushed tag did not match `v*.*.*`, Actions is disabled, or the
  workflow was not present at the tagged commit.
- **Validation rejects the tag:** compare the tag, `package.json`, both lockfile version fields,
  and the tagged commit's relationship to `origin/main`. Never bypass these checks.
- **`release-gate` or `github-pages` is waiting/rejected:** ensure that environment permits
  `v*.*.*` tags. Preserve the required reviewer on `release-gate`.
- **npm OIDC authentication fails:** verify the npm Trusted Publisher's case-sensitive workflow
  filename and environment exactly match `release.yml` and `release-gate`. No `NPM_TOKEN` should
  be configured or added to the workflow.
- **npm succeeded but a later job failed:** rerun the full workflow. Exact-version detection skips
  duplicate publication and resumes the ordered docs and GitHub Release stages.
- **The Pages artifact expired while awaiting approval:** rerun the workflow to rebuild and upload
  it, then approve the new run.
