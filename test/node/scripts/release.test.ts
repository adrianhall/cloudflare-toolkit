import { mkdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner, ReleaseIncrement } from "../../../scripts/release.js";
import {
  ReleaseError,
  bumpPackageJson,
  bumpPackageLock,
  computeNextVersion,
  createCommandRunner,
  parseGitHubSlug,
  parseIncrement,
  prepareRelease,
  promoteChangelog
} from "../../../scripts/release.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PACKAGE_JSON_FIXTURE = `{
  "name": "@adrianhall/cloudflare-toolkit",
  "version": "2.2.1",
  "description": "test fixture",
  "license": "MIT"
}
`;

// Includes another package pinned to the same version as the root package, to prove the bump
// only ever touches the packages[""] entry and never a coincidentally-matching sibling.
const PACKAGE_LOCK_FIXTURE = `{
  "name": "@adrianhall/cloudflare-toolkit",
  "version": "2.2.1",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "@adrianhall/cloudflare-toolkit",
      "version": "2.2.1",
      "license": "MIT"
    },
    "node_modules/example": {
      "version": "2.2.1",
      "resolved": "https://example.com/example.tgz"
    }
  }
}
`;

const CHANGELOG_FIXTURE = `# @adrianhall/cloudflare-toolkit

## Next release

- abc1234 (minor): Something new.

## 2.2.1

- def5678 (patch): Something else.
`;

// ---------------------------------------------------------------------------
// Temp-directory bookkeeping — every test creates its own sandbox and this file cleans up all
// of them afterward, even if an assertion throws mid-test.
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRepoFixture(): Promise<string> {
  const repoRoot = await makeTempDir("release-repo-");
  await Promise.all([
    writeFile(join(repoRoot, "package.json"), PACKAGE_JSON_FIXTURE),
    writeFile(join(repoRoot, "package-lock.json"), PACKAGE_LOCK_FIXTURE),
    writeFile(join(repoRoot, "CHANGELOG.md"), CHANGELOG_FIXTURE)
  ]);
  return repoRoot;
}

// ---------------------------------------------------------------------------
// Fake CommandRunner — every git/gh invocation for the "2.2.1" fixture above, incrementing
// "minor" (-> "2.3.0"), with per-key overrides for provoking specific preflight failures.
// ---------------------------------------------------------------------------

interface RecordedCall {
  command: string;
  args: string[];
  cwd?: string;
}

function commandKey(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

function ok(stdout = ""): CommandResult {
  return { status: 0, stdout, stderr: "" };
}

function fail(status = 1, stderr = ""): CommandResult {
  return { status, stdout: "", stderr };
}

interface FakeRunnerConfig {
  repoRoot: string;
  branch: string;
  tag: string;
  originUrl?: string;
  sha?: string;
  prUrl?: string;
  overrides?: Record<string, CommandResult>;
}

const DEFAULT_ORIGIN_URL = "https://github.com/adrianhall/cloudflare-toolkit.git";
const DEFAULT_SHA = "1111111111111111111111111111111111111111";
const DEFAULT_PR_URL = "https://github.com/adrianhall/cloudflare-toolkit/pull/999";

function makeFakeRunner(config: FakeRunnerConfig): {
  runner: CommandRunner;
  calls: RecordedCall[];
} {
  const originUrl = config.originUrl ?? DEFAULT_ORIGIN_URL;
  const sha = config.sha ?? DEFAULT_SHA;
  const prUrl = config.prUrl ?? DEFAULT_PR_URL;
  const overrides = config.overrides ?? {};
  const calls: RecordedCall[] = [];

  const defaults: Record<string, CommandResult> = {
    [commandKey("git", ["rev-parse", "--show-toplevel"])]: ok(`${config.repoRoot}\n`),
    [commandKey("git", ["rev-parse", "--abbrev-ref", "HEAD"])]: ok("main\n"),
    [commandKey("git", ["config", "--get", "remote.origin.url"])]: ok(`${originUrl}\n`),
    [commandKey("gh", ["auth", "status"])]: ok(""),
    [commandKey("git", ["fetch", "origin", "main"])]: ok(""),
    [commandKey("git", ["rev-parse", "HEAD"])]: ok(`${sha}\n`),
    [commandKey("git", ["rev-parse", "origin/main"])]: ok(`${sha}\n`),
    [commandKey("git", ["status", "--porcelain"])]: ok(""),
    [commandKey("git", ["show-ref", "--verify", "--quiet", `refs/heads/${config.branch}`])]:
      fail(1),
    [commandKey("git", ["ls-remote", "--exit-code", "--heads", "origin", config.branch])]: fail(2),
    [commandKey("git", ["show-ref", "--verify", "--quiet", `refs/tags/${config.tag}`])]: fail(1),
    [commandKey("git", ["ls-remote", "--exit-code", "--tags", "origin", config.tag])]: fail(2)
  };

  const runner: CommandRunner = {
    run(command, args, options) {
      calls.push({ command, args: [...args], cwd: options?.cwd });

      // Real `git worktree add <path> ...` creates the directory; simulate that side effect so
      // the subsequent writeFile calls in prepareRelease succeed against this fake.
      if (command === "git" && args[0] === "worktree" && args[1] === "add") {
        mkdirSync(args[2], { recursive: true });
        return ok("");
      }
      if (command === "gh" && args[0] === "pr" && args[1] === "create") {
        return overrides["gh pr create"] ?? ok(`${prUrl}\n`);
      }

      const key = commandKey(command, args);
      return overrides[key] ?? defaults[key] ?? ok("");
    }
  };
  return { runner, calls };
}

// ---------------------------------------------------------------------------
// parseIncrement
// ---------------------------------------------------------------------------

describe("parseIncrement", () => {
  it.each(["major", "minor", "patch"] satisfies ReleaseIncrement[])("accepts '%s'", (value) => {
    expect(parseIncrement([value])).toBe(value);
  });

  it("throws with no arguments", () => {
    expect(() => parseIncrement([])).toThrow(ReleaseError);
    expect(() => parseIncrement([])).toThrow(/Usage: node scripts\/release\.ts/);
  });

  it("throws with more than one argument", () => {
    expect(() => parseIncrement(["minor", "extra"])).toThrow(ReleaseError);
  });

  it("throws on an unrecognized increment", () => {
    expect(() => parseIncrement(["major.minor"])).toThrow(/must be exactly one of/);
  });
});

// ---------------------------------------------------------------------------
// computeNextVersion
// ---------------------------------------------------------------------------

describe("computeNextVersion", () => {
  it("increments major/minor/patch", () => {
    expect(computeNextVersion("2.2.1", "major")).toBe("3.0.0");
    expect(computeNextVersion("2.2.1", "minor")).toBe("2.3.0");
    expect(computeNextVersion("2.2.1", "patch")).toBe("2.2.2");
  });

  it.each(["v2.2.1", "2.2", "02.2.1", "2.2.1-beta.1", "2.2.1+build.1", "not-a-version"])(
    "rejects non-strict-stable current version '%s'",
    (current) => {
      expect(() => computeNextVersion(current, "patch")).toThrow(ReleaseError);
    }
  );

  it("rejects an unrecognized increment", () => {
    expect(() => computeNextVersion("2.2.1", "bogus" as ReleaseIncrement)).toThrow(
      /Could not compute a valid/
    );
  });
});

// ---------------------------------------------------------------------------
// bumpPackageJson
// ---------------------------------------------------------------------------

describe("bumpPackageJson", () => {
  it("updates only the version field, preserving everything else byte-for-byte", () => {
    const updated = bumpPackageJson(PACKAGE_JSON_FIXTURE, "2.2.1", "2.3.0");
    expect(updated).toBe(PACKAGE_JSON_FIXTURE.replace('"version": "2.2.1"', '"version": "2.3.0"'));
    expect(JSON.parse(updated)).toMatchObject({ version: "2.3.0" });
  });

  it("throws when the current version does not match", () => {
    expect(() => bumpPackageJson(PACKAGE_JSON_FIXTURE, "9.9.9", "2.3.0")).toThrow(
      /expected '9\.9\.9'/
    );
  });

  it('throws when there is no top-level "version" field', () => {
    expect(() => bumpPackageJson('{\n  "name": "x"\n}', "2.2.1", "2.3.0")).toThrow(
      /has no top-level "version" field/
    );
  });
});

// ---------------------------------------------------------------------------
// bumpPackageLock
// ---------------------------------------------------------------------------

describe("bumpPackageLock", () => {
  it('updates the top-level and packages[""] versions only', () => {
    const updated = bumpPackageLock(PACKAGE_LOCK_FIXTURE, "2.2.1", "2.3.0");
    const parsed = JSON.parse(updated) as {
      version: string;
      packages: Record<string, { version: string }>;
    };
    expect(parsed.version).toBe("2.3.0");
    expect(parsed.packages[""].version).toBe("2.3.0");
    // A sibling package coincidentally pinned to the same version string is left untouched.
    expect(parsed.packages["node_modules/example"].version).toBe("2.2.1");
  });

  it("throws when the current version does not match", () => {
    expect(() => bumpPackageLock(PACKAGE_LOCK_FIXTURE, "9.9.9", "2.3.0")).toThrow(
      /expected '9\.9\.9'/
    );
  });

  it('throws when there is no packages[""] entry', () => {
    const noPackages = '{\n  "version": "2.2.1",\n  "lockfileVersion": 3\n}';
    expect(() => bumpPackageLock(noPackages, "2.2.1", "2.3.0")).toThrow(
      /has no packages\[""\] entry/
    );
  });

  it('throws when packages[""] has no "version" field', () => {
    const malformed = `{
  "version": "2.2.1",
  "packages": {
    "": {
      "name": "@adrianhall/cloudflare-toolkit"
    },
    "node_modules/example": {
      "version": "2.2.1"
    }
  }
}
`;
    expect(() => bumpPackageLock(malformed, "2.2.1", "2.3.0")).toThrow(
      /packages\[""\] has no "version" field/
    );
  });

  it('throws when packages[""] version does not match the expected current version', () => {
    const mismatched = PACKAGE_LOCK_FIXTURE.replace(
      '"": {\n      "name": "@adrianhall/cloudflare-toolkit",\n      "version": "2.2.1"',
      '"": {\n      "name": "@adrianhall/cloudflare-toolkit",\n      "version": "9.9.9"'
    );
    expect(() => bumpPackageLock(mismatched, "2.2.1", "2.3.0")).toThrow(
      /packages\[""\] version is '9\.9\.9'/
    );
  });
});

// ---------------------------------------------------------------------------
// promoteChangelog
// ---------------------------------------------------------------------------

describe("promoteChangelog", () => {
  it("promotes Next release to the version heading and inserts a new empty Next release", () => {
    const { content, notes } = promoteChangelog(CHANGELOG_FIXTURE, "2.3.0");
    expect(notes).toBe("- abc1234 (minor): Something new.");
    expect(content).toBe(
      `# @adrianhall/cloudflare-toolkit

## Next release

## 2.3.0

- abc1234 (minor): Something new.

## 2.2.1

- def5678 (patch): Something else.
`
    );
  });

  it("throws when there is no Next release heading", () => {
    expect(() => promoteChangelog("# Title\n\n## 1.0.0\n\n- entry\n", "2.3.0")).toThrow(
      /has no "## Next release" heading/
    );
  });

  it("throws when the Next release section has no notes", () => {
    const empty = "# Title\n\n## Next release\n\n## 1.0.0\n\n- entry\n";
    expect(() => promoteChangelog(empty, "2.3.0")).toThrow(/has no release notes to promote/);
  });

  it("promotes a Next release section that is the last section in the file", () => {
    const trailing = "# Title\n\n## Next release\n\n- only entry\n";
    const { content, notes } = promoteChangelog(trailing, "1.0.0");
    expect(notes).toBe("- only entry");
    expect(content).toBe("# Title\n\n## Next release\n\n## 1.0.0\n\n- only entry\n");
  });
});

// ---------------------------------------------------------------------------
// parseGitHubSlug
// ---------------------------------------------------------------------------

describe("parseGitHubSlug", () => {
  it("parses an https remote URL", () => {
    expect(parseGitHubSlug("https://github.com/adrianhall/cloudflare-toolkit.git")).toBe(
      "adrianhall/cloudflare-toolkit"
    );
  });

  it("parses an https remote URL without a .git suffix", () => {
    expect(parseGitHubSlug("https://github.com/adrianhall/cloudflare-toolkit")).toBe(
      "adrianhall/cloudflare-toolkit"
    );
  });

  it("parses an ssh remote URL", () => {
    expect(parseGitHubSlug("git@github.com:adrianhall/cloudflare-toolkit.git")).toBe(
      "adrianhall/cloudflare-toolkit"
    );
  });

  it("throws on an unrecognized remote URL form", () => {
    expect(() => parseGitHubSlug("/local/path/to/origin.git")).toThrow(
      /Could not parse a GitHub owner\/repo slug/
    );
  });
});

// ---------------------------------------------------------------------------
// createCommandRunner (the real spawnSync-backed runner)
// ---------------------------------------------------------------------------

describe("createCommandRunner", () => {
  it("runs a real command and captures its output", () => {
    const runner = createCommandRunner();
    const result = runner.run("git", ["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/git version/);
  });

  it("throws a ReleaseError when the command cannot be spawned", () => {
    const runner = createCommandRunner();
    expect(() => runner.run("this-command-does-not-exist-anywhere", [])).toThrow(ReleaseError);
  });
});

// ---------------------------------------------------------------------------
// prepareRelease — preflight failures (fully faked runner; no mutating command may run)
// ---------------------------------------------------------------------------

const BRANCH = "release-v2.3.0";
const TAG = "v2.3.0";

function assertNoMutation(calls: RecordedCall[]): void {
  const mutating = calls.filter(
    (call) =>
      (call.command === "git" && call.args[0] === "worktree")
      || (call.command === "git" && ["add", "commit", "push"].includes(call.args[0]))
      || (call.command === "gh" && call.args[0] === "pr")
  );
  expect(mutating).toEqual([]);
}

describe("prepareRelease preflight failures", () => {
  it("rejects an invalid increment before running any command", async () => {
    const repoRoot = await makeRepoFixture();
    const { runner, calls } = makeFakeRunner({ repoRoot, branch: BRANCH, tag: TAG });
    await expect(prepareRelease(["bogus"], { runner, cwd: repoRoot })).rejects.toThrow(
      ReleaseError
    );
    expect(calls).toEqual([]);
  });

  it("rejects when not on main", async () => {
    const repoRoot = await makeRepoFixture();
    const { runner, calls } = makeFakeRunner({
      repoRoot,
      branch: BRANCH,
      tag: TAG,
      overrides: { [commandKey("git", ["rev-parse", "--abbrev-ref", "HEAD"])]: ok("feature\n") }
    });
    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot })).rejects.toThrow(
      /Must be run on 'main'/
    );
    assertNoMutation(calls);
  });

  it("rejects when origin is not configured", async () => {
    const repoRoot = await makeRepoFixture();
    const { runner, calls } = makeFakeRunner({
      repoRoot,
      branch: BRANCH,
      tag: TAG,
      overrides: {
        [commandKey("git", ["config", "--get", "remote.origin.url"])]: fail(1)
      }
    });
    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot })).rejects.toThrow(
      ReleaseError
    );
    assertNoMutation(calls);
  });

  it("rejects when gh is not installed or not authenticated", async () => {
    const repoRoot = await makeRepoFixture();
    const { runner, calls } = makeFakeRunner({
      repoRoot,
      branch: BRANCH,
      tag: TAG,
      overrides: { [commandKey("gh", ["auth", "status"])]: fail(1) }
    });
    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot })).rejects.toThrow(
      /gh is not installed or not authenticated/
    );
    assertNoMutation(calls);
  });

  it("rejects when local main is behind origin/main", async () => {
    const repoRoot = await makeRepoFixture();
    const { runner, calls } = makeFakeRunner({
      repoRoot,
      branch: BRANCH,
      tag: TAG,
      overrides: {
        [commandKey("git", ["rev-parse", "HEAD"])]: ok("aaaa\n"),
        [commandKey("git", ["rev-parse", "origin/main"])]: ok("bbbb\n")
      }
    });
    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot })).rejects.toThrow(
      /not up to date with origin\/main/
    );
    assertNoMutation(calls);
  });

  it("rejects a dirty worktree/index", async () => {
    const repoRoot = await makeRepoFixture();
    const { runner, calls } = makeFakeRunner({
      repoRoot,
      branch: BRANCH,
      tag: TAG,
      overrides: {
        [commandKey("git", ["status", "--porcelain"])]: ok(" M package.json\n")
      }
    });
    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot })).rejects.toThrow(
      /must be clean/
    );
    assertNoMutation(calls);
  });

  it("rejects when CHANGELOG.md has no release notes to promote", async () => {
    const repoRoot = await makeRepoFixture();
    await writeFile(
      join(repoRoot, "CHANGELOG.md"),
      "# @adrianhall/cloudflare-toolkit\n\n## Next release\n\n## 2.2.1\n\n- old\n"
    );
    const { runner, calls } = makeFakeRunner({ repoRoot, branch: BRANCH, tag: TAG });
    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot })).rejects.toThrow(
      /has no release notes to promote/
    );
    assertNoMutation(calls);
  });

  it("rejects when the release branch already exists locally", async () => {
    const repoRoot = await makeRepoFixture();
    const { runner, calls } = makeFakeRunner({
      repoRoot,
      branch: BRANCH,
      tag: TAG,
      overrides: {
        [commandKey("git", ["show-ref", "--verify", "--quiet", `refs/heads/${BRANCH}`])]: ok("")
      }
    });
    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot })).rejects.toThrow(
      /Local branch 'release-v2\.3\.0' already exists/
    );
    assertNoMutation(calls);
  });

  it("rejects when the release branch already exists remotely", async () => {
    const repoRoot = await makeRepoFixture();
    const { runner, calls } = makeFakeRunner({
      repoRoot,
      branch: BRANCH,
      tag: TAG,
      overrides: {
        [commandKey("git", ["ls-remote", "--exit-code", "--heads", "origin", BRANCH])]: ok("")
      }
    });
    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot })).rejects.toThrow(
      /Remote branch 'release-v2\.3\.0' already exists/
    );
    assertNoMutation(calls);
  });

  it("rejects when the release tag already exists locally", async () => {
    const repoRoot = await makeRepoFixture();
    const { runner, calls } = makeFakeRunner({
      repoRoot,
      branch: BRANCH,
      tag: TAG,
      overrides: {
        [commandKey("git", ["show-ref", "--verify", "--quiet", `refs/tags/${TAG}`])]: ok("")
      }
    });
    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot })).rejects.toThrow(
      /Local tag 'v2\.3\.0' already exists/
    );
    assertNoMutation(calls);
  });

  it("rejects when the release tag already exists remotely", async () => {
    const repoRoot = await makeRepoFixture();
    const { runner, calls } = makeFakeRunner({
      repoRoot,
      branch: BRANCH,
      tag: TAG,
      overrides: {
        [commandKey("git", ["ls-remote", "--exit-code", "--tags", "origin", TAG])]: ok("")
      }
    });
    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot })).rejects.toThrow(
      /Remote tag 'v2\.3\.0' already exists/
    );
    assertNoMutation(calls);
  });

  it("rejects when the worktree path already exists", async () => {
    const repoRoot = await makeRepoFixture();
    const home = await makeTempDir("release-home-");
    const worktreePath = join(home, ".worktrees", `${basename(repoRoot)}-release-v2.3.0`);
    mkdirSync(worktreePath, { recursive: true });
    const { runner, calls } = makeFakeRunner({ repoRoot, branch: BRANCH, tag: TAG });
    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot, home })).rejects.toThrow(
      /Worktree path already exists/
    );
    assertNoMutation(calls);
  });

  it("throws when a git command fails outright", async () => {
    const repoRoot = await makeRepoFixture();
    const { runner, calls } = makeFakeRunner({
      repoRoot,
      branch: BRANCH,
      tag: TAG,
      overrides: {
        [commandKey("git", ["fetch", "origin", "main"])]: fail(128, "unable to access origin")
      }
    });
    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot })).rejects.toThrow(
      /unable to access origin/
    );
    assertNoMutation(calls);
  });
});

// ---------------------------------------------------------------------------
// prepareRelease — happy path (fully faked runner)
// ---------------------------------------------------------------------------

describe("prepareRelease happy path (faked runner)", () => {
  it("writes updated metadata into a fresh worktree and opens the PR", async () => {
    const repoRoot = await makeRepoFixture();
    const home = await makeTempDir("release-home-");
    const { runner, calls } = makeFakeRunner({ repoRoot, branch: BRANCH, tag: TAG });

    const result = await prepareRelease(["minor"], { runner, cwd: repoRoot, home });

    expect(result.version).toBe("2.3.0");
    expect(result.branch).toBe(BRANCH);
    expect(result.prUrl).toBe(DEFAULT_PR_URL);
    expect(result.worktreePath).toBe(
      join(home, ".worktrees", `${basename(repoRoot)}-release-v2.3.0`)
    );

    const [packageJson, packageLock, changelog] = await Promise.all([
      readFile(join(result.worktreePath, "package.json"), "utf-8"),
      readFile(join(result.worktreePath, "package-lock.json"), "utf-8"),
      readFile(join(result.worktreePath, "CHANGELOG.md"), "utf-8")
    ]);
    expect(JSON.parse(packageJson)).toMatchObject({ version: "2.3.0" });
    const parsedLock = JSON.parse(packageLock) as {
      version: string;
      packages: Record<string, { version: string }>;
    };
    expect(parsedLock.version).toBe("2.3.0");
    expect(parsedLock.packages[""].version).toBe("2.3.0");
    expect(changelog).toContain("## Next release\n\n## 2.3.0\n\n- abc1234 (minor): Something new.");

    const worktreeAddCall = calls.find(
      (call) => call.command === "git" && call.args[0] === "worktree" && call.args[1] === "add"
    );
    expect(worktreeAddCall?.args).toEqual([
      "worktree",
      "add",
      result.worktreePath,
      "-b",
      BRANCH,
      "origin/main"
    ]);

    const commitCall = calls.find((call) => call.command === "git" && call.args[0] === "commit");
    expect(commitCall?.args).toEqual(["commit", "-m", "Release v2.3.0"]);
    expect(commitCall?.cwd).toBe(result.worktreePath);

    const pushCall = calls.find((call) => call.command === "git" && call.args[0] === "push");
    expect(pushCall?.args).toEqual(["push", "-u", "origin", BRANCH]);

    const prCall = calls.find((call) => call.command === "gh" && call.args[0] === "pr");
    expect(prCall?.args.slice(0, 8)).toEqual([
      "pr",
      "create",
      "--repo",
      "adrianhall/cloudflare-toolkit",
      "--base",
      "main",
      "--head",
      BRANCH
    ]);
    const bodyIndex = prCall?.args.indexOf("--body") ?? -1;
    expect(prCall?.args[bodyIndex + 1]).toContain("- abc1234 (minor): Something new.");
  });

  it("throws when gh pr create succeeds but prints no discoverable URL", async () => {
    const repoRoot = await makeRepoFixture();
    const home = await makeTempDir("release-home-");
    const { runner, calls } = makeFakeRunner({
      repoRoot,
      branch: BRANCH,
      tag: TAG,
      overrides: { "gh pr create": ok("no url here\n") }
    });

    await expect(prepareRelease(["minor"], { runner, cwd: repoRoot, home })).rejects.toThrow(
      /Could not find a PR URL/
    );
    expect(calls.some((call) => call.command === "gh" && call.args[0] === "pr")).toBe(true);
  });
});
