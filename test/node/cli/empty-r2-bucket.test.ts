/* eslint-disable @typescript-eslint/unbound-method -- Vitest mocks are intentionally extracted for assertions. */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { R2BucketCleaner } from "../../../src/cli/internal/cloudflare.js";
import type { LogSink } from "../../../src/cli/internal/logger.js";
import type { TerraformOutputMap, TerraformRunner } from "../../../src/cli/internal/terraform.js";
import type { EnvLoader, Prompter } from "../../../src/cli/internal/utils.js";
import { DEFAULT_LOCAL_URL, run } from "../../../src/cli/empty-r2-bucket/run.js";

const quietSink: LogSink = vi.fn();
const argv = (...args: string[]) => ["node", "empty-r2-bucket", ...args];
const outputs = (value: TerraformOutputMap): TerraformRunner => ({
  getOutputs: vi.fn().mockResolvedValue(value)
});

function cleaner(hasObjects = true): R2BucketCleaner {
  return {
    hasObjects: vi.fn().mockResolvedValue(hasObjects),
    empty: vi.fn().mockResolvedValue(undefined)
  };
}

function deps() {
  return {
    remoteCleaner: cleaner(),
    localCleaner: cleaner(),
    terraform: outputs({
      account_id: { value: "acct", type: "string", sensitive: false },
      r2_bucket_name: { value: "bucket", type: "string", sensitive: false }
    }),
    prompter: { confirm: vi.fn().mockResolvedValue(true) } as Prompter,
    envLoader: { load: vi.fn().mockResolvedValue(undefined) } as EnvLoader,
    logSink: quietSink
  };
}

describe("empty-r2-bucket", () => {
  beforeEach(() => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    vi.restoreAllMocks();
  });

  it("supports help, version, and unexpected parser failures", async () => {
    expect(await run(argv("--help"), deps())).toBe(0);
    expect(await run(argv("--version"), deps())).toBe(0);
    vi.spyOn(Command.prototype, "parse").mockImplementation(() => {
      throw new TypeError("bad");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await run(argv("bucket", "-a", "a", "-k", "t"), deps())).toBe(99);
  });

  it("rejects unknown options and -v/-q conflicts", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await run(argv("bucket", "--bad"), deps())).toBe(6);
    expect(await run(argv("bucket", "-a", "a", "-k", "t", "-v", "-q"), deps())).toBe(6);
  });

  it.each([
    ["missing bucket-name in standalone mode", ["-a", "a", "-k", "t"]],
    ["terraform and a positional bucket-name together", ["bucket", "-t", "infra"]],
    ["--local without a positional bucket-name", ["--local"]],
    ["--local with --terraform", ["bucket", "--local", "-t", "infra"]],
    ["--local with --account-id", ["bucket", "--local", "-a", "a"]],
    ["--local with --api-token", ["bucket", "--local", "-k", "t"]],
    ["--local with --env-file", ["bucket", "--local", "--env-file", ".env"]],
    ["--local-url without --local", ["bucket", "--local-url", "http://x"]]
  ])("returns exit 6 for %s", async (_name, args) => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await run(argv(...args), deps())).toBe(6);
  });

  it("returns 2 when the env file fails to load", async () => {
    const d = deps();
    vi.mocked(d.envLoader.load).mockRejectedValue(new Error("bad env"));
    expect(await run(argv("bucket", "-a", "a", "-k", "t", "--env-file", ".env"), d)).toBe(2);
    expect(d.remoteCleaner.hasObjects).not.toHaveBeenCalled();
  });

  it("resolves standalone remote credentials from CLI args, env vars, and --env-file", async () => {
    const d = deps();
    vi.mocked(d.remoteCleaner.hasObjects).mockResolvedValue(false);
    expect(await run(argv("bucket", "-a", "a", "-k", "t"), d)).toBe(0);
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    expect(await run(argv("bucket", "--env-file", ".env"), d)).toBe(0);
    expect(d.envLoader.load).toHaveBeenCalledWith(".env");
  });

  it.each([
    ["account id", []],
    ["api token", ["-a", "a"]]
  ])("returns 2 when the %s credential is missing", async (_label, args) => {
    expect(await run(argv("bucket", ...args), deps())).toBe(2);
  });

  it("returns 3 when the initial probe fails", async () => {
    const d = deps();
    vi.mocked(d.remoteCleaner.hasObjects).mockRejectedValue(new Error("probe down"));
    expect(await run(argv("bucket", "-a", "a", "-k", "t"), d)).toBe(3);
    expect(d.prompter.confirm).not.toHaveBeenCalled();
    expect(d.remoteCleaner.empty).not.toHaveBeenCalled();
  });

  it("returns 0 immediately when the bucket is already empty", async () => {
    const d = deps();
    vi.mocked(d.remoteCleaner.hasObjects).mockResolvedValue(false);
    expect(await run(argv("bucket", "-a", "a", "-k", "t"), d)).toBe(0);
    expect(d.prompter.confirm).not.toHaveBeenCalled();
    expect(d.remoteCleaner.empty).not.toHaveBeenCalled();
  });

  it("prompts before deleting and returns 1 when declined", async () => {
    const d = deps();
    vi.mocked(d.prompter.confirm).mockResolvedValue(false);
    expect(await run(argv("bucket", "-a", "a", "-k", "t"), d)).toBe(1);
    expect(d.remoteCleaner.empty).not.toHaveBeenCalled();
  });

  it("bypasses the confirmation prompt with --yes", async () => {
    const d = deps();
    expect(await run(argv("bucket", "-a", "a", "-k", "t", "-y"), d)).toBe(0);
    expect(d.prompter.confirm).not.toHaveBeenCalled();
    expect(d.remoteCleaner.empty).toHaveBeenCalledWith({
      bucketName: "bucket",
      accountId: "a",
      apiToken: "t"
    });
  });

  it("returns 4 when emptying fails", async () => {
    const d = deps();
    vi.mocked(d.remoteCleaner.empty).mockRejectedValue(new Error("empty failed"));
    expect(await run(argv("bucket", "-a", "a", "-k", "t", "-y"), d)).toBe(4);
  });

  it("resolves Terraform outputs into the remote target", async () => {
    const d = deps();
    expect(await run(argv("-t", "infra", "-a", "ignored", "-k", "t", "-y"), d)).toBe(0);
    expect(d.terraform.getOutputs).toHaveBeenCalledWith("infra");
    expect(d.remoteCleaner.empty).toHaveBeenCalledWith({
      bucketName: "bucket",
      accountId: "acct",
      apiToken: "t"
    });
  });

  it("returns 2 when Terraform output reading fails", async () => {
    const d = deps();
    vi.mocked(d.terraform.getOutputs).mockRejectedValue(new Error("terraform down"));
    expect(await run(argv("-t", "infra", "-k", "t"), d)).toBe(2);
  });

  it.each([
    ["missing account_id", {}],
    ["non-string account_id", { account_id: { value: 1, type: "number", sensitive: false } }],
    ["empty account_id", { account_id: { value: "", type: "string", sensitive: false } }]
  ])("returns 2 for %s in Terraform outputs", async (_label, partial) => {
    const d = deps();
    d.terraform = outputs(partial);
    expect(await run(argv("-t", "infra", "-k", "t"), d)).toBe(2);
  });

  it.each([
    ["missing r2_bucket_name", { account_id: { value: "acct", type: "string", sensitive: false } }],
    [
      "non-string r2_bucket_name",
      {
        account_id: { value: "acct", type: "string", sensitive: false },
        r2_bucket_name: { value: 1, type: "number", sensitive: false }
      }
    ],
    [
      "empty r2_bucket_name",
      {
        account_id: { value: "acct", type: "string", sensitive: false },
        r2_bucket_name: { value: "", type: "string", sensitive: false }
      }
    ]
  ])("returns 2 for %s in Terraform outputs", async (_label, partial) => {
    const d = deps();
    d.terraform = outputs(partial);
    expect(await run(argv("-t", "infra", "-k", "t"), d)).toBe(2);
  });

  it("returns 2 when Terraform mode has no API token available", async () => {
    const d = deps();
    expect(await run(argv("-t", "infra"), d)).toBe(2);
  });

  it("uses the default Local Explorer URL and the local cleaner", async () => {
    const d = deps();
    expect(await run(argv("bucket", "--local", "-y"), d)).toBe(0);
    expect(d.localCleaner.hasObjects).toHaveBeenCalledWith({
      bucketName: "bucket",
      localUrl: DEFAULT_LOCAL_URL
    });
    expect(d.remoteCleaner.hasObjects).not.toHaveBeenCalled();
  });

  it("honors --local-url as an override for the Local Explorer base URL", async () => {
    const d = deps();
    const localUrl = "http://localhost:8787/cdn-cgi/explorer/api";
    expect(await run(argv("bucket", "--local", "--local-url", localUrl, "-y"), d)).toBe(0);
    expect(d.localCleaner.empty).toHaveBeenCalledWith({ bucketName: "bucket", localUrl });
  });

  it("never logs the API token", async () => {
    const messages: string[] = [];
    const d = deps();
    d.logSink = (_level, message) => messages.push(message);
    expect(await run(argv("bucket", "-a", "a", "-k", "super-secret-token", "-y", "-v"), d)).toBe(0);
    expect(messages.join("\n")).not.toContain("super-secret-token");
  });

  it("supports quiet and verbose logging levels", async () => {
    const d1 = deps();
    vi.mocked(d1.remoteCleaner.hasObjects).mockResolvedValue(false);
    expect(await run(argv("bucket", "-a", "a", "-k", "t", "-q"), d1)).toBe(0);
    const d2 = deps();
    vi.mocked(d2.remoteCleaner.hasObjects).mockResolvedValue(false);
    expect(await run(argv("bucket", "-a", "a", "-k", "t", "-v"), d2)).toBe(0);
  });

  it("prints the bucket summary before prompting", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const d = deps();
    expect(await run(argv("bucket", "-a", "a", "-k", "t", "-y"), d)).toBe(0);
    expect(write.mock.calls.some(([chunk]) => String(chunk).includes("bucket"))).toBe(true);
  });
});
