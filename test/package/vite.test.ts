// Package-level export validation for `@adrianhall/cloudflare-toolkit/vite` (docs/SPECv2.md
// §5.1, §5.6, §7.2, issue #14). Imports the built package by name/subpath resolution against
// `dist/`, not a relative path — see guards.test.ts for why.
//
// `CloudflareAccessPluginOptions` is `export type`-only and has no runtime representation, so it
// is not asserted here.
import { describe, expect, it } from "vitest";
import * as vitePkg from "@adrianhall/cloudflare-toolkit/vite";

describe("dist vite/index.js — exports", () => {
  it("exports cloudflareAccessPlugin as a function", () => {
    expect(typeof vitePkg.cloudflareAccessPlugin).toBe("function");
  });

  it("exports exactly the documented runtime symbols", () => {
    expect(Object.keys(vitePkg).sort()).toStrictEqual(["cloudflareAccessPlugin"]);
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
