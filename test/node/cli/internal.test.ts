import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createContainersApi,
  createLocalR2Cleaner,
  createRegistryClient,
  createRemoteR2Cleaner,
  type SleepFn
} from "../../../src/cli/internal/cloudflare.js";
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

describe("R2 remote cleaner", () => {
  const target = { bucketName: "bucket", accountId: "acct", apiToken: "token" };

  it("detects empty and non-empty buckets with a bearer-token probe", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { result: [] }))
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] }));
    const cleaner = createRemoteR2Cleaner(logger(), fetchFn);
    expect(await cleaner.hasObjects(target)).toBe(false);
    expect(await cleaner.hasObjects(target)).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toContain("per_page=1");
    expect(fetchFn.mock.calls[0][1]).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer token" }
    });
  });

  it("rejects on failed, malformed, or unreachable probes", async () => {
    for (const fetchFn of [
      vi.fn<typeof fetch>().mockResolvedValue(response(500)),
      vi.fn<typeof fetch>().mockResolvedValue(response(200)),
      vi.fn<typeof fetch>().mockRejectedValue(new Error("network"))
    ]) {
      await expect(createRemoteR2Cleaner(logger(), fetchFn).hasObjects(target)).rejects.toThrow(
        "probe failed"
      );
    }
  });

  it("empties immediately when the completion probe succeeds on the first poll", async () => {
    const sleepFn = vi.fn<SleepFn>().mockResolvedValue(undefined);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200)) // DELETE ?prefix=
      .mockResolvedValueOnce(response(200, { result: [] })); // poll: already empty
    await expect(
      createRemoteR2Cleaner(logger(), fetchFn, sleepFn).empty(target)
    ).resolves.toBeUndefined();
    expect(fetchFn.mock.calls[0][0]).toContain("prefix=");
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("polls with bounded backoff until the bucket is confirmed empty", async () => {
    const sleepFn = vi.fn<SleepFn>().mockResolvedValue(undefined);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200)) // DELETE
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })) // poll 1: still has objects
      .mockResolvedValueOnce(response(200, { result: [] })); // poll 2: empty
    await expect(
      createRemoteR2Cleaner(logger(), fetchFn, sleepFn).empty(target)
    ).resolves.toBeUndefined();
    expect(sleepFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).toHaveBeenCalledWith(2000);
  });

  it("rejects when the empty request fails or is unreachable", async () => {
    await expect(
      createRemoteR2Cleaner(logger(), vi.fn<typeof fetch>().mockResolvedValue(response(500))).empty(
        target
      )
    ).rejects.toThrow("empty request returned HTTP");
    await expect(
      createRemoteR2Cleaner(
        logger(),
        vi.fn<typeof fetch>().mockRejectedValue(new Error("down"))
      ).empty(target)
    ).rejects.toThrow("empty request failed");
  });

  it("rejects when a completion poll attempt fails", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200)) // DELETE
      .mockResolvedValueOnce(response(500)); // poll failure
    await expect(
      createRemoteR2Cleaner(logger(), fetchFn, vi.fn<SleepFn>().mockResolvedValue(undefined)).empty(
        target
      )
    ).rejects.toThrow("completion poll failed");
  });

  it("rejects after exhausting the bounded poll budget", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation((url) =>
        typeof url === "string" && url.includes("prefix=") ?
          Promise.resolve(response(200))
        : Promise.resolve(response(200, { result: [{ key: "a" }] }))
      );
    const sleepFn = vi.fn<SleepFn>().mockResolvedValue(undefined);
    await expect(createRemoteR2Cleaner(logger(), fetchFn, sleepFn).empty(target)).rejects.toThrow(
      "did not become empty"
    );
    expect(sleepFn).toHaveBeenCalledTimes(29);
  });

  it("constructs with the default fetch and sleep adapters", () => {
    expect(createRemoteR2Cleaner(logger())).toBeDefined();
  });

  it("uses the real timer-based sleep between poll attempts", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(200)) // DELETE
        .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })) // poll 1: still has objects
        .mockResolvedValueOnce(response(200, { result: [] })); // poll 2: empty
      const emptyPromise = createRemoteR2Cleaner(logger(), fetchFn).empty(target);
      await vi.advanceTimersByTimeAsync(2000);
      await expect(emptyPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("R2 local cleaner", () => {
  const target = { bucketName: "bucket", localUrl: "http://local/cdn-cgi/explorer/api" };

  it("detects empty and non-empty buckets without sending Cloudflare credentials", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { result: [] }))
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] }));
    const cleaner = createLocalR2Cleaner(logger(), fetchFn);
    expect(await cleaner.hasObjects(target)).toBe(false);
    expect(await cleaner.hasObjects(target)).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toContain("per_page=1");
    expect(fetchFn.mock.calls[0][1]).toEqual({ method: "GET" });
  });

  it("rejects on failed, malformed, or unreachable probes", async () => {
    for (const fetchFn of [
      vi.fn<typeof fetch>().mockResolvedValue(response(500)),
      vi.fn<typeof fetch>().mockResolvedValue(response(200)),
      vi.fn<typeof fetch>().mockRejectedValue(new Error("network"))
    ]) {
      await expect(createLocalR2Cleaner(logger(), fetchFn).hasObjects(target)).rejects.toThrow(
        "probe failed"
      );
    }
  });

  it("resolves immediately for an already-empty bucket without issuing a delete", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { result: [] })) // page: empty, not truncated
      .mockResolvedValueOnce(response(200, { result: [] })); // final probe
    await expect(createLocalR2Cleaner(logger(), fetchFn).empty(target)).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchFn.mock.calls) expect(init).not.toMatchObject({ method: "DELETE" });
  });

  it("deletes a single page of keys and verifies completion", async () => {
    const keys = [{ key: "a" }, { key: "b" }];
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { result: keys })) // page 1, not truncated
      .mockResolvedValueOnce(response(200, { result: keys })) // batch delete confirms both keys
      .mockResolvedValueOnce(response(200, { result: [] })); // final probe: empty
    await expect(createLocalR2Cleaner(logger(), fetchFn).empty(target)).resolves.toBeUndefined();
    expect(fetchFn.mock.calls[1][0]).toContain("/objects");
    expect(fetchFn.mock.calls[1][1]).toEqual({
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["a", "b"])
    });
  });

  it("paginates across multiple pages using the returned cursor", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, {
          result: [{ key: "a" }],
          result_info: { cursor: "cursor-1", is_truncated: "true" }
        })
      ) // page 1
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })) // delete batch 1
      .mockResolvedValueOnce(response(200, { result: [{ key: "b" }] })) // page 2, not truncated
      .mockResolvedValueOnce(response(200, { result: [{ key: "b" }] })) // delete batch 2
      .mockResolvedValueOnce(response(200, { result: [] })); // final probe: empty
    await expect(createLocalR2Cleaner(logger(), fetchFn).empty(target)).resolves.toBeUndefined();
    expect(fetchFn.mock.calls[2][0]).toContain("cursor=cursor-1");
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it("handles the exact 1000-object batch boundary in a single page", async () => {
    const keys = Array.from({ length: 1000 }, (_, i) => ({ key: `k${i}` }));
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { result: keys })) // not truncated
      .mockResolvedValueOnce(response(200, { result: keys })) // batch delete
      .mockResolvedValueOnce(response(200, { result: [] })); // final probe
    await expect(createLocalR2Cleaner(logger(), fetchFn).empty(target)).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls[0][0]).toContain("per_page=1000");
  });

  it.each([{ is_truncated: "true" }, { is_truncated: "true", cursor: "" }])(
    "stops the loop on an invalid cursor (%j) and reports failure if objects remain",
    async (resultInfo) => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(200, { result: [{ key: "a" }], result_info: resultInfo }))
        .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })); // final probe
      await expect(createLocalR2Cleaner(logger(), fetchFn).empty(target)).rejects.toThrow(
        "batch deletion failed and objects remain"
      );
    }
  );

  it("rejects when pagination returns a repeated cursor and objects remain", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, {
          result: [{ key: "a" }],
          result_info: { cursor: "c1", is_truncated: "true" }
        })
      ) // page 1
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })) // delete batch 1
      .mockResolvedValueOnce(
        response(200, { result: [], result_info: { cursor: "c1", is_truncated: "true" } })
      ) // page 2: repeats cursor "c1"
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })); // final probe: still has objects
    await expect(createLocalR2Cleaner(logger(), fetchFn).empty(target)).rejects.toThrow(
      "batch deletion failed and objects remain"
    );
  });

  it("stops the loop on a malformed list entry and reports failure if objects remain", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { result: [{ notKey: "a" }] }))
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })); // final probe
    await expect(createLocalR2Cleaner(logger(), fetchFn).empty(target)).rejects.toThrow(
      "batch deletion failed and objects remain"
    );
  });

  it("stops the loop when a batch delete request fails and reports failure if objects remain", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })) // not truncated
      .mockResolvedValueOnce(response(500)) // delete batch fails
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })); // final probe
    await expect(createLocalR2Cleaner(logger(), fetchFn).empty(target)).rejects.toThrow(
      "batch deletion failed and objects remain"
    );
  });

  it("stops the loop when a batch delete response omits a key", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }, { key: "b" }] }))
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })) // confirms only one of two keys
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })); // final probe
    await expect(createLocalR2Cleaner(logger(), fetchFn).empty(target)).rejects.toThrow(
      "batch deletion failed and objects remain"
    );
  });

  it("rejects when objects remain despite a clean deletion pass", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })) // not truncated
      .mockResolvedValueOnce(response(200, { result: [{ key: "a" }] })) // delete confirms the key
      .mockResolvedValueOnce(response(200, { result: [{ key: "b" }] })); // final probe: unexpectedly non-empty
    await expect(createLocalR2Cleaner(logger(), fetchFn).empty(target)).rejects.toThrow(
      "still contains objects after batch deletion"
    );
  });

  it("succeeds overall when the loop fails outright but final verification confirms empty", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("down")) // listing fails entirely
      .mockResolvedValueOnce(response(200, { result: [] })); // final probe: empty
    await expect(createLocalR2Cleaner(logger(), fetchFn).empty(target)).resolves.toBeUndefined();
  });

  it("rejects when final verification itself fails", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { result: [] })) // page: empty, not truncated
      .mockRejectedValueOnce(new Error("down")); // final probe fails
    await expect(createLocalR2Cleaner(logger(), fetchFn).empty(target)).rejects.toThrow(
      "final verification failed"
    );
  });

  it("constructs with the default fetch adapter", () => {
    expect(createLocalR2Cleaner(logger())).toBeDefined();
  });
});
