/** @file Small private utilities shared by Node-only CLI binaries. */
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parse } from "dotenv";

/** Injectable dotenv loader. */
export interface EnvLoader {
  /** Loads variables without overwriting existing process environment values. */
  load(path: string): Promise<void>;
}

/** Injectable interactive confirmation prompt. */
export interface Prompter {
  /** Returns true only when the operator answers `y`, case-insensitively. */
  confirm(message: string): Promise<boolean>;
}

/** Creates the real dotenv loader used by CLI entry points. */
export function createEnvLoader(): EnvLoader {
  return {
    async load(path) {
      const parsed = parse(await readFile(path, "utf-8"));
      for (const [key, value] of Object.entries(parsed)) {
        process.env[key] ??= value;
      }
    }
  };
}

/** Creates the real stdin/stdout confirmation prompt used by CLI entry points. */
export function createPrompter(): Prompter {
  return {
    async confirm(message) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await new Promise<string>((resolve) => {
          rl.question(message, resolve);
          rl.once("close", () => resolve(""));
        });
        return answer.trim().toLowerCase() === "y";
      } finally {
        rl.close();
      }
    }
  };
}

/** Returns a readable message for an arbitrary thrown value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Returns the fallback when a value is falsy, preserving source CLI behavior. */
export function getValueDefault<T>(value: T | null | undefined, fallback: T): T {
  // Preserve the source CLI's intentional fallback for all falsy values.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return value || fallback;
}
