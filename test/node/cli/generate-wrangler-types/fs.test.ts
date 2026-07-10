// Tests for the `generate-wrangler-types` filesystem adapter (docs/SPECv2.md §5.7, §7.2, §7.4).
// Ported from adrianhall/cloudflare-scripts's `src/cli/generate-types/__tests__/fs.test.ts` (same
// author, MIT — see docs/SPECv2.md §10) — only the import path changed. These tests use real
// files in a temporary directory to verify that `createFileSystem` correctly wraps
// `node:fs/promises`.
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileSystem } from "../../../../src/cli/generate-wrangler-types/fs.js";

describe("createFileSystem", () => {
  let dir: string;
  const fs = createFileSystem();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "generate-wrangler-types-fs-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // fileExists
  // -------------------------------------------------------------------------

  describe("fileExists", () => {
    it("returns true for an existing file", async () => {
      const path = join(dir, "existing.txt");
      await writeFile(path, "content", "utf-8");
      expect(await fs.fileExists(path)).toBe(true);
    });

    it("returns false for a missing file", async () => {
      const path = join(dir, "missing.txt");
      expect(await fs.fileExists(path)).toBe(false);
    });

    it("returns true for an existing directory", async () => {
      // access(F_OK) returns true for directories too
      expect(await fs.fileExists(dir)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getModifiedTime
  // -------------------------------------------------------------------------

  describe("getModifiedTime", () => {
    it("returns the mtimeMs of an existing file", async () => {
      const path = join(dir, "file.txt");
      await writeFile(path, "hello", "utf-8");
      const mtime = await fs.getModifiedTime(path);
      expect(typeof mtime).toBe("number");
      expect(mtime).toBeGreaterThan(0);
    });

    it("returns a newer mtime after the file is updated", async () => {
      const path = join(dir, "file.txt");
      await writeFile(path, "v1", "utf-8");
      const mtime1 = await fs.getModifiedTime(path);

      // Artificially set mtime 1 second in the past, then update the file.
      const pastDate = new Date(Date.now() - 2000);
      await utimes(path, pastDate, pastDate);
      const oldMtime = await fs.getModifiedTime(path);

      await writeFile(path, "v2", "utf-8");
      const mtime2 = await fs.getModifiedTime(path);

      expect(mtime2).toBeGreaterThanOrEqual(mtime1);
      expect(mtime2).toBeGreaterThan(oldMtime);
    });

    it("throws for a missing file", async () => {
      const path = join(dir, "missing.txt");
      await expect(fs.getModifiedTime(path)).rejects.toThrow();
    });
  });
});
