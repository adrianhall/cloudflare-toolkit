/**
 * @file Shared type definitions for the `generate-wrangler-types` CLI, used across the
 * filesystem, wrangler, and orchestration layers to keep each module independently testable.
 */

/**
 * The result of executing a `wrangler types` command.
 */
export interface WranglerResult {
  /** The process exit code. `null` means the process was killed by a signal. */
  exitCode: number | null;
  /** Content written to stdout by wrangler. */
  stdout: string;
  /** Content written to stderr by wrangler. */
  stderr: string;
}

/**
 * Abstraction over the Wrangler CLI, injected into the CLI so that tests can supply a stub
 * without spawning a real process.
 */
export interface WranglerRunner {
  /**
   * Invokes `npx wrangler types <outputPath> [extraArgs...]` in `cwd`.
   *
   * @param outputPath - The `.d.ts` output path passed to `wrangler types`.
   * @param extraArgs - Additional arguments forwarded verbatim to wrangler (e.g.
   *   `["--include-runtime=false", "--strict-vars=false"]`).
   * @param cwd - Working directory for the spawned process.
   * @returns The process result including exit code and captured output.
   * @throws If the wrangler binary cannot be executed (e.g. ENOENT).
   */
  runTypes(outputPath: string, extraArgs: string[], cwd: string): Promise<WranglerResult>;
}

/**
 * Thin abstraction over Node's `fs/promises` module, providing only the operations needed by
 * `generate-wrangler-types`: existence checks and modification time retrieval.
 *
 * Using an interface here (rather than importing `fs/promises` directly) allows tests to supply
 * an in-memory stub without mocking the built-in module.
 */
export interface FileSystem {
  /**
   * Returns `true` if the path exists and is accessible.
   *
   * @param path - Path to test.
   * @returns `true` if accessible, `false` otherwise.
   */
  fileExists(path: string): Promise<boolean>;

  /**
   * Returns the last modification time of the file, in milliseconds since the Unix epoch
   * (`stat().mtimeMs`).
   *
   * @param path - Path to stat.
   * @returns Modification time in milliseconds.
   * @throws If the path does not exist or cannot be stat'd.
   */
  getModifiedTime(path: string): Promise<number>;
}
