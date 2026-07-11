# Releasing @adrianhall/cloudflare-toolkit

This file is for whoever is actually cutting a release (today, just `adrianhall` — see
[`release-gate`](#one-time-setup-already-done) below). If you're contributing a change and just
need to know whether/how to add a changeset, see [`CONTRIBUTING.md`](./CONTRIBUTING.md) instead;
this file starts where that one leaves off.

Releasing is fully automated by [`.github/workflows/release.yml`](./.github/workflows/release.yml)
using [Changesets](https://github.com/changesets/changesets) and **npm Trusted Publishing
(OIDC)** — there is no local `npm publish`, no long-lived `NPM_TOKEN`, and `dist/` is never
committed (it's built fresh in CI immediately before every publish). The only manual action a
maintainer ever takes is approving two ordinary GitHub PR/deployment gates, described below.

## The pipeline, end to end

`release.yml` runs on every push to `main` and always has the same three jobs, but only the
relevant one(s) actually do anything on a given run:

1. **`version`** — runs `changeset version` (via `npm run version-packages`) through
   [`changesets/action`](https://github.com/changesets/action). If there are changesets pending
   (i.e. some merged PR added one), it opens or updates an automatic **"Version Packages" pull
   request** — just a version bump + `CHANGELOG.md` diff, nothing is published yet. This job never
   requires approval.
2. **`publish`** — gated by the `release-gate` GitHub environment (see below). Only runs when the
   `version` job determines the local `package.json` version is not yet the version live on npm —
   which is only ever true right after the "Version Packages" PR itself has been merged. Builds
   fresh and runs `changeset publish` under OIDC Trusted Publishing.
3. **`build-docs`** — only runs immediately after a `publish` run that actually published
   something new. Builds the TypeDoc + VitePress documentation site and deploys it to
   [adrianhall.github.io/cloudflare-toolkit](https://adrianhall.github.io/cloudflare-toolkit),
   so the published docs (including the generated API reference) always match what's actually on
   npm, never an unreleased `main` HEAD.

### Cutting an actual release

1. Make sure every changeset you want included has already been merged to `main` (ordinary PR
   review, per [`CONTRIBUTING.md`](./CONTRIBUTING.md#adding-a-changeset)).
2. The next push to `main` — including the merge in step 1 — makes the `version` job open or
   update the **"Version Packages" PR** automatically. Nothing to do here beyond letting CI run;
   watch for the PR to appear (title `Version Packages`).
3. Review that PR like any other PR (it's just a version bump + `CHANGELOG.md` entries generated
   from the changesets you merged) and merge it. It goes through the same PR + `ci-pass` ruleset
   as everything else — `release.yml` itself posts a synthetic `ci-pass` status onto it, since the
   bot-pushed branch never triggers `ci.yml`'s own check (the source was already verified on
   `main` before the changesets were merged).
4. Merging that PR is the actual release trigger. The next `release.yml` run's `version` job now
   sees zero pending changesets **and** a local version that differs from what's live on npm —
   so it flags the run as ready to publish, and the `publish` job starts.
5. **Approve the release.** Go to the repo's **Actions** tab, open that "Release" workflow run,
   and click **Review deployments** → approve `release-gate`. This is a real pause: the job does
   not run at all — no build, no OIDC token exchange — until approved. Only `adrianhall` can
   approve it.
6. Once approved, `publish` builds fresh (`npm run build`) and runs `changeset publish`
   (`npm run release`), authenticating to npm via OIDC — no token, ever. npm generates a
   [provenance attestation](https://docs.npmjs.com/generating-provenance-statements)
   automatically. `changesets/action` also pushes the new version's git tag and creates a GitHub
   Release for it.
7. `build-docs` runs immediately after, building and deploying the docs site at the
   just-published version. Check
   [adrianhall.github.io/cloudflare-toolkit](https://adrianhall.github.io/cloudflare-toolkit) once
   it finishes.

There is no step where you run `npm publish`, `changeset publish`, or `npm run release` on your
own machine as part of a normal release — everything above happens in CI. (Those commands still
exist locally for emergency/manual use — see [Manual fallback](#manual-fallback-only-if-ci-is-broken) —
but reaching for them is the exception, not the rule.)

### Why doesn't every PR merge trigger a `release-gate` approval prompt?

A push to `main` with zero pending changesets happens both right after merging the "Version
Packages" PR (a real release) _and_ on any ordinary PR merge that never carried a changeset
(docs/chore/tooling changes — see
[CONTRIBUTING.md](./CONTRIBUTING.md#adding-a-changeset)). The `version` job tells these apart by
comparing the local `package.json` version against what's actually published on npm
(`npm view @adrianhall/cloudflare-toolkit version`): they only differ right after a genuine
version-bump merge. So the `publish` job — and the `release-gate` approval prompt it requires —
only ever fires for a real release, not for unrelated merges to `main`.

## One-time setup (already done)

These are one-time, manual, maintainer-only configuration steps performed outside of any workflow
file. They're documented here so a disaster-recovery rebuild (or onboarding a second maintainer
with release rights) doesn't have to be reverse-engineered from `release.yml`.

- **npm Trusted Publisher**, configured on the `@adrianhall/cloudflare-toolkit` package's Settings
  → Trusted Publishing page on npmjs.com:
  - Organization/user: `adrianhall`, repository: `cloudflare-toolkit`
  - **Workflow filename: `release.yml`** (npm matches on filename only, case-sensitive — this
    must stay exactly `.github/workflows/release.yml`; renaming the file breaks OIDC auth)
  - **Environment name: `release-gate`**
  - Allowed actions: `npm publish`
- **GitHub environment `release-gate`**, configured on the repo's Settings → Environments page:
  - Required reviewers: `adrianhall` only
  - Deployment branch restriction: `main` only
  - The `publish` job in `release.yml` must run under `environment: release-gate` — a job with no
    environment, or a differently-named one, won't satisfy the OIDC trust relationship npm checks
    for, and won't get the approval gate either.
- **Repository ruleset on `main`** (`Settings` → `Rules` → `Rulesets`, ruleset name `main`):
  requires a pull request and a `ci-pass` status check, pinned to the built-in GitHub Actions App
  (`integration_id: 15368`). This is what makes the synthetic `ci-pass` status step in the
  `version` job necessary — without it, the bot-opened "Version Packages" PR could never be
  merged.

None of the above is provisioned by `release.yml` itself; if any of it is ever deleted or
recreated, it must be reconfigured to match these exact values or the pipeline breaks (npm
publishing fails with an OIDC auth error if the workflow filename or environment name don't match
exactly; the Version Packages PR becomes permanently unmergeable if the ruleset or the synthetic
status step diverge).

## Manual fallback (only if CI is broken)

If `release.yml` itself is broken and a release genuinely can't wait, the underlying npm scripts
still work locally, provided you have npm publish rights configured on your machine (trusted
publishing is CI-only — it doesn't help a local publish):

```sh
# 1. From an up-to-date main checkout, consume pending changesets and generate CHANGELOG.md.
npm run version-packages

# 2. Review the diff, then open and merge it as its own PR like any other change.

# 3. From an up-to-date main checkout again, build fresh and publish.
npm run release

# 4. changeset publish only creates git tags locally — push them yourself.
git push --follow-tags
```

This bypasses OIDC provenance and the `build-docs` step entirely (you'd need to run
`npm run docs:build` and deploy `docs/.vitepress/dist` yourself, or just re-run the `build-docs`
job manually once `release.yml` is fixed). Treat this as an emergency escape hatch, not a routine
alternative to the automated flow above.

## Troubleshooting

- **`npm publish` fails with an OIDC/"Unable to authenticate" error** — the workflow filename or
  the `publish` job's `environment:` value no longer matches the Trusted Publisher configuration
  on npmjs.com exactly (both are case-sensitive). Re-check
  [One-time setup](#one-time-setup-already-done) above.
- **The "Version Packages" PR shows no `ci-pass` check and can't be merged** — the synthetic
  status step in the `version` job (`Set ci-pass status on Version Packages PR`) either didn't
  run or failed; check that job's logs. `steps.changesets.outputs.pullRequestNumber` must be set
  for it to run at all.
- **`publish` never starts after merging the Version Packages PR** — check the `version` job's
  "Check whether the current version is unpublished" step output; if `local` and `published`
  match, something merged the version bump without going through the automated PR (or npm's view
  of the package lagged behind — registry reads are eventually consistent).
- **Docs didn't deploy after a real publish** — check the `publish` job's `published` output was
  actually `true` (a `changeset publish` run that finds nothing new to publish still "succeeds"
  but publishes nothing, and `build-docs` correctly skips that case).
