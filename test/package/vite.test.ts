import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as vitePkg from "@adrianhall/cloudflare-toolkit/vite";

describe("dist vite/index.js — exports", () => {
  it("exports cloudflareAccessPlugin as a function", () => {
    expect(typeof vitePkg.cloudflareAccessPlugin).toBe("function");
  });

  it("exports exactly the documented runtime symbols", () => {
    expect(Object.keys(vitePkg).sort()).toStrictEqual([
      "cloudflareAccessPlugin",
      "readTerraformOutputs",
      "requireTerraformOutputs"
    ]);
  });
});

describe("vite smoke test against the built dist/", () => {
  it("returns a dev-only, pre-enforced Vite plugin shape", () => {
    const plugin = vitePkg.cloudflareAccessPlugin();
    expect(plugin.name).toBe("cloudflare-access-dev");
    expect(plugin.apply).toBe("serve");
    expect(plugin.enforce).toBe("pre");
  });

  it("registers a connect middleware in configureServer that serves the dev login form", async () => {
    const plugin = vitePkg.cloudflareAccessPlugin();
    let middleware: unknown;
    const server = {
      middlewares: {
        use(mw: unknown) {
          middleware = mw;
        }
      }
    };
    (plugin.configureServer as unknown as (s: typeof server) => void)(server);
    expect(typeof middleware).toBe("function");

    const mw = middleware as (req: unknown, res: unknown, next: (err?: unknown) => void) => void;
    const headers: Record<string, string> = { cookie: "" };
    const req = {
      url: "/cdn-cgi/access/login",
      method: "GET",
      headers,
      rawHeaders: []
    };
    let statusCode = 0;
    let body: string | undefined;

    await new Promise<void>((resolve, reject) => {
      const res = {
        setHeader(name: string, value: string) {
          headers[`res:${name.toLowerCase()}`] = value;
        },
        // The login form ends the response directly (it never calls `next`) — resolve here,
        // mirroring the same req/res-driven resolution used by test/node/vite/plugin.test.ts.
        end(b?: string) {
          body = b;
          resolve();
        },
        get statusCode() {
          return statusCode;
        },
        set statusCode(value: number) {
          statusCode = value;
        }
      };
      mw(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
    });

    expect(statusCode).toBe(200);
    expect(body).toContain("Developer Login");
  });
});

describe("readTerraformOutputs/requireTerraformOutputs smoke test against the built dist/", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vite-pkg-terraform-outputs-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads outputs written by `terraform output -json`", async () => {
    const path = join(dir, "outputs.json");
    await writeFile(path, JSON.stringify({ hostname: { value: "demo.example.com" } }), "utf-8");

    expect(vitePkg.readTerraformOutputs({ path, keys: { hostname: "hostname" } })).toEqual({
      hostname: "demo.example.com"
    });
  });

  it("throws an actionable error when required outputs are missing", () => {
    const path = join(dir, "missing.json");

    expect(() =>
      vitePkg.requireTerraformOutputs({
        path,
        keys: { hostname: "hostname" },
        hint: "npm run deploy:infra"
      })
    ).toThrow(/npm run deploy:infra/);
  });
});
