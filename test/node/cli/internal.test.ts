import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContainersApi, createRegistryClient } from "../../../src/cli/internal/cloudflare.js";
import { createLogger, type LogSink } from "../../../src/cli/internal/logger.js";
import {
  createTerraformRunner,
  TerraformError,
  type ExecRunner
} from "../../../src/cli/internal/terraform.js";
import {
  createEnvLoader,
  createPrompter,
  getErrorMessage,
  getValueDefault
} from "../../../src/cli/internal/utils.js";

const sink: LogSink = vi.fn();
const logger = () => createLogger({ level: "debug", sink });
const response = (status: number, body: unknown = {}, headers?: Record<string, string>): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(headers)
  }) as unknown as Response;

afterEach(() => vi.restoreAllMocks());

describe("CLI internal utilities", () => {
  it("formats arbitrary errors and preserves falsy fallback behavior", () => {
    expect(getErrorMessage(new Error("bad"))).toBe("bad");
    expect(getErrorMessage("bad")).toBe("bad");
    expect(getValueDefault("value", "fallback")).toBe("value");
    expect(getValueDefault("", "fallback")).toBe("fallback");
  });

  it("loads dotenv values without replacing existing values", async () => {
    const dir = await mkdir(join(tmpdir(), `toolkit-env-${Date.now()}`), { recursive: true });
    const path = join(dir, ".env");
    process.env.__TOOLKIT_EXISTING = "existing";
    delete process.env.__TOOLKIT_NEW;
    await writeFile(path, "__TOOLKIT_EXISTING=replaced\n__TOOLKIT_NEW=loaded\n");
    try {
      await createEnvLoader().load(path);
      expect(process.env.__TOOLKIT_EXISTING).toBe("existing");
      expect(process.env.__TOOLKIT_NEW).toBe("loaded");
    } finally {
      delete process.env.__TOOLKIT_EXISTING;
      delete process.env.__TOOLKIT_NEW;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["y", true],
    ["N", false],
    ["", false]
  ] as const)("prompts for %s", async (answer, expected) => {
    const originalIn = process.stdin;
    const originalOut = process.stdout;
    const input = new PassThrough();
    Object.defineProperty(process, "stdin", { value: input, configurable: true });
    Object.defineProperty(process, "stdout", { value: new PassThrough(), configurable: true });
    queueMicrotask(() => (answer === "" ? input.end() : input.write(`${answer}\n`)));
    try {
      expect(await createPrompter().confirm("Continue? ")).toBe(expected);
    } finally {
      Object.defineProperty(process, "stdin", { value: originalIn });
      Object.defineProperty(process, "stdout", { value: originalOut });
    }
  });
});

describe("Terraform runner", () => {
  it("invokes and parses terraform output", async () => {
    const exec = vi
      .fn<ExecRunner>()
      .mockResolvedValue({ stdout: '{"x":{"value":"y","type":"string","sensitive":false}}' });
    expect((await createTerraformRunner(exec).getOutputs("infra")).x.value).toBe("y");
    expect(exec).toHaveBeenCalledWith("terraform", ["-chdir=infra", "output", "-json"]);
  });

  it.each(["bad json", "[]", "null", '"text"'])("rejects invalid output %s", async (stdout) => {
    await expect(
      createTerraformRunner(async () => ({ stdout })).getOutputs(".")
    ).rejects.toBeInstanceOf(TerraformError);
  });

  it("wraps process failures and names its error", async () => {
    const error = new TerraformError("x");
    expect(error.name).toBe("TerraformError");
    await expect(
      createTerraformRunner(async () => Promise.reject("failed")).getOutputs(".")
    ).rejects.toThrow("failed");
  });

  it("covers the default process adapter", async () => {
    await expect(
      createTerraformRunner().getOutputs("/definitely-not-a-terraform-directory-165")
    ).rejects.toBeInstanceOf(TerraformError);
  });
});

describe("container API", () => {
  it("lists, deletes, and creates registry auth", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { result: [{ id: "app" }] }))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(200, { result: { password: "pw" } }));
    const api = createContainersApi(logger(), fetchFn);
    expect(await api.listApplications("a", "t")).toEqual([{ id: "app" }]);
    expect(await api.deleteApplication("a", "t", "app")).toBe(true);
    expect(Buffer.from(await api.getRegistryCredentials("a", "t"), "base64").toString()).toBe(
      "v1:pw"
    );
  });

  it("rejects response and network discovery failures while reporting delete failures", async () => {
    const api = createContainersApi(
      logger(),
      vi.fn<typeof fetch>().mockResolvedValue(response(500))
    );
    await expect(api.listApplications("a", "t")).rejects.toThrow("discovery failed");
    expect(await api.deleteApplication("a", "t", "app")).toBe(false);
    await expect(api.getRegistryCredentials("a", "t")).rejects.toThrow("discovery failed");
    const failed = createContainersApi(
      logger(),
      vi.fn<typeof fetch>().mockRejectedValue(new Error("network"))
    );
    await expect(failed.listApplications("a", "t")).rejects.toThrow("discovery failed");
    expect(await failed.deleteApplication("a", "t", "app")).toBe(false);
    await expect(failed.getRegistryCredentials("a", "t")).rejects.toThrow("discovery failed");
  });

  it("rejects omitted API discovery result fields", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200));
    const api = createContainersApi(logger(), fetchFn);
    await expect(api.listApplications("a", "t")).rejects.toThrow("missing result array");
    await expect(api.getRegistryCredentials("a", "t")).rejects.toThrow("missing password");
  });

  it("constructs with the default fetch adapter", () => {
    expect(createContainersApi(logger())).toBeDefined();
  });
});

describe("OCI registry", () => {
  it("filters repositories and deletes by resolved digest", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, {
          repositories: {
            "/a/worker": ["latest", "sha256:x"],
            "/a/other": ["v1"],
            "worker-digests": ["sha256:only"]
          }
        })
      )
      .mockResolvedValueOnce(response(200, {}, { "Docker-Content-Digest": "sha256:digest" }))
      .mockResolvedValueOnce(response(202));
    const registry = createRegistryClient(logger(), fetchFn);
    expect(await registry.listRepos("auth", "worker")).toEqual([
      { name: "a/worker", tags: ["latest"] }
    ]);
    expect(await registry.deleteTag("auth", "a/worker", "latest")).toBe(true);
    expect(fetchFn.mock.calls[2][0]).toContain("sha256:digest");
  });

  it("returns valid empty catalogs and rejects malformed, failed, and unreachable catalogs", async () => {
    expect(
      await createRegistryClient(
        logger(),
        vi.fn<typeof fetch>().mockResolvedValue(response(200, { repositories: {} }))
      ).listRepos("a", "x")
    ).toEqual([]);
    for (const fetchFn of [
      vi.fn<typeof fetch>().mockResolvedValue(response(200)),
      vi.fn<typeof fetch>().mockResolvedValue(response(500)),
      vi.fn<typeof fetch>().mockRejectedValue("down")
    ]) {
      await expect(createRegistryClient(logger(), fetchFn).listRepos("a", "x")).rejects.toThrow(
        "discovery failed"
      );
    }
  });

  it.each([response(404), response(200)])("falls back to deleting by tag", async (head) => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce(response(202));
    expect(await createRegistryClient(logger(), fetchFn).deleteTag("a", "repo", "tag")).toBe(true);
    expect(fetchFn.mock.calls[1][0]).toContain("/tag");
  });

  it("falls back after HEAD rejection and reports DELETE failures", async () => {
    const rejectedHead = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce("head failed")
      .mockResolvedValueOnce(response(500));
    expect(await createRegistryClient(logger(), rejectedHead).deleteTag("a", "repo", "tag")).toBe(
      false
    );
    const rejectedDelete = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(404))
      .mockRejectedValueOnce("delete failed");
    expect(await createRegistryClient(logger(), rejectedDelete).deleteTag("a", "repo", "tag")).toBe(
      false
    );
  });

  it("constructs with the default fetch adapter", () => {
    expect(createRegistryClient(logger())).toBeDefined();
  });
});
