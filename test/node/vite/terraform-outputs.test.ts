import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readTerraformOutputs,
  requireTerraformOutputs
} from "../../../src/lib/vite/terraform-outputs.js";

interface DemoOutputs extends Record<string, string> {
  hostname: string;
  workerName: string;
}

const KEYS = { hostname: "hostname", workerName: "worker_name" };

describe("readTerraformOutputs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "terraform-outputs-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads and projects a well-formed terraform output -json file", async () => {
    const path = join(dir, "outputs.json");
    await writeFile(
      path,
      JSON.stringify({
        hostname: { value: "demo.example.com", type: "string" },
        worker_name: { value: "demo-worker", type: "string", sensitive: false }
      }),
      "utf-8"
    );

    const result = readTerraformOutputs<DemoOutputs>({ path, keys: KEYS });

    expect(result).toEqual({ hostname: "demo.example.com", workerName: "demo-worker" });
  });

  it("returns undefined when the file does not exist", () => {
    const path = join(dir, "missing.json");

    expect(readTerraformOutputs<DemoOutputs>({ path, keys: KEYS })).toBeUndefined();
  });

  it("returns undefined when the file contains malformed JSON", async () => {
    const path = join(dir, "bad.json");
    await writeFile(path, "{not valid json", "utf-8");

    expect(readTerraformOutputs<DemoOutputs>({ path, keys: KEYS })).toBeUndefined();
  });

  it("returns undefined when a mapped output name is missing", async () => {
    const path = join(dir, "incomplete.json");
    await writeFile(path, JSON.stringify({ hostname: { value: "demo.example.com" } }), "utf-8");

    expect(readTerraformOutputs<DemoOutputs>({ path, keys: KEYS })).toBeUndefined();
  });

  it("returns undefined when a mapped output value is not a string", async () => {
    const path = join(dir, "wrong-type.json");
    await writeFile(
      path,
      JSON.stringify({
        hostname: { value: "demo.example.com" },
        worker_name: { value: 42 }
      }),
      "utf-8"
    );

    expect(readTerraformOutputs<DemoOutputs>({ path, keys: KEYS })).toBeUndefined();
  });

  it("resolves a relative path against process.cwd()", async () => {
    const path = join(dir, "outputs.json");
    await writeFile(
      path,
      JSON.stringify({
        hostname: { value: "relative.example.com" },
        worker_name: { value: "relative-worker" }
      }),
      "utf-8"
    );
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);

    try {
      const result = readTerraformOutputs<DemoOutputs>({ path: "outputs.json", keys: KEYS });
      expect(result).toEqual({
        hostname: "relative.example.com",
        workerName: "relative-worker"
      });
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("defaults to infra/outputs.json when no path is given", () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);

    try {
      expect(readTerraformOutputs<DemoOutputs>({ keys: KEYS })).toBeUndefined();
    } finally {
      cwdSpy.mockRestore();
    }
  });
});

describe("requireTerraformOutputs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "terraform-outputs-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the projected outputs when they can be read", async () => {
    const path = join(dir, "outputs.json");
    await writeFile(
      path,
      JSON.stringify({
        hostname: { value: "demo.example.com" },
        worker_name: { value: "demo-worker" }
      }),
      "utf-8"
    );

    const result = requireTerraformOutputs<DemoOutputs>({
      path,
      keys: KEYS,
      hint: "npm run deploy:infra"
    });

    expect(result).toEqual({ hostname: "demo.example.com", workerName: "demo-worker" });
  });

  it("throws an actionable error naming the path and hint when outputs are missing", () => {
    const path = join(dir, "missing.json");

    expect(() =>
      requireTerraformOutputs<DemoOutputs>({ path, keys: KEYS, hint: "npm run deploy:infra" })
    ).toThrow(/missing.json.*npm run deploy:infra/s);
  });

  it("names the default path in the thrown error when no path is given", () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);

    try {
      expect(() =>
        requireTerraformOutputs<DemoOutputs>({ keys: KEYS, hint: "npm run deploy:infra" })
      ).toThrow(/infra\/outputs\.json/);
    } finally {
      cwdSpy.mockRestore();
    }
  });
});
