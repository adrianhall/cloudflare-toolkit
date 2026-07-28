/**
 * @file Opt-in, end-to-end live test for the `empty-r2-bucket` production adapter.
 *
 * This test talks to real Cloudflare infrastructure and is never run as part of `npm test`,
 * `npm run test:coverage`, or CI (see `test/live/vitest.config.ts`). It requires explicit opt-in
 * via `RUN_LIVE_R2_TESTS=1` plus `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (scoped to at
 * least `Workers R2 Storage Write`), and is invoked with `npm run test:live:r2`.
 *
 * Credentials are loaded from a `.env` file at the **repository root** (gitignored - never
 * commit it) via `dotenv`. `dotenv.config()` does not override variables already present in the
 * process environment, matching the precedence rule used everywhere else in this toolkit
 * (`src/cli/internal/utils.ts`'s `createEnvLoader`) - real exported env vars always win:
 *
 * ```sh
 * # .env (repo root)
 * RUN_LIVE_R2_TESTS=1
 * CLOUDFLARE_ACCOUNT_ID=...
 * CLOUDFLARE_API_TOKEN=...
 * ```
 *
 * It creates a uniquely named, disposable bucket; uploads a handful of objects via `wrangler r2
 * object put --remote` (the production `DELETE .../objects?prefix=` endpoint is not in the public
 * REST reference, so bucket/object lifecycle setup uses the documented `wrangler` CLI instead);
 * exercises the toolkit's own `createRemoteR2Cleaner` adapter end to end; and deletes the bucket
 * in a `finally` block regardless of outcome.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { config as loadDotenv } from "dotenv";
import { describe, expect, it } from "vitest";
import { createRemoteR2Cleaner } from "../../src/cli/internal/cloudflare.js";
import { createLogger } from "../../src/cli/internal/logger.js";

// Loads repo-root .env into process.env, without overriding already-exported values.
loadDotenv();

const execFileAsync = promisify(execFile);

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const enabled = process.env.RUN_LIVE_R2_TESTS === "1" && Boolean(accountId) && Boolean(apiToken);

async function wrangler(...args: string[]): Promise<void> {
  await execFileAsync("npx", ["wrangler", ...args], {
    env: { ...process.env, CLOUDFLARE_API_TOKEN: apiToken }
  });
}

describe.skipIf(!enabled)("empty-r2-bucket live production adapter", () => {
  it("empties a real, disposable R2 bucket end to end", async () => {
    const bucketName = `toolkit-live-r2-${Date.now()}`;
    const logger = createLogger({ level: "debug" });
    const cleaner = createRemoteR2Cleaner(logger);
    const target = { bucketName, accountId: accountId!, apiToken: apiToken! };

    await wrangler("r2", "bucket", "create", bucketName);
    try {
      const dir = await mkdtemp(join(tmpdir(), "toolkit-live-r2-"));
      try {
        for (let i = 0; i < 3; i++) {
          const file = join(dir, `object-${i}.txt`);
          await writeFile(file, `live test object ${i}\n`);
          await wrangler(
            "r2",
            "object",
            "put",
            `${bucketName}/object-${i}.txt`,
            "--file",
            file,
            "--remote"
          );
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }

      expect(await cleaner.hasObjects(target)).toBe(true);
      await cleaner.empty(target);
      expect(await cleaner.hasObjects(target)).toBe(false);
    } finally {
      await wrangler("r2", "bucket", "delete", bucketName);
    }
  });
});
