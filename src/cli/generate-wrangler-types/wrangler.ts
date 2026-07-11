/**
 * @file A Wrangler CLI adapter for the `generate-wrangler-types` CLI. Wraps the execution of
 * `npx wrangler types` behind the {@link WranglerRunner} interface so that tests can substitute
 * a stub without spawning a real process.
 *
 * The real implementation spawns `npx wrangler types <outputPath> [extraArgs]` in the given
 * working directory and captures stdout/stderr for logging.
 *
 * `outputPath` (attacker-influenceable via `-o/--output`) and `extraArgs` (everything after a
 * `--` separator, forwarded verbatim) are never passed to a shell for interpretation — see
 * SEC-002 (https://github.com/adrianhall/cloudflare-toolkit/issues/47). Process spawning goes
 * through `cross-spawn` instead of `node:child_process.spawn`'s own `shell: true` option: on
 * POSIX it spawns the target binary directly with no shell involved at all, and on Windows it
 * resolves the `npx`/`wrangler` shim's actual `.cmd` file and safely quotes each argument for
 * `cmd.exe` itself, rather than handing it a single, unescaped, attacker-influenceable command
 * line. A value like `--output "x;rm -rf ~"` is therefore passed through as one literal argv
 * element, not interpreted as shell syntax.
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import spawn from "cross-spawn";
import type { WranglerResult, WranglerRunner } from "./types.js";

// ---------------------------------------------------------------------------
// ExecRunner abstraction
// ---------------------------------------------------------------------------

/**
 * A function that spawns a child process and returns its result. Injectable so tests can stub
 * process execution without real spawning.
 */
export type ExecRunner = (
  command: string,
  args: string[],
  options: { cwd: string }
) => Promise<WranglerResult>;

// ---------------------------------------------------------------------------
// Default real implementation
// ---------------------------------------------------------------------------

/**
 * The default {@link ExecRunner} that spawns a real child process via `cross-spawn`.
 *
 * Captures stdout and stderr as strings. `cross-spawn` resolves Windows `.cmd`/`.bat` shims
 * (e.g. `npx.cmd`) and safely quotes arguments for `cmd.exe` when unavoidable, without ever
 * handing `command`/`args` to a shell as an unescaped, concatenated string (SEC-002).
 *
 * Exported for direct testing of the real spawn path.
 *
 * @param command - The executable to spawn (always `"npx"` in practice).
 * @param args - Arguments passed to `command`.
 * @param options - Options forwarded to `cross-spawn`.
 * @param options.cwd - Working directory for the spawned process.
 * @returns The process result including exit code and captured output.
 * @throws If the process cannot be spawned (e.g. ENOENT).
 */
export async function defaultExecRunner(
  command: string,
  args: string[],
  options: { cwd: string }
): Promise<WranglerResult> {
  return new Promise((resolve, reject) => {
    // `cross-spawn`'s type declarations expose the generic `child_process.SpawnOptions`
    // signature rather than Node's own stdio-tuple-narrowed overloads, so TypeScript sees
    // `stdout`/`stderr` below as possibly `null`. The `["ignore", "pipe", "pipe"]` tuple
    // guarantees both are real `Readable` streams at runtime — Node's own `spawn`
    // implementation (which `cross-spawn` delegates to) never omits a stream for a `"pipe"`
    // stdio element — so this cast restores that guarantee for the type checker.
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    }) as ChildProcessWithoutNullStreams;

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: Error) => {
      reject(err);
    });

    child.on("close", (code: number | null) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a {@link WranglerRunner} that executes `npx wrangler types` as a real child process.
 *
 * @param execRunner - Optional override for the process spawner. When omitted, the default
 *   `cross-spawn`-backed wrapper is used. Inject a stub in tests.
 * @returns A {@link WranglerRunner} implementation.
 */
export function createWranglerRunner(execRunner?: ExecRunner): WranglerRunner {
  const exec = execRunner ?? defaultExecRunner;

  return {
    async runTypes(outputPath: string, extraArgs: string[], cwd: string): Promise<WranglerResult> {
      const args = ["wrangler", "types", outputPath, ...extraArgs];
      return exec("npx", args, { cwd });
    }
  };
}
