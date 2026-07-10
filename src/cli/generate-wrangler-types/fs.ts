/**
 * @file A Node.js filesystem adapter for the `generate-wrangler-types` CLI. Wraps
 * `node:fs/promises` behind the {@link FileSystem} interface so that file I/O can be swapped for
 * an in-memory stub in unit tests without mocking the built-in module directly.
 */
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import type { FileSystem } from "./types.js";

/**
 * Creates a {@link FileSystem} backed by Node's `fs/promises` module.
 *
 * `fileExists` uses `access(F_OK)` and returns `true` for any accessible path.
 * `getModifiedTime` uses `stat().mtimeMs` to retrieve the last-modified time.
 *
 * @returns A {@link FileSystem} implementation that queries real files.
 */
export function createFileSystem(): FileSystem {
  return {
    async fileExists(path: string): Promise<boolean> {
      try {
        await access(path, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },

    async getModifiedTime(path: string): Promise<number> {
      const s = await stat(path);
      return s.mtimeMs;
    }
  };
}
