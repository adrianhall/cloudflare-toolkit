import { describe, expect, it } from "vitest";
import type { WranglerResult } from "../../../../src/cli/generate-wrangler-types/types.js";
import type { ExecRunner } from "../../../../src/cli/generate-wrangler-types/wrangler.js";
import {
  createWranglerRunner,
  defaultExecRunner
} from "../../../../src/cli/generate-wrangler-types/wrangler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExecRunner(result: WranglerResult): ExecRunner {
  return async (_command, _args, _options) => result;
}

function makeCapturingExecRunner(): {
  runner: ExecRunner;
  calls: Array<{
    command: string;
    args: string[];
    options: { cwd: string; shell: boolean };
  }>;
} {
  const calls: Array<{
    command: string;
    args: string[];
    options: { cwd: string; shell: boolean };
  }> = [];
  const runner: ExecRunner = async (command, args, options) => {
    calls.push({ command, args, options });
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { runner, calls };
}

// ---------------------------------------------------------------------------
// createWranglerRunner — argument construction
// ---------------------------------------------------------------------------

describe("createWranglerRunner", () => {
  describe("runTypes — argument construction", () => {
    it("calls npx with wrangler types and the output path", async () => {
      const { runner, calls } = makeCapturingExecRunner();
      const wrangler = createWranglerRunner(runner);

      await wrangler.runTypes("src/worker-configuration.d.ts", [], "/project");

      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe("npx");
      expect(calls[0].args).toEqual(["wrangler", "types", "src/worker-configuration.d.ts"]);
    });

    it("appends extra args after the output path", async () => {
      const { runner, calls } = makeCapturingExecRunner();
      const wrangler = createWranglerRunner(runner);

      await wrangler.runTypes(
        "src/worker-configuration.d.ts",
        ["--include-runtime=false", "--strict-vars=false"],
        "/project"
      );

      expect(calls[0].args).toEqual([
        "wrangler",
        "types",
        "src/worker-configuration.d.ts",
        "--include-runtime=false",
        "--strict-vars=false"
      ]);
    });

    it("passes cwd to exec runner", async () => {
      const { runner, calls } = makeCapturingExecRunner();
      const wrangler = createWranglerRunner(runner);

      await wrangler.runTypes("out.d.ts", [], "/my/project/dir");

      expect(calls[0].options.cwd).toBe("/my/project/dir");
    });

    it("sets shell: true for Windows compatibility", async () => {
      const { runner, calls } = makeCapturingExecRunner();
      const wrangler = createWranglerRunner(runner);

      await wrangler.runTypes("out.d.ts", [], "/project");

      expect(calls[0].options.shell).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // runTypes — result propagation
  // -------------------------------------------------------------------------

  describe("runTypes — result propagation", () => {
    it("returns exit code 0 and captured output on success", async () => {
      const wrangler = createWranglerRunner(
        makeExecRunner({
          exitCode: 0,
          stdout: "generated types\n",
          stderr: ""
        })
      );

      const result = await wrangler.runTypes("out.d.ts", [], "/project");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("generated types\n");
      expect(result.stderr).toBe("");
    });

    it("returns the non-zero exit code from wrangler", async () => {
      const wrangler = createWranglerRunner(
        makeExecRunner({
          exitCode: 1,
          stdout: "",
          stderr: "error: config not found\n"
        })
      );

      const result = await wrangler.runTypes("out.d.ts", [], "/project");

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("error: config not found\n");
    });

    it("returns null exit code when process is killed by a signal", async () => {
      const wrangler = createWranglerRunner(
        makeExecRunner({ exitCode: null, stdout: "", stderr: "" })
      );

      const result = await wrangler.runTypes("out.d.ts", [], "/project");

      expect(result.exitCode).toBeNull();
    });

    it("propagates errors thrown by the exec runner (e.g. ENOENT)", async () => {
      const err = new Error("spawn npx ENOENT");
      const wrangler = createWranglerRunner(async () => {
        throw err;
      });

      await expect(wrangler.runTypes("out.d.ts", [], "/project")).rejects.toThrow(
        "spawn npx ENOENT"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Default exec runner (no-arg constructor)
  // -------------------------------------------------------------------------

  describe("default exec runner", () => {
    it("creates a runner without requiring an exec runner argument", () => {
      // Smoke test: factory runs without throwing.
      expect(() => createWranglerRunner()).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// defaultExecRunner — real process integration
//
// These tests spawn real `node` processes (always available in the test environment) to
// exercise the spawn logic without requiring wrangler.
// ---------------------------------------------------------------------------

describe("defaultExecRunner (real process integration)", () => {
  it("resolves with exit code 0 and captured stdout", async () => {
    const result = await defaultExecRunner("node", ["-e", "process.stdout.write('hello stdout')"], {
      cwd: process.cwd(),
      shell: false
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello stdout");
    expect(result.stderr).toBe("");
  });

  it("resolves with a non-zero exit code and captured stderr", async () => {
    const result = await defaultExecRunner(
      "node",
      ["-e", "process.stderr.write('hello stderr'); process.exit(2)"],
      { cwd: process.cwd(), shell: false }
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("hello stderr");
  });

  it("accumulates multiple stdout chunks", async () => {
    const result = await defaultExecRunner(
      "node",
      ["-e", "process.stdout.write('a'); process.stdout.write('b')"],
      { cwd: process.cwd(), shell: false }
    );

    expect(result.stdout).toBe("ab");
  });

  it("rejects when the command cannot be spawned (real ENOENT)", async () => {
    await expect(
      defaultExecRunner("cloudflare-toolkit-definitely-not-a-real-binary", [], {
        cwd: process.cwd(),
        shell: false
      })
    ).rejects.toThrow();
  });
});
