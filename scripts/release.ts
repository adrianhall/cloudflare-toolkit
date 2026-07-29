/**
 * @file Maintainer-only script that prepares a release pull request.
 *
 * Usage:
 *
 * ```sh
 * node scripts/release.ts <major|minor|patch>
 * ```
 *
 * Computes the next stable semver version from `package.json#version`, then creates a dedicated
 * `release-vX.Y.Z` worktree/branch, updates `package.json`, both root version fields in
 * `package-lock.json`, and `CHANGELOG.md` (promoting `## Next release` to `## X.Y.Z` and inserting
 * a new empty `## Next release` above it), commits, pushes, and opens the release PR with `gh`.
 * See `RELEASING.md` for the full release process this feeds into and `CONTRIBUTING.md` for why
 * ordinary PRs never carry this metadata.
 *
 * Not part of the published package — `package.json#files` is `["dist", "LICENSE",
 * "THIRD-PARTY-NOTICES.md"]`, so `scripts/` never ships — and not measured by the 100%-coverage
 * gate that applies to `src/**\/*.ts` (`vitest.config.ts`'s `coverage.include`). This is
 * maintainer tooling, not a public API surface, so it is exercised by targeted tests
 * (`test/node/scripts/release.test.ts`) rather than held to that threshold.
 *
 * Every external effect (git, gh) goes through the injectable {@link CommandRunner} so tests can
 * fake preflight failures without touching the real repository; only the terminal happy-path
 * integration test exercises {@link createCommandRunner}'s real `spawnSync` against a throwaway
 * local repository.
 */
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import semver from "semver";

/** Raised for any expected release-preparation failure (bad input or failed precondition). */
export class ReleaseError extends Error {
  /** Creates a release-preparation error with the given message. */
  constructor(message: string) {
    super(message);
    this.name = "ReleaseError";
  }
}

/** Supported semver increments accepted as the script's single positional argument. */
export type ReleaseIncrement = "major" | "minor" | "patch";

/** Outcome of a single external command invocation. */
export interface CommandResult {
  /** Process exit code, or `null` if the process did not exit normally. */
  status: number | null;
  /** Captured standard output. */
  stdout: string;
  /** Captured standard error. */
  stderr: string;
}

/** Injectable external-command runner so every git/gh invocation can be observed or faked. */
export interface CommandRunner {
  /** Runs a command to completion and returns its exit code and captured output. */
  run(command: string, args: readonly string[], options?: { cwd?: string }): CommandResult;
}

/** Creates the real command runner used by the CLI entry point (`spawnSync`, no shell). */
export function createCommandRunner(): CommandRunner {
  return {
    run(command, args, options) {
      const result = spawnSync(command, args, {
        cwd: options?.cwd,
        encoding: "utf-8",
        shell: false
      });
      if (result.error) {
        throw new ReleaseError(`Failed to execute ${command}: ${result.error.message}`);
      }
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    }
  };
}

/** Dependencies for {@link prepareRelease}. */
export interface ReleaseDeps {
  /** Runner used for every git/gh invocation. */
  runner: CommandRunner;
  /** Working directory to resolve the repository from. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Home directory used to place the release worktree. Defaults to `os.homedir()`. */
  home?: string;
}

/** Result of a successful {@link prepareRelease} run. */
export interface ReleaseResult {
  /** The computed release version, e.g. `2.3.0`. */
  version: string;
  /** The created branch name, e.g. `release-v2.3.0`. */
  branch: string;
  /** Absolute path to the created worktree. */
  worktreePath: string;
  /** URL of the opened pull request. */
  prUrl: string;
}

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const INCREMENTS: ReadonlySet<string> = new Set<ReleaseIncrement>(["major", "minor", "patch"]);
const NEXT_RELEASE_HEADING = "## Next release";
const TOP_LEVEL_VERSION_LINE = /^ {2}"version": "([^"]*)",$/m;
const LOCKFILE_ROOT_PACKAGE_KEY = '"": {';
const NESTED_VERSION_LINE = /^ {6}"version": "([^"]*)",$/m;

function isReleaseIncrement(value: string): value is ReleaseIncrement {
  return INCREMENTS.has(value);
}

/** Parses and validates the script's single `major|minor|patch` positional argument. */
export function parseIncrement(args: readonly string[]): ReleaseIncrement {
  if (args.length !== 1) {
    throw new ReleaseError(
      `Usage: node scripts/release.ts <major|minor|patch> (received ${String(args.length)} argument(s))`
    );
  }
  const [increment] = args;
  if (!isReleaseIncrement(increment)) {
    throw new ReleaseError(
      `Increment must be exactly one of major, minor, patch; received '${increment}'`
    );
  }
  return increment;
}

/**
 * Computes the next stable semver version.
 *
 * Rejects a current version that is not strict stable semver (`vX.Y.Z`, no leading zeroes,
 * prerelease, or build suffix) and asserts the computed version is strictly newer, mirroring the
 * validation `.github/workflows/release.yml` performs on the tag it is eventually given.
 */
export function computeNextVersion(currentVersion: string, increment: ReleaseIncrement): string {
  if (!STABLE_SEMVER.test(currentVersion)) {
    throw new ReleaseError(
      `Current version '${currentVersion}' is not strict stable semver (vX.Y.Z)`
    );
  }
  const next = semver.inc(currentVersion, increment);
  if (next === null || !STABLE_SEMVER.test(next) || !semver.gt(next, currentVersion)) {
    throw new ReleaseError(
      `Could not compute a valid, strictly newer ${increment} version from '${currentVersion}'`
    );
  }
  return next;
}

function bumpTopLevelVersion(
  source: string,
  fileLabel: string,
  currentVersion: string,
  nextVersion: string
): string {
  const match = TOP_LEVEL_VERSION_LINE.exec(source);
  if (!match) {
    throw new ReleaseError(`${fileLabel} has no top-level "version" field`);
  }
  if (match[1] !== currentVersion) {
    throw new ReleaseError(`${fileLabel} version is '${match[1]}', expected '${currentVersion}'`);
  }
  return `${source.slice(0, match.index)}  "version": "${nextVersion}",${source.slice(match.index + match[0].length)}`;
}

/**
 * Updates `package.json#version`, preserving every other byte of the file.
 *
 * @param source - Current file contents.
 * @param currentVersion - Expected current version; mismatch throws {@link ReleaseError}.
 * @param nextVersion - Version to write.
 */
export function bumpPackageJson(
  source: string,
  currentVersion: string,
  nextVersion: string
): string {
  const updated = bumpTopLevelVersion(source, "package.json", currentVersion, nextVersion);
  const parsed = JSON.parse(updated) as { version?: unknown };
  if (parsed.version !== nextVersion) {
    throw new ReleaseError("package.json was not updated to the expected version");
  }
  return updated;
}

/**
 * Updates both root version fields in `package-lock.json` (the top-level `version` and
 * `packages[""].version`), preserving every other byte of the file.
 *
 * @param source - Current file contents.
 * @param currentVersion - Expected current version in both fields; mismatch throws
 *   {@link ReleaseError}.
 * @param nextVersion - Version to write to both fields.
 */
export function bumpPackageLock(
  source: string,
  currentVersion: string,
  nextVersion: string
): string {
  let updated = bumpTopLevelVersion(source, "package-lock.json", currentVersion, nextVersion);

  const anchor = updated.indexOf(LOCKFILE_ROOT_PACKAGE_KEY);
  if (anchor < 0) {
    throw new ReleaseError('package-lock.json has no packages[""] entry');
  }
  // Bound the search to the `"": { ... }` block itself — everything nested inside it is
  // indented 6+ spaces, so the next 4-space-indented key (e.g. `"node_modules/..."`) marks
  // where the block ends. Without this bound, a lockfile whose root entry is missing a
  // "version" line would incorrectly match the *next* package's version instead of failing.
  const nextSiblingKeyIndex = updated.indexOf('\n    "', anchor + LOCKFILE_ROOT_PACKAGE_KEY.length);
  const rootPackageBlock = updated.slice(
    anchor,
    nextSiblingKeyIndex < 0 ? undefined : nextSiblingKeyIndex
  );
  const match = NESTED_VERSION_LINE.exec(rootPackageBlock);
  if (!match) {
    throw new ReleaseError('package-lock.json packages[""] has no "version" field');
  }
  if (match[1] !== currentVersion) {
    throw new ReleaseError(
      `package-lock.json packages[""] version is '${match[1]}', expected '${currentVersion}'`
    );
  }
  const absoluteIndex = anchor + match.index;
  updated = `${updated.slice(0, absoluteIndex)}      "version": "${nextVersion}",${updated.slice(absoluteIndex + match[0].length)}`;

  const parsed = JSON.parse(updated) as {
    version?: unknown;
    packages?: Record<string, { version?: unknown } | undefined>;
  };
  if (parsed.version !== nextVersion || parsed.packages?.[""]?.version !== nextVersion) {
    throw new ReleaseError(
      "package-lock.json was not updated to the expected version in both locations"
    );
  }
  return updated;
}

/** Result of promoting `CHANGELOG.md`'s `## Next release` section. */
export interface PromotedChangelog {
  /** Full updated file contents. */
  content: string;
  /** The promoted section's notes, trimmed (used as the release PR body). */
  notes: string;
}

/**
 * Promotes `## Next release` to `## X.Y.Z` and inserts a new empty `## Next release` above it,
 * matching `CONTRIBUTING.md`'s described release-PR edit exactly.
 *
 * @param source - Current file contents.
 * @param nextVersion - Version heading to promote the section to.
 */
export function promoteChangelog(source: string, nextVersion: string): PromotedChangelog {
  const lines = source.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === NEXT_RELEASE_HEADING);
  if (headingIndex < 0) {
    throw new ReleaseError(`CHANGELOG.md has no "${NEXT_RELEASE_HEADING}" heading`);
  }
  const nextHeadingIndex = lines.findIndex(
    (line, index) => index > headingIndex && line.startsWith("## ")
  );
  const sectionEnd = nextHeadingIndex < 0 ? lines.length : nextHeadingIndex;
  const notes = lines
    .slice(headingIndex + 1, sectionEnd)
    .join("\n")
    .trim();
  if (!notes) {
    throw new ReleaseError(`"${NEXT_RELEASE_HEADING}" has no release notes to promote`);
  }
  const replacement = [NEXT_RELEASE_HEADING, "", `## ${nextVersion}`, "", notes, ""];
  const content = [
    ...lines.slice(0, headingIndex),
    ...replacement,
    ...lines.slice(sectionEnd)
  ].join("\n");
  return { content, notes };
}

/** Parses an `owner/repo` slug from a git remote URL (`https://` or `git@` form). */
export function parseGitHubSlug(remoteUrl: string): string {
  const trimmed = remoteUrl.trim().replace(/\.git$/, "");
  const httpsMatch = /^https?:\/\/[^/]+\/(.+)$/.exec(trimmed);
  if (httpsMatch) return httpsMatch[1];
  const sshMatch = /^[^@]+@[^:]+:(.+)$/.exec(trimmed);
  if (sshMatch) return sshMatch[1];
  throw new ReleaseError(`Could not parse a GitHub owner/repo slug from remote URL '${remoteUrl}'`);
}

function runOrThrow(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
  options?: { cwd?: string }
): string {
  const result = runner.run(command, args, options);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${String(result.status)}`;
    throw new ReleaseError(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
}

/** Throws if a ref exists (used for the "must not already exist" collision checks below). */
function assertRefAbsent(
  runner: CommandRunner,
  description: string,
  command: string,
  args: readonly string[],
  cwd: string
): void {
  const result = runner.run(command, args, { cwd });
  if (result.status === 0) {
    throw new ReleaseError(
      `${description} already exists; choose a different increment or clean up first`
    );
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates repository state, computes the next version, and stages the three release-metadata
 * edits without writing anything yet. Every check here runs before {@link prepareRelease} creates
 * the worktree, so a failure here never leaves the repository in a partially-mutated state.
 */
async function preflight(
  increment: ReleaseIncrement,
  deps: ReleaseDeps
): Promise<{
  repoRoot: string;
  repoSlug: string;
  currentVersion: string;
  nextVersion: string;
  branch: string;
  worktreePath: string;
  packageJson: string;
  packageLock: string;
  promoted: PromotedChangelog;
}> {
  const { runner } = deps;
  const cwd = deps.cwd ?? process.cwd();
  const home = deps.home ?? homedir();

  const repoRoot = runOrThrow(runner, "git", ["rev-parse", "--show-toplevel"], { cwd }).trim();

  const branchName = runOrThrow(runner, "git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot
  }).trim();
  if (branchName !== "main") {
    throw new ReleaseError(`Must be run on 'main' (currently on '${branchName}')`);
  }

  const originUrl = runOrThrow(runner, "git", ["config", "--get", "remote.origin.url"], {
    cwd: repoRoot
  }).trim();
  const repoSlug = parseGitHubSlug(originUrl);

  const ghAuthStatus = runner.run("gh", ["auth", "status"], { cwd: repoRoot });
  if (ghAuthStatus.status !== 0) {
    throw new ReleaseError("gh is not installed or not authenticated; run `gh auth login`");
  }

  runOrThrow(runner, "git", ["fetch", "origin", "main"], { cwd: repoRoot });
  const localSha = runOrThrow(runner, "git", ["rev-parse", "HEAD"], { cwd: repoRoot }).trim();
  const remoteSha = runOrThrow(runner, "git", ["rev-parse", "origin/main"], {
    cwd: repoRoot
  }).trim();
  if (localSha !== remoteSha) {
    throw new ReleaseError("Local main is not up to date with origin/main; run `git pull`");
  }

  const statusOutput = runOrThrow(runner, "git", ["status", "--porcelain"], { cwd: repoRoot });
  if (statusOutput.trim() !== "") {
    throw new ReleaseError("Worktree and index must be clean before releasing");
  }

  const packageJsonPath = join(repoRoot, "package.json");
  const packageLockPath = join(repoRoot, "package-lock.json");
  const changelogPath = join(repoRoot, "CHANGELOG.md");
  const [packageJson, packageLock, changelog] = await Promise.all([
    readFile(packageJsonPath, "utf-8"),
    readFile(packageLockPath, "utf-8"),
    readFile(changelogPath, "utf-8")
  ]);

  const currentVersion = (JSON.parse(packageJson) as { version?: unknown }).version;
  if (typeof currentVersion !== "string") {
    throw new ReleaseError("package.json has no string version field");
  }
  const nextVersion = computeNextVersion(currentVersion, increment);

  const bumpedPackageJson = bumpPackageJson(packageJson, currentVersion, nextVersion);
  const bumpedPackageLock = bumpPackageLock(packageLock, currentVersion, nextVersion);
  const promoted = promoteChangelog(changelog, nextVersion);

  const branch = `release-v${nextVersion}`;
  const tag = `v${nextVersion}`;
  assertRefAbsent(
    runner,
    `Local branch '${branch}'`,
    "git",
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    repoRoot
  );
  assertRefAbsent(
    runner,
    `Remote branch '${branch}'`,
    "git",
    ["ls-remote", "--exit-code", "--heads", "origin", branch],
    repoRoot
  );
  assertRefAbsent(
    runner,
    `Local tag '${tag}'`,
    "git",
    ["show-ref", "--verify", "--quiet", `refs/tags/${tag}`],
    repoRoot
  );
  assertRefAbsent(
    runner,
    `Remote tag '${tag}'`,
    "git",
    ["ls-remote", "--exit-code", "--tags", "origin", tag],
    repoRoot
  );

  const worktreePath = join(home, ".worktrees", `${basename(repoRoot)}-release-v${nextVersion}`);
  if (await pathExists(worktreePath)) {
    throw new ReleaseError(`Worktree path already exists: ${worktreePath}`);
  }

  return {
    repoRoot,
    repoSlug,
    currentVersion,
    nextVersion,
    branch,
    worktreePath,
    packageJson: bumpedPackageJson,
    packageLock: bumpedPackageLock,
    promoted
  };
}

function buildPrBody(nextVersion: string, notes: string): string {
  return [
    `Prepares the \`v${nextVersion}\` release per [RELEASING.md](./RELEASING.md).`,
    "",
    "## Release notes",
    "",
    notes,
    "",
    "## Next steps",
    "",
    "After this PR merges, tag the merge commit and push it to start the release pipeline:",
    "",
    "```sh",
    "git fetch origin main",
    `git tag -a v${nextVersion} <release-pr-merge-sha> -m "Release v${nextVersion}"`,
    `git push origin v${nextVersion}`,
    "```"
  ].join("\n");
}

/**
 * Prepares a release pull request: validates repository state, computes the next version, and
 * creates a `release-vX.Y.Z` worktree/branch with the three release-metadata files updated,
 * committed, pushed, and opened as a PR against `main`.
 *
 * @param args - Positional CLI arguments (e.g. `["minor"]`); see {@link parseIncrement}.
 * @param deps - Injectable runner and paths; see {@link ReleaseDeps}.
 */
export async function prepareRelease(
  args: readonly string[],
  deps: ReleaseDeps
): Promise<ReleaseResult> {
  const increment = parseIncrement(args);
  const staged = await preflight(increment, deps);
  const { runner } = deps;

  await mkdir(join(deps.home ?? homedir(), ".worktrees"), { recursive: true });
  runOrThrow(
    runner,
    "git",
    ["worktree", "add", staged.worktreePath, "-b", staged.branch, "origin/main"],
    { cwd: staged.repoRoot }
  );

  await Promise.all([
    writeFile(join(staged.worktreePath, "package.json"), staged.packageJson),
    writeFile(join(staged.worktreePath, "package-lock.json"), staged.packageLock),
    writeFile(join(staged.worktreePath, "CHANGELOG.md"), staged.promoted.content)
  ]);

  const commitMessage = `Release v${staged.nextVersion}`;
  runOrThrow(runner, "git", ["add", "package.json", "package-lock.json", "CHANGELOG.md"], {
    cwd: staged.worktreePath
  });
  runOrThrow(runner, "git", ["commit", "-m", commitMessage], { cwd: staged.worktreePath });
  runOrThrow(runner, "git", ["push", "-u", "origin", staged.branch], { cwd: staged.worktreePath });

  const prOutput = runOrThrow(
    runner,
    "gh",
    [
      "pr",
      "create",
      "--repo",
      staged.repoSlug,
      "--base",
      "main",
      "--head",
      staged.branch,
      "--title",
      commitMessage,
      "--body",
      buildPrBody(staged.nextVersion, staged.promoted.notes)
    ],
    { cwd: staged.worktreePath }
  );
  const prUrlMatch = /https:\/\/\S+/.exec(prOutput);
  if (!prUrlMatch) {
    throw new ReleaseError(`Could not find a PR URL in gh output: ${prOutput.trim()}`);
  }

  return {
    version: staged.nextVersion,
    branch: staged.branch,
    worktreePath: staged.worktreePath,
    prUrl: prUrlMatch[0].trim()
  };
}

async function main(): Promise<void> {
  try {
    const result = await prepareRelease(process.argv.slice(2), { runner: createCommandRunner() });
    process.stdout.write(
      `Prepared release v${result.version} on branch ${result.branch}\n`
        + `Worktree: ${result.worktreePath}\n`
        + `Pull request: ${result.prUrl}\n`
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
