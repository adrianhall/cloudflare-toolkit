/* eslint-disable @typescript-eslint/unbound-method -- Vitest mocks are intentionally extracted for assertions. */
import { Command } from "commander";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ContainersApi,
  RegistryClient,
  RepoInfo
} from "../../../src/cli/internal/cloudflare.js";
import { createLogger, type LogSink } from "../../../src/cli/internal/logger.js";
import type { TerraformOutputMap, TerraformRunner } from "../../../src/cli/internal/terraform.js";
import type { EnvLoader, Prompter } from "../../../src/cli/internal/utils.js";
import { run as runDestroy } from "../../../src/cli/destroy-containers/run.js";
import { createFileSystem as createGenerateFs } from "../../../src/cli/generate-wrangler/fs.js";
import { parseLocalVariables } from "../../../src/cli/generate-wrangler/local.js";
import { run as runGenerate } from "../../../src/cli/generate-wrangler/run.js";
import {
  scanMarkers,
  substituteTemplate,
  validateOutputs
} from "../../../src/cli/generate-wrangler/template.js";

const quietSink: LogSink = vi.fn();
const argv = (name: string, ...args: string[]) => ["node", name, ...args];
const outputs = (value: TerraformOutputMap): TerraformRunner => ({
  getOutputs: vi.fn().mockResolvedValue(value)
});
afterEach(() => vi.restoreAllMocks());

describe("generate-wrangler template", () => {
  const logger = createLogger({ level: "debug", sink: quietSink });

  it("scans strict unique markers", () => {
    expect(scanMarkers("{{a}} {{a}} {{b-1}} {{ bad }}")).toEqual(["a", "b-1"]);
  });

  it("validates successful, missing, and invalid outputs", () => {
    expect(validateOutputs([], {}, logger).valid).toBe(true);
    const result = validateOutputs(
      ["missing", "bad"],
      { bad: { value: true, type: "bool", sensitive: false } },
      logger
    );
    expect(result.errors).toEqual([
      { kind: "missing", name: "missing" },
      { kind: "invalid-type", name: "bad", type: "bool" }
    ]);
  });

  it("substitutes scalars, leaves missing markers, and rejects complex values", () => {
    expect(
      substituteTemplate({
        template: "{{text}}/{{number}}/{{missing}}",
        outputs: {
          text: { value: "x", type: "string", sensitive: false },
          number: { value: 2, type: "number", sensitive: false }
        },
        logger
      })
    ).toEqual({ success: true, content: "x/2/{{missing}}" });
    expect(
      substituteTemplate({
        template: "{{bad}}",
        outputs: { bad: { value: [], type: "list", sensitive: false } },
        logger
      })
    ).toEqual({ success: false, exitCode: 7 });
  });

  it("parses local variables files into a TerraformOutputMap", () => {
    expect(
      parseLocalVariables(
        JSON.stringify({
          text: "worker",
          count: 3,
          flag: true,
          empty: null,
          list: [1, 2],
          nested: { a: 1 }
        })
      )
    ).toEqual({
      text: { value: "worker", type: "string", sensitive: false },
      count: { value: 3, type: "number", sensitive: false },
      flag: { value: true, type: "bool", sensitive: false },
      empty: { value: null, type: "null", sensitive: false },
      list: { value: [1, 2], type: "list", sensitive: false },
      nested: { value: { a: 1 }, type: "object", sensitive: false }
    });
  });

  it("rejects invalid JSON and non-object roots", () => {
    expect(() => parseLocalVariables("not json")).toThrow(/not valid JSON/);
    expect(() => parseLocalVariables("[1, 2]")).toThrow(/JSON object/);
    expect(() => parseLocalVariables("null")).toThrow(/JSON object/);
    expect(() => parseLocalVariables('"text"')).toThrow(/JSON object/);
  });

  it("redacts sensitive Terraform values from verbose substitution logs", () => {
    const messages: string[] = [];
    const sensitiveLogger = createLogger({
      level: "debug",
      sink: (_level, message) => messages.push(message)
    });
    expect(
      substituteTemplate({
        template: "{{secret}}",
        outputs: { secret: { value: "do-not-log", type: "string", sensitive: true } },
        logger: sensitiveLogger
      })
    ).toEqual({ success: true, content: "do-not-log" });
    expect(messages.join("\n")).toContain("[REDACTED]");
    expect(messages.join("\n")).not.toContain("do-not-log");
  });
});

describe("generate-wrangler", () => {
  function deps() {
    return {
      terraform: outputs({ name: { value: "worker", type: "string", sensitive: false } }),
      fs: {
        readFile: vi.fn().mockResolvedValue("{{name}}"),
        writeFile: vi.fn().mockResolvedValue(undefined),
        fileExists: vi.fn().mockResolvedValue(false),
        directoryExists: vi.fn().mockResolvedValue(true)
      },
      logSink: quietSink
    };
  }

  it("writes generated output and supports check, force, logging flags, help, and version", async () => {
    const base = deps();
    expect(await runGenerate(argv("generate-wrangler", "-d", "/base", "-c", "-v"), base)).toBe(0);
    expect(base.fs.writeFile).toHaveBeenCalledWith("/base/wrangler.jsonc", "worker");
    base.fs.fileExists.mockResolvedValue(true);
    expect(await runGenerate(argv("generate-wrangler", "-f", "-q"), base)).toBe(0);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await runGenerate(argv("generate-wrangler", "--help"), deps())).toBe(0);
    expect(await runGenerate(argv("generate-wrangler", "--version"), deps())).toBe(0);
    const absolute = deps();
    expect(
      await runGenerate(
        argv("generate-wrangler", "-i", "/input.tpl", "-o", "/output.jsonc"),
        absolute
      )
    ).toBe(0);
    expect(absolute.fs.readFile).toHaveBeenCalledWith("/input.tpl");
  });

  it.each([
    [1, (d: ReturnType<typeof deps>) => d.fs.readFile.mockRejectedValue("read")],
    [2, (d: ReturnType<typeof deps>) => d.fs.writeFile.mockRejectedValue("write")],
    [3, (d: ReturnType<typeof deps>) => d.fs.directoryExists.mockResolvedValue(false)],
    [
      4,
      (d: ReturnType<typeof deps>) =>
        vi.mocked(d.terraform.getOutputs).mockRejectedValue("terraform")
    ]
  ] as const)("returns exit %s for I/O failures", async (code, mutate) => {
    const d = deps();
    mutate(d);
    expect(await runGenerate(argv("generate-wrangler"), d)).toBe(code);
    if (code !== 2) expect(d.fs.writeFile).not.toHaveBeenCalled();
  });

  it("returns output-exists, check, type, and argument exit codes", async () => {
    const exists = deps();
    exists.fs.fileExists.mockResolvedValue(true);
    expect(await runGenerate(argv("generate-wrangler"), exists)).toBe(2);
    expect(exists.fs.writeFile).not.toHaveBeenCalled();
    const check = deps();
    check.fs.readFile.mockResolvedValue("{{missing}}");
    expect(await runGenerate(argv("generate-wrangler", "-c"), check)).toBe(5);
    expect(check.fs.writeFile).not.toHaveBeenCalled();
    const invalid = deps();
    invalid.fs.readFile.mockResolvedValue("{{bad}}");
    invalid.terraform = outputs({ bad: { value: true, type: "bool", sensitive: false } });
    expect(await runGenerate(argv("generate-wrangler"), invalid)).toBe(7);
    expect(invalid.fs.writeFile).not.toHaveBeenCalled();
    expect(await runGenerate(argv("generate-wrangler", "-v", "-q"), deps())).toBe(6);
    expect(await runGenerate(argv("generate-wrangler", "-i", "same", "-o", "same"), deps())).toBe(
      6
    );
    expect(await runGenerate(argv("generate-wrangler", "--bad"), deps())).toBe(6);
  });

  it.each([["-v", "-q"], ["-i", "same", "-o", "same"], ["--bad"]])(
    "does not write for argument failure %j",
    async (...args) => {
      const d = deps();
      expect(await runGenerate(argv("generate-wrangler", ...args), d)).toBe(6);
      expect(d.fs.writeFile).not.toHaveBeenCalled();
    }
  );

  function localDeps(fileContents: Record<string, string>) {
    return {
      terraform: outputs({}),
      fs: {
        readFile: vi.fn().mockImplementation((path: string) => {
          const content = fileContents[path];
          return content === undefined ?
              Promise.reject(new Error(`no fixture for ${path}`))
            : Promise.resolve(content);
        }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        fileExists: vi
          .fn()
          .mockImplementation((path: string) => Promise.resolve(Object.hasOwn(fileContents, path))),
        directoryExists: vi.fn().mockResolvedValue(true)
      },
      logSink: quietSink
    };
  }

  it("writes generated output from a local variables file", async () => {
    const d = localDeps({
      "/base/wrangler.jsonc.tpl": "{{name}}",
      "/base/local.json": JSON.stringify({ name: "worker" })
    });
    expect(await runGenerate(argv("generate-wrangler", "-d", "/base", "-l", "local.json"), d)).toBe(
      0
    );
    expect(d.fs.writeFile).toHaveBeenCalledWith("/base/wrangler.jsonc", "worker");
  });

  it("skips local generation with exit 0 when the output already exists without --force", async () => {
    const d = localDeps({
      "/base/wrangler.jsonc.tpl": "{{name}}",
      "/base/local.json": JSON.stringify({ name: "worker" }),
      "/base/wrangler.jsonc": "existing"
    });
    expect(await runGenerate(argv("generate-wrangler", "-d", "/base", "-l", "local.json"), d)).toBe(
      0
    );
    expect(d.fs.writeFile).not.toHaveBeenCalled();
    expect(d.fs.readFile).not.toHaveBeenCalled();
  });

  it("overwrites an existing output with --local --force", async () => {
    const d = localDeps({
      "/base/wrangler.jsonc.tpl": "{{name}}",
      "/base/local.json": JSON.stringify({ name: "worker" }),
      "/base/wrangler.jsonc": "existing"
    });
    expect(
      await runGenerate(argv("generate-wrangler", "-d", "/base", "-l", "local.json", "-f"), d)
    ).toBe(0);
    expect(d.fs.writeFile).toHaveBeenCalledWith("/base/wrangler.jsonc", "worker");
  });

  it("rejects --local combined with an explicit --terraform", async () => {
    expect(
      await runGenerate(argv("generate-wrangler", "-l", "local.json", "-t", "infra"), deps())
    ).toBe(6);
  });

  it("returns 3 when the local variables file does not exist", async () => {
    const d = localDeps({ "/base/wrangler.jsonc.tpl": "{{name}}" });
    expect(
      await runGenerate(argv("generate-wrangler", "-d", "/base", "-l", "missing.json"), d)
    ).toBe(3);
    expect(d.fs.writeFile).not.toHaveBeenCalled();
  });

  it("returns 4 when the local variables file cannot be read or parsed", async () => {
    const readFails = localDeps({
      "/base/wrangler.jsonc.tpl": "{{name}}",
      "/base/local.json": "unused"
    });
    readFails.fs.readFile.mockImplementation((path: string) =>
      path === "/base/local.json" ? Promise.reject(new Error("boom")) : Promise.resolve("{{name}}")
    );
    expect(
      await runGenerate(argv("generate-wrangler", "-d", "/base", "-l", "local.json"), readFails)
    ).toBe(4);

    const invalidJson = localDeps({
      "/base/wrangler.jsonc.tpl": "{{name}}",
      "/base/local.json": "not json"
    });
    expect(
      await runGenerate(argv("generate-wrangler", "-d", "/base", "-l", "local.json"), invalidJson)
    ).toBe(4);
    expect(invalidJson.fs.writeFile).not.toHaveBeenCalled();
  });

  it("applies check, unsupported-type, and null-preservation semantics to local variables", async () => {
    const check = localDeps({
      "/base/wrangler.jsonc.tpl": "{{missing}}",
      "/base/local.json": JSON.stringify({ name: "worker" })
    });
    expect(
      await runGenerate(argv("generate-wrangler", "-d", "/base", "-l", "local.json", "-c"), check)
    ).toBe(5);

    const invalidType = localDeps({
      "/base/wrangler.jsonc.tpl": "{{flag}}",
      "/base/local.json": JSON.stringify({ flag: true })
    });
    expect(
      await runGenerate(argv("generate-wrangler", "-d", "/base", "-l", "local.json"), invalidType)
    ).toBe(7);

    const nullValue = localDeps({
      "/base/wrangler.jsonc.tpl": "{{empty}}",
      "/base/local.json": JSON.stringify({ empty: null })
    });
    expect(
      await runGenerate(argv("generate-wrangler", "-d", "/base", "-l", "local.json"), nullValue)
    ).toBe(0);
    expect(nullValue.fs.writeFile).toHaveBeenCalledWith("/base/wrangler.jsonc", "{{empty}}");
  });

  it("resolves an absolute --local path without joining --dir", async () => {
    const d = localDeps({
      "/base/wrangler.jsonc.tpl": "{{name}}",
      "/abs/local.json": JSON.stringify({ name: "worker" })
    });
    expect(
      await runGenerate(argv("generate-wrangler", "-d", "/base", "-l", "/abs/local.json"), d)
    ).toBe(0);
    expect(d.fs.readFile).toHaveBeenCalledWith("/abs/local.json");
  });

  it("returns 99 for an unexpected parser error", async () => {
    vi.spyOn(Command.prototype, "parse").mockImplementation(() => {
      throw new TypeError("bad");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await runGenerate(argv("generate-wrangler"), deps())).toBe(99);
  });

  it("exercises the real filesystem adapter", async () => {
    const dir = await mkdir(join(tmpdir(), `generate-wrangler-${Date.now()}`), { recursive: true });
    const file = join(dir, "file");
    const fs = createGenerateFs();
    try {
      await fs.writeFile(file, "text");
      expect(await fs.readFile(file)).toBe("text");
      expect(await fs.fileExists(file)).toBe(true);
      expect(await fs.fileExists(join(dir, "missing"))).toBe(false);
      expect(await fs.directoryExists(dir)).toBe(true);
      expect(await fs.directoryExists(file)).toBe(false);
      expect(await fs.directoryExists(join(dir, "missing"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("destroy-containers", () => {
  beforeEach(() => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
  });

  function deps(apps: Awaited<ReturnType<ContainersApi["listApplications"]>> = []) {
    const containers: ContainersApi = {
      listApplications: vi.fn().mockResolvedValue(apps),
      deleteApplication: vi.fn().mockResolvedValue(true),
      getRegistryCredentials: vi.fn().mockResolvedValue("auth")
    };
    const registry: RegistryClient = {
      listRepos: vi.fn().mockResolvedValue([]),
      deleteTag: vi.fn().mockResolvedValue(true)
    };
    return {
      containers,
      registry,
      prompter: { confirm: vi.fn().mockResolvedValue(true) } as Prompter,
      envLoader: { load: vi.fn().mockResolvedValue(undefined) } as EnvLoader,
      logSink: quietSink
    };
  }

  const credentials = ["-a", "account", "-k", "token"];

  it("handles successful no-match discovery, env credentials, and env files", async () => {
    expect(await runDestroy(argv("destroy-containers", "worker", ...credentials), deps())).toBe(0);
    process.env.CLOUDFLARE_ACCOUNT_ID = "account";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    expect(
      await runDestroy(argv("destroy-containers", "worker", "--env-file", ".env", "-q"), deps())
    ).toBe(0);
  });

  it("deletes matching apps and images in order", async () => {
    const d = deps([
      { id: "app", name: "worker-app" },
      { id: "other", name: "other" },
      { id: "image", image: "worker-image" }
    ]);
    const repos: RepoInfo[] = [{ name: "account/worker", tags: ["latest", "v2"] }];
    vi.mocked(d.containers.getRegistryCredentials).mockResolvedValue("auth");
    vi.mocked(d.registry.listRepos).mockResolvedValue(repos);
    expect(
      await runDestroy(argv("destroy-containers", "worker", ...credentials, "-y", "-v"), d)
    ).toBe(0);
    expect(d.registry.deleteTag).toHaveBeenCalledTimes(2);
    expect(d.containers.deleteApplication).toHaveBeenCalledTimes(2);
    expect(d.prompter.confirm).not.toHaveBeenCalled();
    expect(vi.mocked(d.registry.deleteTag).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(d.containers.deleteApplication).mock.invocationCallOrder[0]
    );
  });

  it.each([
    [3, true, false],
    [4, false, true],
    [5, true, true]
  ] as const)(
    "returns %s when app failure=%s and registry failure=%s",
    async (code, app, registry) => {
      const d = deps([{ id: "app", name: "worker" }]);
      if (app) vi.mocked(d.containers.listApplications).mockRejectedValue(new Error("apps failed"));
      if (registry)
        vi.mocked(d.containers.getRegistryCredentials).mockRejectedValue(
          new Error("registry failed")
        );
      expect(await runDestroy(argv("destroy-containers", "worker", ...credentials), d)).toBe(code);
      expect(d.prompter.confirm).not.toHaveBeenCalled();
      expect(d.registry.deleteTag).not.toHaveBeenCalled();
      expect(d.containers.deleteApplication).not.toHaveBeenCalled();
    }
  );

  it("maps OCI catalog discovery failures to registry exit 4", async () => {
    const d = deps();
    vi.mocked(d.registry.listRepos).mockRejectedValue(new Error("catalog failed"));
    expect(await runDestroy(argv("destroy-containers", "worker", ...credentials), d)).toBe(4);
    expect(d.prompter.confirm).not.toHaveBeenCalled();
    expect(d.registry.deleteTag).not.toHaveBeenCalled();
    expect(d.containers.deleteApplication).not.toHaveBeenCalled();
  });

  it("handles operator decline and all deletion failure combinations", async () => {
    const declined = deps([{ id: "app", name: "worker" }]);
    vi.mocked(declined.prompter.confirm).mockResolvedValue(false);
    expect(await runDestroy(argv("destroy-containers", "worker", ...credentials), declined)).toBe(
      1
    );
    expect(declined.registry.deleteTag).not.toHaveBeenCalled();
    expect(declined.containers.deleteApplication).not.toHaveBeenCalled();

    const appFailure = deps([{ id: "app", name: "worker" }]);
    vi.mocked(appFailure.containers.deleteApplication).mockResolvedValue(false);
    expect(
      await runDestroy(argv("destroy-containers", "worker", ...credentials, "-y"), appFailure)
    ).toBe(3);

    const tagFailure = deps();
    vi.mocked(tagFailure.containers.getRegistryCredentials).mockResolvedValue("auth");
    vi.mocked(tagFailure.registry.listRepos).mockResolvedValue([{ name: "worker", tags: ["tag"] }]);
    vi.mocked(tagFailure.registry.deleteTag).mockResolvedValue(false);
    expect(
      await runDestroy(argv("destroy-containers", "worker", ...credentials, "-y"), tagFailure)
    ).toBe(4);

    const mixed = deps([{ id: "app", name: "worker" }]);
    vi.mocked(mixed.containers.getRegistryCredentials).mockResolvedValue("auth");
    vi.mocked(mixed.registry.listRepos).mockResolvedValue([{ name: "worker", tags: ["tag"] }]);
    vi.mocked(mixed.registry.deleteTag).mockResolvedValue(false);
    vi.mocked(mixed.containers.deleteApplication).mockResolvedValue(false);
    expect(
      await runDestroy(argv("destroy-containers", "worker", ...credentials, "-y"), mixed)
    ).toBe(5);
  });

  it("returns credential, env, and argument failures", async () => {
    expect(await runDestroy(argv("destroy-containers", "worker"), deps())).toBe(2);
    process.env.CLOUDFLARE_ACCOUNT_ID = "account";
    expect(await runDestroy(argv("destroy-containers", "worker"), deps())).toBe(2);
    const badEnv = deps();
    vi.mocked(badEnv.envLoader.load).mockRejectedValue("bad");
    expect(
      await runDestroy(argv("destroy-containers", "worker", "--env-file", "bad"), badEnv)
    ).toBe(2);
    expect(await runDestroy(argv("destroy-containers"), deps())).toBe(6);
    expect(await runDestroy(argv("destroy-containers", "worker", "-v", "-q"), deps())).toBe(6);
    expect(await runDestroy(argv("destroy-containers", "worker", "--bad"), deps())).toBe(6);
  });

  it("supports help/version and unexpected parse failures", async () => {
    expect(await runDestroy(argv("destroy-containers", "--help"), deps())).toBe(0);
    expect(await runDestroy(argv("destroy-containers", "--version"), deps())).toBe(0);
    vi.spyOn(Command.prototype, "parse").mockImplementation(() => {
      throw new TypeError("bad");
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await runDestroy(argv("destroy-containers", "worker"), deps())).toBe(99);
  });
});
