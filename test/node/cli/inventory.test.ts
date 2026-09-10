import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BindingIndex,
  BindingKind,
  indexWorkerBindings
} from "../../../src/cli/inventory/bindings.js";
import {
  CloudflareRequestError,
  createLimit,
  get,
  inventoryError,
  list,
  request,
  segment
} from "../../../src/cli/inventory/http.js";
import {
  queryOtherProducts,
  queryPages,
  queryWorkers
} from "../../../src/cli/inventory/products.js";
import { buildDocument, renderTable } from "../../../src/cli/inventory/report.js";
import { run } from "../../../src/cli/inventory/run.js";
import type {
  InventoryContext,
  InventoryDocument,
  InventoryResource,
  InventorySection
} from "../../../src/cli/inventory/types.js";
import type { EnvLoader } from "../../../src/cli/internal/utils.js";

const envelope = (result: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify({ success: true, errors: [], result }), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });

function context(fetchImpl: typeof fetch): InventoryContext {
  return {
    accountId: "account/with space",
    token: "secret-token",
    fetchImpl,
    bindings: new BindingIndex(),
    bindingDiscoveryComplete: true,
    limit: createLimit(8),
    timeoutMs: 1_000,
    retries: 0,
    sleep: vi.fn().mockResolvedValue(undefined)
  };
}

const emptyLoader: EnvLoader = { load: vi.fn().mockResolvedValue(undefined) };
const argv = (...args: string[]) => ["node", "cf-inventory", ...args];
const requestUrl = (input: string | URL | Request): string =>
  typeof input === "string" ? input
  : input instanceof URL ? input.href
  : input.url;

afterEach(() => vi.restoreAllMocks());

describe("inventory bindings", () => {
  it("deduplicates, sorts, and ignores empty identifiers", () => {
    const index = new BindingIndex();
    index.add("x", "", "ignored");
    index.add("x", "id", "b");
    index.add("x", "id", "a");
    index.add("x", "id", "a");
    expect(index.get("x", "id")).toEqual(["a", "b"]);
    expect(index.get("missing", "id")).toEqual([]);
  });

  it("indexes every supported Worker binding shape", () => {
    const index = new BindingIndex();
    indexWorkerBindings(
      index,
      [
        { type: "kv_namespace", namespace_id: "kv" },
        { type: "d1", id: "d1" },
        { type: "r2_bucket", bucket_name: "r2" },
        { type: "queue", queue_name: "queue" },
        { type: "durable_object_namespace", namespace_id: "do" },
        { type: "durable_object_namespace", class_name: "Class" },
        { type: "durable_object_namespace", script_name: "script" },
        { type: "kv_namespace" },
        { type: "service", service: "service" },
        { type: "workflow", workflow_name: "workflow" },
        { type: "hyperdrive", id: "hyperdrive" },
        { type: "vectorize", index_name: "vector" },
        { type: "secrets_store_secret", store_id: "store", secret_name: "name" },
        { type: "analytics_engine", dataset: "dataset" },
        { type: "dispatch_namespace", namespace: "dispatch" },
        { type: "mtls_certificate", certificate_id: "cert" },
        { type: "pipeline", pipeline: "pipeline" },
        { type: "pipelines", pipeline: "pipelines" },
        { type: "unknown" },
        { type: "secrets_store_secret", store_id: "store" }
      ],
      "Worker:app",
      "owner"
    );
    expect(index.get(BindingKind.kv, "kv")).toEqual(["Worker:app"]);
    expect(index.get(BindingKind.durableObject, "class:Class@owner")).toEqual(["Worker:app"]);
    expect(index.get(BindingKind.secret, "store/name")).toEqual(["Worker:app"]);
    expect(index.get(BindingKind.pipeline, "pipelines")).toEqual(["Worker:app"]);
  });
});

describe("inventory HTTP", () => {
  it("requests a validated envelope without leaking credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(envelope({ ok: true }));
    const ctx = context(fetchImpl);
    await expect(get<{ ok: boolean }>(ctx, "/test")).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/test",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret-token" })
      })
    );
    expect(segment("a/b c")).toBe("a%2Fb%20c");
  });

  it("rejects malformed result_info containers", async () => {
    for (const resultInfo of [null, "invalid", []]) {
      const response = new Response(
        JSON.stringify({ success: true, errors: [], result: [], result_info: resultInfo })
      );
      await expect(
        request(context(vi.fn<typeof fetch>().mockResolvedValue(response)), "/malformed-info")
      ).rejects.toThrow("invalid Cloudflare API envelope");
    }
  });

  it("paginates array results", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        envelope(
          Array.from({ length: 100 }, (_, index) => index),
          {
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(envelope([100]));
    await expect(list<number>(context(fetchImpl), "/items?kind=x")).resolves.toHaveLength(101);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("&page=2&per_page=100");
  });

  it("stops pagination at reported total pages and rejects non-array pages", async () => {
    const withInfo = new Response(
      JSON.stringify({ success: true, errors: [], result: [1], result_info: { total_pages: 1 } })
    );
    await expect(
      list<number>(context(vi.fn<typeof fetch>().mockResolvedValue(withInfo)), "/x")
    ).resolves.toEqual([1]);
    await expect(
      list(context(vi.fn<typeof fetch>().mockResolvedValue(envelope({}))), "/x")
    ).rejects.toThrow("expected array");

    const fullPage = Array.from({ length: 100 }, (_, index) => index);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: fullPage,
            result_info: { total_pages: 2 }
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: fullPage,
            result_info: { total_pages: 2 }
          })
        )
      );
    await expect(list<number>(context(fetchImpl), "/two-pages")).resolves.toHaveLength(200);

    const shortPages = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: [1],
            result_info: { total_pages: 2 }
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: [2],
            result_info: { total_pages: 2 }
          })
        )
      );
    await expect(list<number>(context(shortPages), "/short-pages", 50)).resolves.toEqual([1, 2]);
    expect(shortPages.mock.calls[1]?.[0]).toContain("page=2&per_page=50");

    for (const totalPages of ["2", 1.5, 0]) {
      const malformed = new Response(
        JSON.stringify({
          success: true,
          errors: [],
          result: [],
          result_info: { total_pages: totalPages }
        })
      );
      await expect(
        list(context(vi.fn<typeof fetch>().mockResolvedValue(malformed)), "/malformed-pages")
      ).rejects.toThrow("invalid total_pages");
    }
  });

  it("retries transient HTTP and network failures", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response("down", { status: 500 }))
      .mockResolvedValueOnce(envelope([]));
    const ctx = { ...context(fetchImpl), retries: 3, sleep };
    await request(ctx, "/retry");
    expect(sleep).toHaveBeenNthCalledWith(1, 2_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);

    const network = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("socket secret-token"))
      .mockResolvedValueOnce(envelope([]));
    await request({ ...context(network), retries: 1, sleep }, "/network");
  });

  it("normalizes exhausted, malformed, and API failures", async () => {
    const failed = context(
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline secret-token"))
    );
    await expect(request(failed, "/x")).rejects.toMatchObject({
      status: 0,
      message: "request failed for /x: offline [redacted]"
    });
    await expect(
      request(context(vi.fn<typeof fetch>().mockRejectedValue("offline")), "/x")
    ).rejects.toThrow("offline");
    await expect(
      request(context(vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json"))), "/x")
    ).rejects.toThrow("non-JSON");
    await expect(
      request(context(vi.fn<typeof fetch>().mockResolvedValue(envelope(undefined))), "/x")
    ).rejects.toThrow("invalid Cloudflare API envelope");
    for (const invalid of [
      null,
      {},
      { success: true, errors: "bad", result: [] },
      { success: "yes", errors: [], result: [] }
    ])
      await expect(
        request(
          context(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(invalid)))),
          "/x"
        )
      ).rejects.toThrow("invalid Cloudflare API envelope");
    const apiFailure = new Response(
      JSON.stringify({
        success: false,
        errors: [{ code: 42, message: "permission denied for secret-token" }],
        result: null
      }),
      { status: 403 }
    );
    await expect(
      request(context(vi.fn<typeof fetch>().mockResolvedValue(apiFailure)), "/x")
    ).rejects.toMatchObject({
      status: 403,
      code: 42,
      message: "permission denied for [redacted]"
    });
    const genericFailure = new Response(
      JSON.stringify({ success: true, errors: [], result: null }),
      { status: 400 }
    );
    await expect(
      request(context(vi.fn<typeof fetch>().mockResolvedValue(genericFailure)), "/x")
    ).rejects.toThrow("HTTP 400");
  });

  it("normalizes product errors", () => {
    expect(
      inventoryError("x", "read", new CloudflareRequestError("not authorized", 401, 7))
    ).toMatchObject({
      code: 7,
      permissionDenied: true
    });
    expect(inventoryError("x", "read", "bad")).toMatchObject({
      message: "bad",
      permissionDenied: false
    });
    expect(inventoryError("x", "read", new Error("access denied"))).toMatchObject({
      message: "access denied",
      permissionDenied: false
    });
  });

  it("limits concurrent work and releases slots after rejection", async () => {
    const limit = createLimit(1);
    let release!: () => void;
    const first = limit(() => new Promise<void>((resolve) => (release = resolve)));
    let started = false;
    const second = limit(async () => {
      started = true;
      throw new Error("expected");
    });
    await Promise.resolve();
    expect(started).toBe(false);
    release();
    await first;
    await expect(second).rejects.toThrow("expected");
  });

  it("aborts requests at the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );
    const pending = request({ ...context(fetchImpl), timeoutMs: 5 }, "/slow");
    const rejection = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(5);
    await rejection;
    vi.useRealTimers();
  });
});

function richResult(path: string): unknown {
  if (path.endsWith("/workers/scripts")) return [{ id: "worker/name" }];
  if (path.includes("/workers/scripts/worker%2Fname/settings"))
    return {
      bindings: [
        { type: "d1", id: "d1-id" },
        { type: "service", service: "worker/name" }
      ]
    };
  if (path.includes("/workers/scripts/worker%2Fname/schedules")) return [{ cron: "* * * * *" }, {}];
  if (path.includes("/workers/scripts/worker%2Fname/deployments"))
    return { deployments: [{ id: "deployment" }] };
  if (path.endsWith("/workers/domains"))
    return [
      {
        id: "domain-id",
        hostname: "app.example.com",
        zone_name: "example.com",
        service: "worker/name"
      },
      { hostname: "missing.example.com", service: "missing-worker" },
      {}
    ];
  if (path.endsWith("/workers/subdomain")) return { subdomain: "account" };
  if (path.endsWith("/pages/projects"))
    return [
      {
        name: "pages",
        deployment_configs: {
          production: {
            d1_databases: { DB: { id: "d1-id" } },
            kv_namespaces: { KV: { namespace_id: "kv-id" } },
            r2_buckets: { R2: { name: "bucket" } },
            durable_object_namespaces: { DO: { namespace_id: "do-id" } },
            queue_producers: { Q: { name: "queue" } },
            services: { S: { service: "worker" } },
            vectorize: { V: { index_name: "vector" } },
            hyperdrive: { H: { id: "hyper" } },
            analytics_engine_datasets: { A: { dataset: "dataset" } }
          },
          preview: { d1_databases: { MISSING: {} } }
        }
      }
    ];
  if (path.includes("/d1/database")) return [{ name: "database", uuid: "d1-id" }];
  if (path.includes("/storage/kv/namespaces")) return [{ title: "namespace", id: "kv-id" }];
  if (path.includes("/r2/buckets/") && path.endsWith("/domains/custom"))
    return { domains: [{ domain: "assets.example.com" }] };
  if (path.includes("/event_notifications/r2/empty/")) return [];
  if (path.includes("/event_notifications/r2/")) return [{ rules: [{ id: "rule" }] }, {}];
  if (path.includes("/r2-catalog/empty")) return {};
  if (path.includes("/r2-catalog/")) return { status: "ready" };
  if (path.includes("/r2/buckets")) return { buckets: [{ name: "bucket" }, { name: "empty" }] };
  if (path.includes("/artifacts/namespaces/") && path.endsWith("/repos"))
    return [{ name: "repo", id: "repo-id" }, {}];
  if (path.includes("/artifacts/namespaces")) return [{ namespace: "artifacts" }];
  if (path.includes("/queues/") && path.endsWith("/consumers")) return [{ id: "consumer" }];
  if (path.includes("/queues")) return [{ queue_name: "queue", queue_id: "queue-id" }];
  if (path.includes("/workflows/") && path.includes("/instances")) return [];
  if (path.includes("/workflows")) return [{ name: "workflow", id: "workflow-id" }];
  if (path.includes("/pipelines/")) return [{ name: "pipeline", id: "pipeline-id" }];
  if (path.includes("/hyperdrive/configs")) return [{ name: "hyperdrive", id: "hyper" }];
  if (path.includes("/secrets_store/stores/") && path.endsWith("/secrets"))
    return [{ name: "secret", id: "secret-id" }, {}];
  if (path.includes("/secrets_store/stores"))
    return [{ name: "default_secrets_store", id: "store" }, { name: "store-without-id" }];
  if (path.includes("/vectorize/v2/indexes/array-index/metadata_index/list"))
    return [{ propertyName: "array" }];
  if (path.includes("/vectorize/") && path.endsWith("/metadata_index/list"))
    return { metadataIndexes: [{ propertyName: "tenant" }, { property_name: "category" }, {}] };
  if (path.includes("/vectorize/")) return [{ name: "vector" }, { name: "array-index" }];
  if (path.includes("/ai/finetunes")) return [{ name: "tune", id: "tune-id" }, {}];
  if (path.includes("/ai-gateway/gateways/") && path.endsWith("/custom-domains"))
    return [{ hostname: "gateway.example.com" }];
  if (path.includes("/ai-gateway/gateways/") && path.endsWith("/routes")) return [{ id: "route" }];
  if (path.includes("/ai-gateway/gateways")) return [{ id: "default" }];
  if (path.includes("/ai-search/namespaces/") && path.endsWith("/instances"))
    return [
      { id: "search", source: "bucket", ai_gateway_id: "default" },
      { source: "source-only" },
      {}
    ];
  if (path.includes("/ai-search/namespaces")) return [{ name: "default" }];
  if (path.includes("/durable_objects/")) return [{ name: "object", id: "do-id" }];
  if (path.includes("/containers/applications/") && path.endsWith("/versions"))
    return [{ id: "version" }];
  if (path.includes("/containers/applications/") && path.endsWith("/instances"))
    return [{ id: "instance" }];
  if (path.includes("/containers/applications"))
    return [{ name: "container", id: "container-id" }, { name: "container-without-id" }];
  if (path.includes("/containers/registries")) return [{ domain: "registry", id: "registry-id" }];
  if (path.includes("/workers/dispatch/"))
    return [
      { namespace_name: "dispatch", namespace_id: "dispatch-id", script_count: 2 },
      { namespace_name: "empty-dispatch", namespace_id: "empty-dispatch-id" }
    ];
  if (path.includes("/connectivity/"))
    return [{ name: "vpc", service_id: "vpc-id", type: "tcp", tcp_port: 42 }];
  if (path.includes("/images/v1/variants"))
    return { variants: { public: { id: "public" }, custom: {} } };
  if (path.includes("/images/v1/keys")) return { keys: [{ name: "key", id: "key-id" }, {}] };
  if (path.includes("/images/v2")) return { images: [{ filename: "image", id: "image-id" }] };
  if (path.includes("/stream/live_inputs")) return { live_inputs: [{ uid: "live" }] };
  if (path.includes("/stream")) return [{ uid: "video" }];
  if (path.includes("/challenges/widgets")) return [{ name: "widget", sitekey: "sitekey" }];
  if (path.includes("/calls/apps")) return [{ name: "calls", uid: "calls-id" }];
  if (path.includes("/calls/turn_keys")) return [{ name: "turn", uid: "turn-id" }];
  if (path.includes("/realtime/kit/apps")) return [{ name: "kit", id: "kit-id" }];
  if (path.includes("/mtls_certificates/") && path.endsWith("/associations"))
    return [{ service: "worker" }];
  if (path.includes("/mtls_certificates"))
    return Array.from({ length: 100 }, (_, index) => ({
      name: `cert-${index}`,
      id: `cert-${index}`
    }));
  if (path.includes("/logpush/jobs"))
    return [{ name: "logs", id: 1, destination_conf: "r2://bucket?secret=value", enabled: true }];
  if (path.includes("/email/routing/addresses"))
    return [{ email: "a@example.com", id: "address-id" }];
  if (path.includes("/analytics_engine/sql")) return { data: [{ name: "dataset" }] };
  throw new Error(`unexpected inventory endpoint: ${path}`);
}

function emptyResult(path: string): unknown {
  if (path.endsWith("/r2/buckets")) return { buckets: [] };
  if (path.endsWith("/images/v2")) return { images: [] };
  if (path.endsWith("/images/v1/variants")) return { variants: {} };
  if (path.endsWith("/images/v1/keys")) return { keys: [] };
  if (path.endsWith("/stream/live_inputs")) return { live_inputs: [] };
  if (path.endsWith("/analytics_engine/sql")) return { data: [] };
  return [];
}

describe("inventory product discovery", () => {
  it("discovers and cross-references every product deterministically", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(requestUrl(input)).pathname;
      return envelope(richResult(path));
    });
    const ctx = context(fetchImpl);
    const workers = await queryWorkers(ctx);
    const pages = await queryPages(ctx);
    const products = await queryOtherProducts(ctx);
    const document = buildDocument("account", [workers, pages, ...products]);
    expect(document.summary.products).toBe(27);
    expect(document.status).toBe("complete");
    expect(document.resources.length).toBeGreaterThan(25);
    expect(
      [...new Set(document.resources.map((row) => `${row.product}/${row.resourceType}`))].sort()
    ).toEqual(
      [
        "AI Gateway/Gateway",
        "AI Search/Instance",
        "AI Search/Namespace",
        "Analytics Engine/Dataset",
        "Artifacts/Namespace",
        "Artifacts/Repo",
        "Containers/Application",
        "Containers/External Registry",
        "D1/Database",
        "Durable Objects/Namespace",
        "Email Routing/Destination Address",
        "Hyperdrive/Config",
        "Images/Image",
        "Images/Signing Key",
        "Images/Variant",
        "KV/Namespace",
        "Logpush/Job",
        "Pages/Project",
        "Pipelines/Pipeline",
        "Queues/Queue",
        "R2/Bucket",
        "Realtime/Calls App",
        "Realtime/RealtimeKit App",
        "Realtime/TURN Key",
        "Secrets Store/Secret",
        "Secrets Store/Store",
        "Stream/Live Input",
        "Stream/Video",
        "Turnstile/Widget",
        "Vectorize/Index",
        "Workers AI/Fine-tune",
        "Workers for Platforms/Dispatch Namespace",
        "Workers VPC/Connectivity Service",
        "Workers/Account Subdomain",
        "Workers/Custom Domain",
        "Workers/Worker",
        "Workflows/Workflow",
        "mTLS Certificates/Certificate"
      ].sort()
    );
    expect(document.resources.find((row) => row.product === "D1")).toMatchObject({
      referencedBy: ["Pages:pages", "Worker:worker/name"],
      deletionStatus: "No"
    });
    expect(document.resources.find((row) => row.product === "Queues")).toMatchObject({
      deletionStatus: "No",
      deletionBlockers: ["1 attached association(s)"]
    });
    expect(
      document.resources.find((row) => row.product === "Logpush")?.details.destination_conf
    ).toBe("r2://bucket?[redacted]");
    expect(document.resources.find((row) => row.product === "Workers AI")?.deletionStatus).toBe(
      "Unknown"
    );
    expect(
      document.resources.find(
        (row) => row.product === "Workers for Platforms" && row.name === "dispatch"
      )
    ).toMatchObject({ deletionStatus: "No" });
    expect(JSON.stringify(document)).not.toContain("secret=value");
    expect(
      fetchImpl.mock.calls.filter(([input]) =>
        new URL(requestUrl(input)).pathname.endsWith("/mtls_certificates")
      )
    ).toHaveLength(1);
  });

  it("isolates phase-one and product failures and marks discovery partial", async () => {
    const denied = new Response(
      JSON.stringify({ success: false, errors: [{ message: "forbidden" }], result: null }),
      { status: 403 }
    );
    const ctx = context(vi.fn<typeof fetch>().mockResolvedValue(denied));
    const workers = await queryWorkers(ctx);
    const pages = await queryPages(ctx);
    const products = await queryOtherProducts(ctx);
    const document = buildDocument("account", [workers, pages, ...products]);
    expect(ctx.bindingDiscoveryComplete).toBe(false);
    expect(document.status).toBe("partial");
    expect(document.summary.errors).toBeGreaterThan(20);
  });

  it("rejects malformed Worker and Pages results without claiming complete binding discovery", async () => {
    const workersContext = context(vi.fn<typeof fetch>().mockResolvedValue(envelope([null])));
    const workers = await queryWorkers(workersContext);
    expect(workers.errors[0]?.message).toContain("entries to be objects");
    expect(workersContext.bindingDiscoveryComplete).toBe(false);

    const primitiveContext = context(vi.fn<typeof fetch>().mockResolvedValue(envelope([1])));
    expect((await queryWorkers(primitiveContext)).errors[0]?.message).toContain(
      "entries to be objects"
    );

    const pagesContext = context(vi.fn<typeof fetch>().mockResolvedValue(envelope(null)));
    const pages = await queryPages(pagesContext);
    expect(pages.errors[0]?.message).toContain("expected array");
    expect(pagesContext.bindingDiscoveryComplete).toBe(false);
  });

  it("fails closed on malformed cursors and failed secret pagination", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(requestUrl(input)).pathname;
      if (path.endsWith("/r2/buckets")) return envelope(null);
      if (path.endsWith("/images/v2"))
        return envelope({ images: [], continuation_token: "repeated" });
      if (path.endsWith("/secrets_store/stores")) return envelope([{ id: "store", name: "store" }]);
      if (path.endsWith("/secrets_store/stores/store/secrets"))
        return new Response(
          JSON.stringify({ success: false, errors: [{ message: "denied" }], result: null }),
          { status: 403 }
        );
      return envelope(emptyResult(path));
    });
    const products = await queryOtherProducts(context(fetchImpl));
    expect(products.find((value) => value.product === "R2")?.errors[0]?.message).toContain(
      "expected object result"
    );
    expect(products.find((value) => value.product === "Images")?.errors[0]?.message).toContain(
      "repeated pagination cursor"
    );
    expect(products.find((value) => value.product === "Secrets Store")?.errors[0]).toMatchObject({
      status: 403,
      permissionDenied: true
    });

    for (const [r2Cursor, imagesCursor] of [
      [null, 1],
      ["", null]
    ]) {
      const malformedCursorFetch = vi.fn<typeof fetch>(async (input) => {
        const path = new URL(requestUrl(input)).pathname;
        if (path.endsWith("/r2/buckets"))
          return new Response(
            JSON.stringify({
              success: true,
              errors: [],
              result: { buckets: [] },
              result_info: { cursor: r2Cursor }
            })
          );
        if (path.endsWith("/images/v2"))
          return envelope({ images: [], continuation_token: imagesCursor });
        return envelope(emptyResult(path));
      });
      const malformedProducts = await queryOtherProducts(context(malformedCursorFetch));
      expect(
        malformedProducts.find((value) => value.product === "R2")?.errors[0]?.message
      ).toContain("invalid pagination cursor");
      expect(
        malformedProducts.find((value) => value.product === "Images")?.errors[0]?.message
      ).toContain("invalid pagination cursor");
    }
  });

  it("paginates Pages bindings, R2, Images, and Secrets Store metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(requestUrl(input));
      const path = url.pathname;
      const page = url.searchParams.get("page");
      const cursor = url.searchParams.get("cursor");
      const continuationToken = url.searchParams.get("continuation_token");
      const response = (result: unknown, resultInfo?: Record<string, unknown>): Response =>
        new Response(
          JSON.stringify({ success: true, errors: [], result, result_info: resultInfo })
        );
      if (path.endsWith("/pages/projects"))
        return page === "2" ?
            response(
              [
                {
                  name: "second-page",
                  deployment_configs: {
                    production: { d1_databases: { DB: { id: "page-two-d1" } } }
                  }
                }
              ],
              { total_pages: 2 }
            )
          : response([{ name: "first-page" }], { total_pages: 2 });
      if (path.endsWith("/r2/buckets"))
        return cursor === "r2-next" ?
            response({ buckets: [{ name: "r2-second" }] })
          : response({ buckets: [{ name: "r2-first" }] }, { cursor: "r2-next" });
      if (path.endsWith("/images/v2"))
        return continuationToken === "images-next" ?
            response({ images: [{ id: "image-second" }] })
          : response({ images: [{ id: "image-first" }], continuation_token: "images-next" });
      if (path.endsWith("/secrets_store/stores")) return response([{ id: "store", name: "store" }]);
      if (path.endsWith("/secrets_store/stores/store/secrets"))
        return page === "2" ?
            response([{ id: "secret-two", name: "secret-two" }], { total_pages: 2 })
          : response([{ id: "secret-one", name: "secret-one" }], { total_pages: 2 });
      if (path.includes("/r2/buckets/") && path.endsWith("/domains/custom"))
        return response({ domains: [] });
      if (path.includes("/event_notifications/r2/")) return response([]);
      if (path.includes("/r2-catalog/")) return response({});
      if (path.endsWith("/images/v1/variants")) return response({ variants: {} });
      if (path.endsWith("/images/v1/keys")) return response({ keys: [] });
      if (path.endsWith("/stream/live_inputs")) return response({ live_inputs: [] });
      if (path.endsWith("/analytics_engine/sql")) return response({ data: [] });
      return response([]);
    });
    const ctx = context(fetchImpl);
    const pages = await queryPages(ctx);
    const products = await queryOtherProducts(ctx);
    expect(ctx.bindings.get(BindingKind.d1, "page-two-d1")).toEqual(["Pages:second-page"]);
    expect(pages.resources).toHaveLength(2);
    expect(products.find((value) => value.product === "R2")?.resources).toHaveLength(2);
    expect(
      products
        .find((value) => value.product === "Images")
        ?.resources.filter((row) => row.resourceType === "Image")
    ).toHaveLength(2);
    expect(
      products
        .find((value) => value.product === "Secrets Store")
        ?.resources.filter((row) => row.resourceType === "Secret")
    ).toHaveLength(2);
    expect(fetchImpl.mock.calls.some(([input]) => requestUrl(input).includes("per_page=50"))).toBe(
      true
    );
    expect(
      fetchImpl.mock.calls.some(([input]) =>
        requestUrl(input).includes("continuation_token=images-next")
      )
    ).toBe(true);
  });

  it("retains rows when Worker settings and blocker lookups fail", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(requestUrl(input)).pathname;
      if (path.endsWith("/workers/scripts")) return envelope([{ name: "named" }, {}]);
      if (path.includes("/workers/scripts/") && path.endsWith("/settings")) return envelope({});
      if (path.includes("/workers/scripts/named/deployments")) return envelope([]);
      if (
        (path.includes("/workers/scripts/")
          && (path.endsWith("/schedules") || path.endsWith("/deployments")))
        || path.endsWith("/workers/domains")
        || path.endsWith("/workers/subdomain")
      )
        return new Response(
          JSON.stringify({ success: false, errors: [{ message: "denied" }], result: null }),
          { status: 403 }
        );
      if (path.endsWith("/pages/projects")) return envelope([{ id: "page-id" }, {}]);
      if (path.endsWith("/queues")) return envelope([{ name: "queue", queue_id: "queue-id" }]);
      if (path.endsWith("/mtls_certificates")) return envelope([{ id: "cert-id" }]);
      if (path.endsWith("/workflows"))
        return envelope([
          { name: "ok", id: "workflow-ok" },
          { name: "fail", id: "workflow-fail" }
        ]);
      if (path.includes("/workflows/ok/instances"))
        return new Response(
          JSON.stringify({
            success: true,
            errors: [],
            result: [],
            result_info: { total_count: 3 }
          })
        );
      if (path.includes("/workflows/fail/instances"))
        return new Response(
          JSON.stringify({ success: false, errors: [{ message: "denied" }], result: null }),
          { status: 403 }
        );
      if (path.endsWith("/consumers")) return envelope([]);
      if (path.endsWith("/associations"))
        return new Response(
          JSON.stringify({ success: false, errors: [{ message: "denied" }], result: null }),
          { status: 403 }
        );
      if (path.endsWith("/logpush/jobs"))
        return envelope([{ id: 1, destination_conf: "https://example.com/no-query" }]);
      if (path.endsWith("/email/routing/addresses"))
        return envelope([{ id: "address", email: "a@example.com" }]);
      if (path.endsWith("/analytics_engine/sql")) return envelope([{ table: "dataset" }, {}]);
      return envelope([]);
    });
    const ctx = context(fetchImpl);
    const workers = await queryWorkers(ctx);
    const pages = await queryPages(ctx);
    const products = await queryOtherProducts(ctx);
    const document = buildDocument("account", [workers, pages, ...products]);
    expect(workers.resources).toHaveLength(2);
    expect(workers.errors).toHaveLength(7);
    expect(pages.resources.map((value) => value.name)).toEqual(["page-id", "unknown"]);
    expect(products.find((value) => value.product === "Queues")?.resources[0]).toMatchObject({
      deletionDiscoveryComplete: false
    });
    expect(products.find((value) => value.product === "mTLS Certificates")?.errors).toHaveLength(1);
    expect(products.find((value) => value.product === "Analytics Engine")?.resources).toHaveLength(
      1
    );
    expect(
      document.resources.find(
        (value) => value.product === "Workers" && value.resourceType === "Worker"
      )
    ).toMatchObject({ deletionStatus: "Unknown" });
    expect(document.resources.find((value) => value.product === "Pages")).toMatchObject({
      deletionStatus: "Unknown"
    });
    expect(document.resources.find((value) => value.product === "mTLS Certificates")).toMatchObject(
      { deletionStatus: "Unknown" }
    );
    expect(document.resources.find((value) => value.product === "Email Routing")).toMatchObject({
      deletionStatus: "Yes"
    });
  });
});

function row(overrides: Partial<InventoryResource> = {}): InventoryResource {
  return {
    product: "R2",
    resourceType: "Bucket",
    name: "bucket",
    id: "id",
    details: { z: "last", a: "first" },
    referencedBy: [],
    deletionBlockers: [],
    deletionDiscoveryComplete: true,
    ...overrides
  };
}

describe("inventory reports", () => {
  it("renders Yes, No, and Unknown assessments, errors, notes, and empty inventories", () => {
    const sections: InventorySection[] = [
      {
        product: "R2",
        resources: [
          row(),
          row({ name: "bound", referencedBy: ["Worker:z", "Worker:a"] }),
          row({ name: "blocked", deletionBlockers: ["objects"] }),
          row({ name: "unknown", deletionDiscoveryComplete: false, id: null })
        ],
        errors: [
          {
            product: "R2",
            operation: "read",
            message: "failed",
            permissionDenied: false
          },
          {
            product: "R2",
            operation: "read",
            message: "another failure",
            permissionDenied: false
          }
        ],
        coverageNotes: ["objects not scanned"]
      }
    ];
    const document = buildDocument("account", sections);
    expect(document.summary.deletion).toEqual({ Yes: 1, No: 2, Unknown: 1 });
    expect(document.resources[0]?.details).toEqual({ a: "first", z: "last" });
    expect(renderTable(document, true)).toContain("Coverage notes:");
    expect(renderTable(document, false)).not.toContain("Coverage notes:");
    expect(renderTable(buildDocument("account", []), false)).toContain("No resources found.");
  });
});

describe("cf-inventory orchestration", () => {
  it("handles help, version, arguments, credentials, and env-file failures", async () => {
    const base = {
      fetchImpl: vi.fn<typeof fetch>(),
      envLoader: emptyLoader,
      env: {},
      logSink: vi.fn()
    };
    expect(await run(argv("--help"), base)).toBe(0);
    expect(await run(argv("--version"), base)).toBe(0);
    expect(await run(argv("--bad"), base)).toBe(6);
    expect(await run(argv("-q", "-v"), base)).toBe(6);
    expect(await run(argv("--format", "yaml"), base)).toBe(6);
    expect(await run(argv(), base)).toBe(2);
    expect(
      await run(argv(), {
        ...base,
        env: { CLOUDFLARE_ACCOUNT_ID: "account" }
      })
    ).toBe(2);
    const envLoader: EnvLoader = { load: vi.fn().mockRejectedValue("bad env") };
    expect(await run(argv("--env-file", ".env"), { ...base, envLoader })).toBe(2);
    const errorLoader: EnvLoader = { load: vi.fn().mockRejectedValue(new Error("bad env")) };
    expect(await run(argv("--env-file", ".env"), { ...base, envLoader: errorLoader })).toBe(2);

    process.env.CLOUDFLARE_ACCOUNT_ID = "account";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(
      await run(argv(), {
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockImplementation(async (input) =>
            envelope(emptyResult(new URL(requestUrl(input)).pathname))
          ),
        envLoader: emptyLoader,
        logSink: vi.fn()
      })
    ).toBe(0);
    expect(stdout).toHaveBeenCalled();
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
  });

  it("emits table and JSON and returns partial discovery", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      envelope(richResult(new URL(requestUrl(input)).pathname))
    );
    const output: string[] = [];
    const deps = {
      fetchImpl,
      envLoader: emptyLoader,
      env: { CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_API_TOKEN: "token" },
      write: (value: string) => output.push(value),
      logSink: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined)
    };
    expect(await run(argv("--format", "json", "-v", "-a", "account", "-k", "token"), deps)).toBe(0);
    const document = JSON.parse(output[0] ?? "") as InventoryDocument;
    expect(document).toMatchObject({ schemaVersion: 1, status: "complete" });
    expect(
      document.resources.find(
        (resource) => resource.product === "Workers" && resource.resourceType === "Worker"
      )
    ).toMatchObject({ referencedBy: ["Worker:worker/name"], deletionStatus: "No" });
    output.length = 0;
    expect(await run(argv(), deps)).toBe(0);
    expect(output[0]).toContain("CAN DELETE");
    expect(await run(argv("-q"), deps)).toBe(0);

    const failed = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, errors: [{ message: "denied" }], result: null }),
        {
          status: 403
        }
      )
    );
    expect(await run(argv(), { ...deps, fetchImpl: failed })).toBe(3);
  });

  it("returns 99 for parser and unexpected discovery failures", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(Command.prototype, "parse").mockImplementationOnce(() => {
      throw new Error("parser");
    });
    const deps = {
      fetchImpl: vi.fn<typeof fetch>(),
      envLoader: emptyLoader,
      env: { CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_API_TOKEN: "token" },
      logSink: vi.fn()
    };
    expect(await run(argv(), deps)).toBe(99);
    expect(stderr).toHaveBeenCalled();
    expect(
      await run(argv(), {
        ...deps,
        fetchImpl: vi.fn<typeof fetch>(() => {
          throw new Error("synchronous failure");
        })
      })
    ).toBe(3);
    expect(
      await run(argv(), {
        ...deps,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(envelope([])),
        write: () => {
          throw new Error("output failed");
        }
      })
    ).toBe(99);
    expect(
      await run(argv(), {
        ...deps,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(envelope([])),
        write: () => {
          // Exercise defensive normalization for non-Error third-party throws.
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "output failed";
        }
      })
    ).toBe(99);
  });
});
