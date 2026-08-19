import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("cross-spawn", () => ({ default: { sync: spawnSync } }));

import type { ProcessResult, ProcessRunner } from "../../../src/cli/access-policy/cf.js";
import { createAccessApi } from "../../../src/cli/access-policy/cf.js";

const result = (value: unknown): ProcessResult => ({ status: 0, stdout: JSON.stringify(value) });

describe("cf Access adapter", () => {
  beforeEach(() => spawnSync.mockReset());

  it("uses cross-spawn with inherited auth environment and parses direct arrays", () => {
    spawnSync.mockReturnValue({ status: 0, stdout: "[]" });
    expect(createAccessApi().listPolicies()).toEqual([]);
    expect(spawnSync).toHaveBeenCalledWith(
      "cf",
      expect.arrayContaining(["policies", "--page", "1", "--per-page", "100"]),
      expect.objectContaining({ env: process.env, stdio: ["inherit", "pipe", "inherit"] })
    );
  });

  it("normalizes non-string stdout from cross-spawn", () => {
    spawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("[]") });
    expect(() => createAccessApi().listPolicies()).toThrow(/malformed JSON/);
  });

  it("paginates result envelopes and forwards a named profile", () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ id: String(index) }));
    const runner = vi
      .fn<ProcessRunner>()
      .mockReturnValueOnce(result({ result: first, result_info: { page: 1, total_pages: 2 } }))
      .mockReturnValueOnce(
        result({ result: [{ id: "last" }], result_info: { page: 2, total_pages: 2 } })
      );
    expect(createAccessApi("work", runner).listApplications()).toHaveLength(101);
    expect(runner.mock.calls[0][1]).toContain("work");
  });

  it("uses conservative pagination without metadata and accepts data envelopes", () => {
    const first = Array.from({ length: 100 }, () => ({}));
    const runner = vi
      .fn<ProcessRunner>()
      .mockReturnValueOnce(result({ data: first }))
      .mockReturnValueOnce(result({ data: [] }));
    expect(createAccessApi(undefined, runner).listPolicies()).toHaveLength(100);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("paginates direct arrays until cf returns a short page", () => {
    const fullPage = Array.from({ length: 100 }, () => ({}));
    const runner = vi
      .fn<ProcessRunner>()
      .mockReturnValueOnce(result(fullPage))
      .mockReturnValueOnce(result([{ id: "last" }]));
    expect(createAccessApi(undefined, runner).listApplications()).toHaveLength(101);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("requests one final page after a full final direct-array page", () => {
    const fullPage = Array.from({ length: 100 }, () => ({}));
    const runner = vi
      .fn<ProcessRunner>()
      .mockReturnValueOnce(result(fullPage))
      .mockReturnValueOnce(result(fullPage))
      .mockReturnValueOnce(result([]));
    expect(createAccessApi(undefined, runner).listPolicies()).toHaveLength(200);
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it("accepts the proven items list envelope", () => {
    expect(
      createAccessApi(undefined, () => result({ items: [{ id: "one" }] })).listPolicies()
    ).toEqual([{ id: "one" }]);
  });

  it("builds every mutation command and unwraps no output itself", () => {
    const runner = vi.fn<ProcessRunner>().mockReturnValue(result({ result: { id: "id" } }));
    const api = createAccessApi(undefined, runner);
    expect(api.createPolicy({ name: "p" })).toEqual({ result: { id: "id" } });
    api.updatePolicy("p", { name: "p" });
    api.deletePolicy("p");
    api.createApplication({ name: "a" });
    api.updateApplication("a", { name: "a" });
    api.deleteApplication("a");
    expect(runner.mock.calls.map((call) => call[1].slice(2, 5))).toEqual([
      ["policies", "create", "--body"],
      ["policies", "update", "p"],
      ["policies", "delete", "p"],
      ["applications", "create", "--body"],
      ["applications", "update", "a"],
      ["applications", "delete", "a"]
    ]);
    expect(runner.mock.calls[2][1]).toContain("--force");
  });

  it("fails clearly for launch, exit, and JSON failures", () => {
    expect(() =>
      createAccessApi(undefined, () => ({
        error: new Error("missing"),
        status: null,
        stdout: ""
      })).listPolicies()
    ).toThrow("Cannot launch cf");
    expect(() =>
      createAccessApi(undefined, () => ({ status: null, stdout: "" })).listPolicies()
    ).toThrow("status 1");
    expect(() =>
      createAccessApi(undefined, () => ({ status: 0, stdout: "bad" })).listPolicies()
    ).toThrow("malformed JSON");
  });

  it.each([
    [null],
    [{}],
    [{ result: [], result_info: null }],
    [{ result: [], result_info: { page: 0, total_pages: 1 } }],
    [{ result: [], result_info: { page: 1, total_pages: "1" } }],
    [{ result: [], result_info: { page: 1, total_pages: 0 } }]
  ])("rejects malformed list response %#", (value) => {
    expect(() => createAccessApi(undefined, () => result(value)).listPolicies()).toThrow(
      /malformed/
    );
  });
});
