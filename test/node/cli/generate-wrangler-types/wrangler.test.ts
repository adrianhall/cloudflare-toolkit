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
  calls: {
    command: string;
    args: string[];
    options: { cwd: string };
  }[];
} {
  const calls: {
    command: string;
    args: string[];
    options: { cwd: string };
  }[] = [];
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

    // SEC-002: no `shell` option is ever passed to the exec runner — `defaultExecRunner` spawns
    // via `cross-spawn`, which resolves Windows `.cmd` shims and quotes arguments internally
    // instead of relying on an unescaped `shell: true` string.
    it("never requests an unescaped shell from the exec runner", async () => {
      const { runner, calls } = makeCapturingExecRunner();
      const wrangler = createWranglerRunner(runner);

      await wrangler.runTypes("out.d.ts", [], "/project");

      expect(calls[0].options).not.toHaveProperty("shell");
    });

    it("passes outputPath and extraArgs containing shell metacharacters through untouched", async () => {
      // A value like this would be interpreted as separate shell commands / expansions if ever
      // handed to a shell unescaped. It must arrive as a single, literal argv element.
      const malicious = "x; rm -rf ~ && echo $(whoami) | tee /tmp/pwned `id` > out";
      const { runner, calls } = makeCapturingExecRunner();
      const wrangler = createWranglerRunner(runner);

      await wrangler.runTypes(malicious, [malicious], "/project");

      expect(calls[0].args).toEqual(["wrangler", "types", malicious, malicious]);
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
      cwd: process.cwd()
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello stdout");
    expect(result.stderr).toBe("");
  });

  it("resolves with a non-zero exit code and captured stderr", async () => {
    const result = await defaultExecRunner(
      "node",
      ["-e", "process.stderr.write('hello stderr'); process.exit(2)"],
      { cwd: process.cwd() }
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("hello stderr");
  });

  it("accumulates multiple stdout chunks", async () => {
    const result = await defaultExecRunner(
      "node",
      ["-e", "process.stdout.write('a'); process.stdout.write('b')"],
      { cwd: process.cwd() }
    );

    expect(result.stdout).toBe("ab");
  });

  it("rejects when the command cannot be spawned (real ENOENT)", async () => {
    await expect(
      defaultExecRunner("cloudflare-toolkit-definitely-not-a-real-binary", [], {
        cwd: process.cwd()
      })
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // SEC-002 regression — no shell interpretation of arguments
  // -------------------------------------------------------------------------

  it("passes an argument containing shell metacharacters through as a single literal value, never interpreted by a shell", async () => {
    // Each of these metacharacters would trigger command substitution, piping, redirection, or
    // command chaining if this string were ever handed to a shell unescaped. The child process
    // below echoes back its raw argv so we can assert the value arrived byte-for-byte intact —
    // proof that no shell ever parsed it.
    const malicious = "; echo pwned && $(whoami) | tee /tmp/cloudflare-toolkit-sec-002 `id` > out";

    const result = await defaultExecRunner(
      "node",
      ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", malicious],
      { cwd: process.cwd() }
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([malicious]);
  });
});
