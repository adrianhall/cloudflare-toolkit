/** @file Adapter for the Cloudflare `cf` CLI. */
import spawn from "cross-spawn";

const PAGE_SIZE = 100;

/** Result returned by an injectable synchronous process runner. */
export interface ProcessResult {
  /** Process launch error, when the executable could not be started. */
  error?: Error;
  /** Process exit status, or null when unavailable. */
  status: number | null;
  /** Captured standard output. */
  stdout: string;
}

/** Injectable process runner used by the `cf` adapter. */
export type ProcessRunner = (command: string, args: string[]) => ProcessResult;

/** Operations required by Access reconciliation. */
export interface AccessApi {
  /** Lists all reusable policies. */
  listPolicies(): unknown[];
  /** Lists all Access applications. */
  listApplications(): unknown[];
  /** Creates a reusable policy. */
  createPolicy(body: unknown): unknown;
  /** Updates a reusable policy. */
  updatePolicy(id: string, body: unknown): unknown;
  /** Deletes a reusable policy. */
  deletePolicy(id: string): void;
  /** Creates an Access application. */
  createApplication(body: unknown): unknown;
  /** Updates an Access application. */
  updateApplication(id: string, body: unknown): unknown;
  /** Deletes an Access application. */
  deleteApplication(id: string): void;
}

function defaultRunner(command: string, args: string[]): ProcessResult {
  const result = spawn.sync(command, args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["inherit", "pipe", "inherit"]
  });
  return {
    error: result.error,
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : ""
  };
}

function parseOutput(result: ProcessResult): unknown {
  if (result.error) throw new Error(`Cannot launch cf: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`cf exited with status ${result.status ?? 1}.`);
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error(`cf returned malformed JSON: ${result.stdout}`);
  }
}

function page(value: unknown, requestedPage: number): { items: unknown[]; hasMore: boolean } {
  if (Array.isArray(value)) return { items: value, hasMore: value.length === PAGE_SIZE };
  if (value === null || typeof value !== "object")
    throw new Error("cf returned a malformed list response.");
  const response = value as Record<string, unknown>;
  const items =
    Array.isArray(response.result) ? response.result
    : Array.isArray(response.data) ? response.data
    : Array.isArray(response.items) ? response.items
    : undefined;
  if (items === undefined) throw new Error("cf returned a malformed list response.");
  if (response.result_info === undefined) return { items, hasMore: items.length === PAGE_SIZE };
  const info = response.result_info;
  if (info === null || typeof info !== "object")
    throw new Error("cf returned malformed pagination metadata.");
  const { page: current, total_pages: totalPages } = info as Record<string, unknown>;
  if (
    !Number.isInteger(current)
    || !Number.isInteger(totalPages)
    || (current as number) !== requestedPage
    || (totalPages as number) < requestedPage
  )
    throw new Error("cf returned malformed pagination metadata.");
  return { items, hasMore: (current as number) < (totalPages as number) };
}

/**
 * Creates an Access API backed by the installed `cf` executable.
 *
 * @param profile - Optional named `cf` authentication profile.
 * @param runner - Injectable process runner used by tests.
 * @returns An adapter for reusable policies and Access applications.
 */
export function createAccessApi(
  profile?: string,
  runner: ProcessRunner = defaultRunner
): AccessApi {
  const invoke = (args: string[]): unknown =>
    parseOutput(runner("cf", profile === undefined ? args : [...args, "--profile", profile]));
  const list = (resource: "policies" | "applications"): unknown[] => {
    const items: unknown[] = [];
    for (let pageNumber = 1; ; pageNumber++) {
      const response = page(
        invoke([
          "zero-trust",
          "access",
          resource,
          "list",
          "--page",
          String(pageNumber),
          "--per-page",
          String(PAGE_SIZE)
        ]),
        pageNumber
      );
      items.push(...response.items);
      if (!response.hasMore) return items;
    }
  };
  const mutate = (
    resource: "policies" | "applications",
    action: string,
    id?: string,
    body?: unknown
  ): unknown => {
    const args = ["zero-trust", "access", resource, action];
    if (id !== undefined) args.push(id);
    if (body !== undefined) args.push("--body", JSON.stringify(body));
    if (action === "delete") args.push("--force");
    return invoke(args);
  };
  return {
    listPolicies: () => list("policies"),
    listApplications: () => list("applications"),
    createPolicy: (body) => mutate("policies", "create", undefined, body),
    updatePolicy: (id, body) => mutate("policies", "update", id, body),
    deletePolicy: (id) => void mutate("policies", "delete", id),
    createApplication: (body) => mutate("applications", "create", undefined, body),
    updateApplication: (id, body) => mutate("applications", "update", id, body),
    deleteApplication: (id) => void mutate("applications", "delete", id)
  };
}
