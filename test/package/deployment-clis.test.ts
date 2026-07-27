import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const dist = join(dirname(fileURLToPath(import.meta.url)), "../../dist/cli");
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const commandNames = [
  "generate-wrangler",
  "generate-wrangler-types",
  "empty-r2-bucket",
  "destroy-containers"
] as const;

async function runCli(name: string, args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await execFileAsync(join(dist, name, "index.js"), args);
    return { code: 0, stdout };
  } catch (error: unknown) {
    const result = error as { code?: number; stdout?: string };
    return { code: result.code ?? 1, stdout: result.stdout ?? "" };
  }
}

describe("deployment CLI package metadata", () => {
  it("maps every command to its built entry point", async () => {
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      bin: Record<string, string>;
    };

    expect(packageJson.bin).toMatchObject(
      Object.fromEntries(commandNames.map((name) => [name, `./dist/cli/${name}/index.js`]))
    );
  });
});

describe.each(commandNames)("built %s CLI", (name) => {
  it("is an executable Node shebang script", async () => {
    const path = join(dist, name, "index.js");
    expect((await readFile(path, "utf8")).startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect((await stat(path)).mode & 0o111).not.toBe(0);
  });

  it("prints help with the command name", async () => {
    const result = await runCli(name, ["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(name);
  });

  it("prints the package version", async () => {
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      version: string;
    };
    const result = await runCli(name, ["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });
});
