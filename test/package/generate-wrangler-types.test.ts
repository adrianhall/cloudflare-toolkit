import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const CLI_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../dist/cli/generate-wrangler-types/index.js"
);

/**
 * Runs the built CLI binary via `node` and captures its result without throwing on a non-zero
 * exit code (unlike `execFile`'s default promisified behavior).
 *
 * @param args - CLI arguments (excluding `node`/script path).
 * @param cwd - Working directory for the spawned process.
 * @returns The captured exit code, stdout, and stderr.
 */
async function runCli(
  args: string[],
  cwd: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [CLI_PATH, ...args], { cwd });
    return { exitCode: 0, stdout, stderr };
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("dist cli/generate-wrangler-types/index.js — built artifact smoke test", () => {
  it("--help exits 0 and prints the new bin name in the banner", async () => {
    const { exitCode, stdout } = await runCli(["--help"], process.cwd());
    expect(exitCode).toBe(0);
    expect(stdout).toContain("generate-wrangler-types");
  });

  it("--version exits 0 and prints a non-empty version string", async () => {
    const { exitCode, stdout } = await runCli(["--version"], process.cwd());
    expect(exitCode).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it("--verbose and --quiet together exit 6 (argument error)", async () => {
    const { exitCode } = await runCli(["--verbose", "--quiet"], process.cwd());
    expect(exitCode).toBe(6);
  });

  it("exits 1 when wrangler.jsonc is not found in the working directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "generate-wrangler-types-package-test-"));
    try {
      const { exitCode, stderr } = await runCli([], dir);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("wrangler.jsonc");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
