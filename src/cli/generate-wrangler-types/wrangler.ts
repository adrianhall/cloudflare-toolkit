// Wrangler CLI adapter for the `generate-wrangler-types` CLI (docs/SPECv2.md §5.7, §5.9). Ported
// from adrianhall/cloudflare-scripts's `src/cli/generate-types/wrangler.ts` (same author, MIT —
// see docs/SPECv2.md §10; source repo is read-only and not modified by this port). Wraps the
// execution of `npx wrangler types` behind the {@link WranglerRunner} interface so that tests can
// substitute a stub without spawning a real process.
//
// The real implementation spawns `npx wrangler types <outputPath> [extraArgs]` in the given
// working directory and captures stdout/stderr for logging. `shell: true` is required on Windows
// where `npx` is a `.cmd` file.

import { spawn } from "node:child_process";
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
  options: { cwd: string; shell: boolean }
) => Promise<WranglerResult>;

// ---------------------------------------------------------------------------
// Default real implementation
// ---------------------------------------------------------------------------

/**
 * The default {@link ExecRunner} that spawns a real child process.
 *
 * Captures stdout and stderr as strings. Uses `shell: true` for Windows compatibility (npx is a
 * .cmd file on Windows).
 *
 * Exported for direct testing of the real spawn path.
 *
 * @param command - The executable to spawn (always `"npx"` in practice).
 * @param args - Arguments passed to `command`.
 * @param options - Options forwarded to `node:child_process`'s `spawn`.
 * @param options.cwd - Working directory for the spawned process.
 * @param options.shell - Whether to run the command through a shell (required on Windows).
 * @returns The process result including exit code and captured output.
 * @throws If the process cannot be spawned (e.g. ENOENT).
 */
export async function defaultExecRunner(
  command: string,
  args: string[],
  options: { cwd: string; shell: boolean }
): Promise<WranglerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell,
      stdio: ["ignore", "pipe", "pipe"]
    });

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
 *   Node.js `child_process.spawn` wrapper is used. Inject a stub in tests.
 * @returns A {@link WranglerRunner} implementation.
 */
export function createWranglerRunner(execRunner?: ExecRunner): WranglerRunner {
  const exec = execRunner ?? defaultExecRunner;

  return {
    async runTypes(outputPath: string, extraArgs: string[], cwd: string): Promise<WranglerResult> {
      const args = ["wrangler", "types", outputPath, ...extraArgs];
      return exec("npx", args, { cwd, shell: true });
    }
  };
}
