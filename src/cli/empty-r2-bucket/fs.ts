/** @file Real filesystem adapter for `empty-r2-bucket`. */
import { stat } from "node:fs/promises";
import type { FileSystem } from "./types.js";

/** Creates the real command filesystem adapter. */
export function createFileSystem(): FileSystem {
  return {
    async directoryExists(path) {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    }
  };
}
