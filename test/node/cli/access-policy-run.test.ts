/* eslint-disable @typescript-eslint/unbound-method -- Vitest mocks are intentionally extracted for assertions. */
import { Command } from "commander";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessConfig } from "../../../src/lib/access-config.js";
import type { AccessApi } from "../../../src/cli/access-policy/cf.js";
import type { LogSink } from "../../../src/cli/internal/logger.js";
import type { EnvLoader, Prompter } from "../../../src/cli/internal/utils.js";
import { run } from "../../../src/cli/access-policy/run.js";

const argv = (...args: string[]) => ["node", "cf-access-policy", ...args];
const config: AccessConfig = {
  policies: [{ name: "p", decision: "allow", include: [{}] }],
  applications: [{ name: "a", domain: "a.example.com", policies: [{ name: "p", precedence: 1 }] }]
};

function api(policies: unknown[] = [], applications: unknown[] = []): AccessApi {
  return {
    listPolicies: vi.fn().mockReturnValue(policies),
    listApplications: vi.fn().mockReturnValue(applications),
    createPolicy: vi.fn().mockReturnValue({ id: "p-id", name: "p" }),
    updatePolicy: vi.fn(),
    deletePolicy: vi.fn(),
    createApplication: vi.fn(),
    updateApplication: vi.fn(),
    deleteApplication: vi.fn()
  };
}

function deps(client = api()) {
  return {
    createApi: vi.fn().mockReturnValue(client),
    prompter: { confirm: vi.fn().mockResolvedValue(true) } as Prompter,
    envLoader: { load: vi.fn().mockResolvedValue(undefined) } as EnvLoader,
    configLoader: vi.fn().mockResolvedValue({ default: config }),
    logSink: vi.fn() as LogSink
  };
}

describe("cf-access-policy orchestration", () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("supports help and version", async () => {
    expect(await run(argv("--help"), deps())).toBe(0);
    expect(await run(argv("--version"), deps())).toBe(0);
  });

  it("returns argument and unexpected parser categories", async () => {
    expect(await run(argv(), deps())).toBe(6);
    expect(await run(argv("bad"), deps())).toBe(6);
    expect(await run(argv("apply", "--bad"), deps())).toBe(6);
    expect(await run(argv("apply", "-q", "-v"), deps())).toBe(6);
    vi.spyOn(Command.prototype, "parse").mockImplementation(() => {
      throw new TypeError("bad parser");
    });
    expect(await run(argv("apply"), deps())).toBe(99);
  });

  it("loads env before config and forwards config/profile options", async () => {
    const d = deps();
    expect(
      await run(
        argv(
          "apply",
          "--env-file",
          ".env",
          "-c",
          "custom.ts",
          "--profile",
          "work",
          "-v",
          "--dry-run"
        ),
        d
      )
    ).toBe(0);
    expect(d.envLoader.load).toHaveBeenCalledWith(".env");
    expect(d.configLoader).toHaveBeenCalledWith("custom.ts");
    expect(d.createApi).toHaveBeenCalledWith("work");
    expect(vi.mocked(d.envLoader.load).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(d.configLoader).mock.invocationCallOrder[0]
    );
  });

  it("maps env and config failures to exit 2", async () => {
    const env = deps();
    vi.mocked(env.envLoader.load).mockRejectedValue("bad env");
    expect(await run(argv("apply", "--env-file", ".env"), env)).toBe(2);
    expect(env.configLoader).not.toHaveBeenCalled();

    const rejected = deps();
    vi.mocked(rejected.configLoader).mockRejectedValue(new Error("missing"));
    expect(await run(argv("apply"), rejected)).toBe(2);
    const noDefault = deps();
    vi.mocked(noDefault.configLoader).mockResolvedValue({ value: config });
    expect(await run(argv("apply"), noDefault)).toBe(2);
    const nullModule = deps();
    vi.mocked(nullModule.configLoader).mockResolvedValue(null);
    expect(await run(argv("apply"), nullModule)).toBe(2);
    const invalid = deps();
    vi.mocked(invalid.configLoader).mockResolvedValue({ default: {} });
    expect(await run(argv("apply"), invalid)).toBe(2);
  });

  it("maps discovery and removal preflight failures to exit 3", async () => {
    const failing = api();
    vi.mocked(failing.listPolicies).mockImplementation(() => {
      throw new Error("cf down");
    });
    expect(await run(argv("apply"), deps(failing))).toBe(3);

    const createFails = deps();
    vi.mocked(createFails.createApi).mockImplementation(() => {
      throw new Error("adapter failed");
    });
    expect(await run(argv("apply"), createFails)).toBe(3);

    const linked = api(
      [{ id: "p-id", name: "p", app_count: 1 }],
      [{ id: "other", name: "other", policies: [{ id: "p-id", precedence: 1 }] }]
    );
    expect(await run(argv("remove"), deps(linked))).toBe(3);
    expect(linked.deleteApplication).not.toHaveBeenCalled();

    const undercounted = api(
      [{ id: "p-id", name: "p", app_count: 0 }],
      [{ id: "a-id", name: "a", policies: [{ id: "p-id", precedence: 1 }] }]
    );
    const undercountedDeps = deps(undercounted);
    expect(await run(argv("remove"), undercountedDeps)).toBe(3);
    expect(undercountedDeps.prompter.confirm).not.toHaveBeenCalled();
    expect(undercounted.deleteApplication).not.toHaveBeenCalled();
  });

  it("does not prompt or mutate for dry-run and no-change plans", async () => {
    const dry = deps();
    expect(await run(argv("apply", "--dry-run", "-q"), dry)).toBe(0);
    expect(dry.prompter.confirm).not.toHaveBeenCalled();
    expect(vi.mocked(dry.createApi).mock.results[0].value.createPolicy).not.toHaveBeenCalled();

    const cleanApi = api(
      [{ id: "p-id", name: "p", decision: "allow", include: [{}] }],
      [
        {
          id: "a-id",
          name: "a",
          domain: "a.example.com",
          type: "self_hosted",
          policies: [{ id: "p-id", precedence: 1 }]
        }
      ]
    );
    const clean = deps(cleanApi);
    expect(await run(argv("apply"), clean)).toBe(0);
    expect(clean.prompter.confirm).not.toHaveBeenCalled();
  });

  it("returns decline 1 and makes no mutations", async () => {
    const d = deps();
    vi.mocked(d.prompter.confirm).mockResolvedValue(false);
    expect(await run(argv("apply"), d)).toBe(1);
    const client = vi.mocked(d.createApi).mock.results[0].value;
    expect(client.createPolicy).not.toHaveBeenCalled();
  });

  it("applies an approved plan and maps mutation failure to exit 4", async () => {
    const approved = deps();
    expect(await run(argv("apply", "--yes"), approved)).toBe(0);
    expect(approved.prompter.confirm).not.toHaveBeenCalled();
    const client = vi.mocked(approved.createApi).mock.results[0].value;
    expect(client.listPolicies).toHaveBeenCalledTimes(1);
    expect(client.listApplications).toHaveBeenCalledTimes(1);
    expect(client.createPolicy).toHaveBeenCalledTimes(1);
    expect(client.createApplication).toHaveBeenCalledTimes(1);

    const brokenApi = api();
    vi.mocked(brokenApi.createPolicy).mockImplementation(() => {
      throw new Error("mutation failed");
    });
    expect(await run(argv("apply", "-y"), deps(brokenApi))).toBe(4);
  });

  it("removes applications before policies from one snapshot", async () => {
    const client = api(
      [{ id: "p-id", name: "p", app_count: 1 }],
      [{ id: "a-id", name: "a", policies: [{ id: "p-id", precedence: 1 }] }]
    );
    expect(await run(argv("remove", "-y"), deps(client))).toBe(0);
    expect(vi.mocked(client.deleteApplication).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.deletePolicy).mock.invocationCallOrder[0]
    );
  });

  it("uses the real TypeScript config loader", async () => {
    const dir = join(tmpdir(), `access-policy-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "access.config.ts");
    await writeFile(path, `export default ${JSON.stringify(config)};`);
    const d = deps();
    const realLoaderDeps = {
      createApi: d.createApi,
      prompter: d.prompter,
      envLoader: d.envLoader,
      logSink: d.logSink
    };
    try {
      expect(await run(argv("apply", "-c", path, "--dry-run"), realLoaderDeps)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
