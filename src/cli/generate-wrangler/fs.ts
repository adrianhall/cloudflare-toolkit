/** @file Real filesystem adapter for `generate-wrangler`. */
import { constants } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import type { FileSystem } from "./types.js";

/** Creates the real command filesystem adapter. */
export function createFileSystem(): FileSystem {
  return {
    readFile: (path) => readFile(path, "utf-8"),
    writeFile: (path, content) => writeFile(path, content, "utf-8"),
    async fileExists(path) {
      try {
        await access(path, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    async directoryExists(path) {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    }
  };
}
