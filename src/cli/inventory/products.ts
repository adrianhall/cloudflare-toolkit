/** @file Two-phase Cloudflare product discovery. */
import { BindingKind, indexWorkerBindings } from "./bindings.js";
import { get, inventoryError, list, request, segment } from "./http.js";
import type { InventoryContext, InventoryResource, InventorySection } from "./types.js";

type RecordValue = Record<string, unknown>;

const unavailableReverseApi =
  "Cloudflare exposes no complete read-only reverse-binding API for this product; an unreferenced resource remains Unknown.";
const storedContentNotScanned =
  "Stored content is not enumerated; deletion may still be blocked by content that this inventory does not inspect.";

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function records(value: unknown): RecordValue[] {
  if (!Array.isArray(value)) throw new Error("expected an array result");
  if (value.some((item) => item === null || typeof item !== "object"))
    throw new Error("expected array entries to be objects");
  return value as RecordValue[];
}
function resource(
  input: Omit<
    InventoryResource,
    "details" | "referencedBy" | "deletionBlockers" | "deletionDiscoveryComplete"
  >
    & Partial<
      Pick<
        InventoryResource,
        "details" | "referencedBy" | "deletionBlockers" | "deletionDiscoveryComplete"
      >
    >
): InventoryResource {
  return {
    details: {},
    referencedBy: [],
    deletionBlockers: [],
    deletionDiscoveryComplete: false,
    ...input
  };
}

function section(product: string, coverageNotes: string[] = []): InventorySection {
  return { product, resources: [], errors: [], coverageNotes };
}

function addError(target: InventorySection, operation: string, error: unknown): void {
  target.errors.push(inventoryError(target.product, operation, error));
}

interface WorkerSummary {
  id?: string;
  name?: string;
}

/** Phase one: discovers Workers and their active bindings. */
export async function queryWorkers(ctx: InventoryContext): Promise<InventorySection> {
  const result = section("Workers", [
    "Only active Worker settings are scanned; undeployed and rollback versions may contain additional bindings."
  ]);
  let workers: WorkerSummary[];
  try {
    workers = records(
      await get<unknown>(ctx, `/accounts/${segment(ctx.accountId)}/workers/scripts`)
    );
  } catch (error) {
    ctx.bindingDiscoveryComplete = false;
    addError(result, "list Worker scripts", error);
    return result;
  }
  await Promise.all(
    workers.map((worker) =>
      ctx.limit(async () => {
        const name = text(worker.id) ?? text(worker.name) ?? "unknown";
        const row = resource({
          product: result.product,
          resourceType: "Worker",
          name,
          id: name,
          deletionDiscoveryComplete: false
        });
        result.resources.push(row);
        try {
          const settings = await get<{ bindings?: unknown[] }>(
            ctx,
            `/accounts/${segment(ctx.accountId)}/workers/scripts/${segment(name)}/settings`
          );
          if (!Array.isArray(settings.bindings))
            throw new Error("Worker settings did not contain a bindings array");
          indexWorkerBindings(
            ctx.bindings,
            settings.bindings as Parameters<typeof indexWorkerBindings>[1],
            `Worker:${name}`,
            name
          );
          row.details.bindings = String(settings.bindings.length);
        } catch (error) {
          ctx.bindingDiscoveryComplete = false;
          row.deletionDiscoveryComplete = false;
          addError(result, `get settings for Worker "${name}"`, error);
        }
        try {
          const schedules = records(
            await get<unknown>(
              ctx,
              `/accounts/${segment(ctx.accountId)}/workers/scripts/${segment(name)}/schedules`
            )
          );
          row.details.cron_triggers = schedules
            .map((schedule) => text(schedule.cron))
            .filter((cron): cron is string => cron !== undefined)
            .join(" | ");
        } catch (error) {
          addError(result, `get cron schedules for Worker "${name}"`, error);
        }
        try {
          const response = await get<unknown>(
            ctx,
            `/accounts/${segment(ctx.accountId)}/workers/scripts/${segment(name)}/deployments`
          );
          const deployments = records(
            Array.isArray(response) ? response : (response as RecordValue)?.deployments
          );
          row.details.deployments = String(deployments.length);
        } catch (error) {
          addError(result, `get deployments for Worker "${name}"`, error);
        }
      })
    )
  );
  try {
    const domains = records(
      await get<unknown>(ctx, `/accounts/${segment(ctx.accountId)}/workers/domains`)
    );
    for (const domain of domains) {
      const hostname = text(domain.hostname) ?? "unknown";
      const service = text(domain.service);
      if (service !== undefined) {
        const worker = result.resources.find(
          (candidate) => candidate.resourceType === "Worker" && candidate.name === service
        );
        if (worker !== undefined) worker.deletionBlockers.push(`custom domain ${hostname}`);
      }
      result.resources.push(
        resource({
          product: result.product,
          resourceType: "Custom Domain",
          name: hostname,
          id: text(domain.id) ?? null,
          details: { zone: text(domain.zone_name) ?? "" },
          referencedBy: service === undefined ? [] : [`Worker:${service}`],
          deletionDiscoveryComplete: false
        })
      );
    }
  } catch (error) {
    for (const worker of result.resources) worker.deletionDiscoveryComplete = false;
    addError(result, "list Worker custom domains", error);
  }
  try {
    const subdomain = await get<RecordValue>(
      ctx,
      `/accounts/${segment(ctx.accountId)}/workers/subdomain`
    );
    const name = text(subdomain.subdomain);
    if (name !== undefined)
      result.resources.push(
        resource({
          product: result.product,
          resourceType: "Account Subdomain",
          name: `${name}.workers.dev`,
          id: null,
          deletionBlockers: ["account-level setting"],
          deletionDiscoveryComplete: false
        })
      );
  } catch (error) {
    addError(result, "get workers.dev subdomain", error);
  }
  result.resources.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

interface PagesBindingConfig {
  d1_databases?: Record<string, { id?: string }>;
  kv_namespaces?: Record<string, { namespace_id?: string }>;
  r2_buckets?: Record<string, { name?: string }>;
  durable_object_namespaces?: Record<string, { namespace_id?: string }>;
  queue_producers?: Record<string, { name?: string }>;
  services?: Record<string, { service?: string }>;
  vectorize?: Record<string, { index_name?: string }>;
  hyperdrive?: Record<string, { id?: string }>;
  analytics_engine_datasets?: Record<string, { dataset?: string }>;
}

function indexPagesConfig(
  ctx: InventoryContext,
  config: PagesBindingConfig | undefined,
  referrer: string
): void {
  const addValues = (
    kind: string,
    values: Record<string, Record<string, unknown>> | undefined,
    key: string
  ): void => {
    for (const value of Object.values(values ?? {})) {
      const id = text(value[key]);
      if (id !== undefined) ctx.bindings.add(kind, id, referrer);
    }
  };
  addValues(BindingKind.d1, config?.d1_databases, "id");
  addValues(BindingKind.kv, config?.kv_namespaces, "namespace_id");
  addValues(BindingKind.r2, config?.r2_buckets, "name");
  addValues(BindingKind.durableObject, config?.durable_object_namespaces, "namespace_id");
  addValues(BindingKind.queue, config?.queue_producers, "name");
  addValues(BindingKind.service, config?.services, "service");
  addValues(BindingKind.vectorize, config?.vectorize, "index_name");
  addValues(BindingKind.hyperdrive, config?.hyperdrive, "id");
  addValues(BindingKind.analytics, config?.analytics_engine_datasets, "dataset");
}

/** Phase one: discovers Pages projects and production/preview bindings. */
export async function queryPages(ctx: InventoryContext): Promise<InventorySection> {
  const result = section("Pages");
  try {
    const projects = await list<RecordValue>(
      ctx,
      `/accounts/${segment(ctx.accountId)}/pages/projects`
    );
    for (const project of projects) {
      const name = text(project.name) ?? text(project.id) ?? "unknown";
      const configs = project.deployment_configs as
        { production?: PagesBindingConfig; preview?: PagesBindingConfig } | undefined;
      indexPagesConfig(ctx, configs?.production, `Pages:${name}`);
      indexPagesConfig(ctx, configs?.preview, `Pages:${name}`);
      result.resources.push(
        resource({
          product: result.product,
          resourceType: "Project",
          name,
          id: text(project.id) ?? name,
          deletionDiscoveryComplete: false
        })
      );
    }
  } catch (error) {
    ctx.bindingDiscoveryComplete = false;
    addError(result, "list Pages projects", error);
  }
  return result;
}

interface SimpleProduct {
  product: string;
  resourceType: string;
  path: string;
  operation: string;
  paged?: boolean;
  pageSize?: number;
  cursor?: "r2" | "images";
  nested?: string;
  name: string[];
  id: string[];
  bindingKind?: string;
  bindingField?: string;
  complete?: boolean;
  coverageNotes?: string[];
  builtIn?: string;
  detailFields?: string[];
}

const simpleProducts: SimpleProduct[] = [
  {
    product: "D1",
    resourceType: "Database",
    path: "d1/database",
    operation: "list D1 databases",
    paged: true,
    name: ["name"],
    id: ["uuid"],
    bindingKind: BindingKind.d1,
    bindingField: "uuid",
    complete: true
  },
  {
    product: "KV",
    resourceType: "Namespace",
    path: "storage/kv/namespaces",
    operation: "list KV namespaces",
    paged: true,
    name: ["title"],
    id: ["id"],
    bindingKind: BindingKind.kv,
    bindingField: "id",
    complete: true
  },
  {
    product: "R2",
    resourceType: "Bucket",
    path: "r2/buckets",
    operation: "list R2 buckets",
    nested: "buckets",
    cursor: "r2",
    name: ["name"],
    id: ["name"],
    bindingKind: BindingKind.r2,
    bindingField: "name",
    coverageNotes: [
      storedContentNotScanned,
      "R2 custom domains, event notifications, and Data Catalog are checked per bucket."
    ]
  },
  {
    product: "Artifacts",
    resourceType: "Namespace",
    path: "artifacts/namespaces",
    operation: "list Artifacts namespaces",
    paged: true,
    name: ["namespace"],
    id: ["namespace"],
    coverageNotes: [unavailableReverseApi]
  },
  {
    product: "Queues",
    resourceType: "Queue",
    path: "queues",
    operation: "list Queues",
    paged: true,
    name: ["queue_name", "name", "queue_id"],
    id: ["queue_id"],
    bindingKind: BindingKind.queue,
    bindingField: "queue_name"
  },
  {
    product: "Workflows",
    resourceType: "Workflow",
    path: "workflows",
    operation: "list Workflows",
    paged: true,
    name: ["name"],
    id: ["id"],
    bindingKind: BindingKind.workflow,
    bindingField: "name",
    complete: true
  },
  {
    product: "Pipelines",
    resourceType: "Pipeline",
    path: "pipelines/v1/pipelines",
    operation: "list Pipelines",
    paged: true,
    name: ["name"],
    id: ["id"],
    bindingKind: BindingKind.pipeline,
    bindingField: "name",
    complete: true
  },
  {
    product: "Hyperdrive",
    resourceType: "Config",
    path: "hyperdrive/configs",
    operation: "list Hyperdrive configs",
    paged: true,
    name: ["name"],
    id: ["id"],
    bindingKind: BindingKind.hyperdrive,
    bindingField: "id",
    complete: true
  },
  {
    product: "Secrets Store",
    resourceType: "Store",
    path: "secrets_store/stores",
    operation: "list Secrets Store stores",
    paged: true,
    name: ["name"],
    id: ["id"],
    builtIn: "default_secrets_store",
    coverageNotes: ["Secret metadata is checked per store; secret values are never requested."]
  },
  {
    product: "Vectorize",
    resourceType: "Index",
    path: "vectorize/v2/indexes",
    operation: "list Vectorize indexes",
    name: ["name"],
    id: ["name"],
    bindingKind: BindingKind.vectorize,
    bindingField: "name",
    complete: true,
    coverageNotes: [storedContentNotScanned]
  },
  {
    product: "Workers AI",
    resourceType: "Fine-tune",
    path: "ai/finetunes",
    operation: "list Workers AI fine-tunes",
    name: ["name", "id"],
    id: ["id"],
    coverageNotes: [
      "Shared model catalog entries are excluded; only account-owned fine-tunes are listed.",
      unavailableReverseApi
    ]
  },
  {
    product: "AI Gateway",
    resourceType: "Gateway",
    path: "ai-gateway/gateways",
    operation: "list AI Gateway gateways",
    paged: true,
    name: ["id"],
    id: ["id"],
    builtIn: "default",
    coverageNotes: [unavailableReverseApi]
  },
  {
    product: "AI Search",
    resourceType: "Namespace",
    path: "ai-search/namespaces",
    operation: "list AI Search namespaces",
    paged: true,
    name: ["name"],
    id: ["name"],
    builtIn: "default",
    coverageNotes: [storedContentNotScanned, unavailableReverseApi]
  },
  {
    product: "Durable Objects",
    resourceType: "Namespace",
    path: "workers/durable_objects/namespaces",
    operation: "list Durable Object namespaces",
    paged: true,
    name: ["name", "class", "id"],
    id: ["id"],
    bindingKind: BindingKind.durableObject,
    bindingField: "id",
    coverageNotes: [
      "External bindings that block a tombstone migration have no complete read-only reverse-discovery API."
    ]
  },
  {
    product: "Containers",
    resourceType: "Application",
    path: "containers/applications",
    operation: "list Container applications",
    name: ["name", "id"],
    id: ["id"],
    coverageNotes: [
      "Cloudflare Registry images have no public REST list endpoint and are not included.",
      unavailableReverseApi
    ]
  },
  {
    product: "Containers",
    resourceType: "External Registry",
    path: "containers/registries",
    operation: "list Container registries",
    name: ["domain", "name", "id"],
    id: ["id"],
    coverageNotes: [unavailableReverseApi]
  },
  {
    product: "Workers for Platforms",
    resourceType: "Dispatch Namespace",
    path: "workers/dispatch/namespaces",
    operation: "list dispatch namespaces",
    name: ["namespace_name"],
    id: ["namespace_id"],
    bindingKind: BindingKind.dispatch,
    bindingField: "namespace_name",
    complete: true,
    detailFields: ["script_count"]
  },
  {
    product: "Workers VPC",
    resourceType: "Connectivity Service",
    path: "connectivity/directory/services",
    operation: "list Workers VPC connectivity services",
    paged: true,
    name: ["name"],
    id: ["service_id"],
    coverageNotes: [unavailableReverseApi],
    detailFields: ["type", "http_port", "https_port", "tcp_port"]
  },
  {
    product: "Images",
    resourceType: "Image",
    path: "images/v2",
    operation: "list Images",
    nested: "images",
    cursor: "images",
    name: ["filename", "id"],
    id: ["id"],
    coverageNotes: [unavailableReverseApi]
  },
  {
    product: "Stream",
    resourceType: "Video",
    path: "stream",
    operation: "list Stream videos",
    paged: true,
    name: ["uid"],
    id: ["uid"],
    coverageNotes: [unavailableReverseApi]
  },
  {
    product: "Stream",
    resourceType: "Live Input",
    path: "stream/live_inputs",
    operation: "list Stream live inputs",
    nested: "live_inputs",
    name: ["uid"],
    id: ["uid"],
    coverageNotes: [unavailableReverseApi]
  },
  {
    product: "Turnstile",
    resourceType: "Widget",
    path: "challenges/widgets",
    operation: "list Turnstile widgets",
    name: ["name", "sitekey"],
    id: ["sitekey"],
    coverageNotes: [
      "Sitekeys embedded in application code cannot be discovered through a reverse-binding API."
    ]
  },
  {
    product: "Realtime",
    resourceType: "Calls App",
    path: "calls/apps",
    operation: "list Calls apps",
    name: ["name", "uid"],
    id: ["uid"],
    coverageNotes: [unavailableReverseApi]
  },
  {
    product: "Realtime",
    resourceType: "TURN Key",
    path: "calls/turn_keys",
    operation: "list Calls TURN keys",
    name: ["name", "uid"],
    id: ["uid"],
    coverageNotes: [unavailableReverseApi]
  },
  {
    product: "Realtime",
    resourceType: "RealtimeKit App",
    path: "realtime/kit/apps",
    operation: "list RealtimeKit apps",
    paged: true,
    name: ["name", "id"],
    id: ["id"],
    coverageNotes: [unavailableReverseApi]
  },
  {
    product: "mTLS Certificates",
    resourceType: "Certificate",
    path: "mtls_certificates",
    operation: "list mTLS certificates",
    name: ["name", "id"],
    id: ["id"],
    bindingKind: BindingKind.mtls,
    bindingField: "id"
  },
  {
    product: "Logpush",
    resourceType: "Job",
    path: "logpush/jobs",
    operation: "list Logpush jobs",
    name: ["name", "id"],
    id: ["id"],
    complete: true,
    detailFields: ["dataset", "destination_conf", "enabled"]
  },
  {
    product: "Email Routing",
    resourceType: "Destination Address",
    path: "email/routing/addresses",
    operation: "list Email Routing destination addresses",
    paged: true,
    pageSize: 50,
    name: ["email", "id"],
    id: ["id"],
    complete: true
  }
];

function first(record: RecordValue, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return undefined;
}

function redactDestination(value: string): string {
  const query = value.indexOf("?");
  return query < 0 ? value : `${value.slice(0, query)}?[redacted]`;
}

async function querySimple(
  ctx: InventoryContext,
  definition: SimpleProduct,
  target: InventorySection
): Promise<void> {
  try {
    const path = `/accounts/${segment(ctx.accountId)}/${definition.path}`;
    let raw: unknown;
    if (definition.cursor !== undefined) {
      const values: RecordValue[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const cursorParameter = definition.cursor === "images" ? "continuation_token" : "cursor";
        const query =
          cursor === undefined ? "" : `?${cursorParameter}=${encodeURIComponent(cursor)}`;
        const envelope = await request<unknown>(ctx, `${path}${query}`);
        if (envelope.result === null || typeof envelope.result !== "object")
          throw new Error(`expected object result from ${path}`);
        const result = envelope.result as RecordValue;
        values.push(...records(result[definition.nested!]));
        const nextCursor: unknown =
          definition.cursor === "r2" ? envelope.result_info?.cursor : result.continuation_token;
        if (nextCursor !== undefined && (typeof nextCursor !== "string" || nextCursor.length === 0))
          throw new Error(`invalid pagination cursor from ${path}`);
        cursor = nextCursor;
        if (cursor !== undefined && seen.has(cursor))
          throw new Error(`repeated pagination cursor from ${path}`);
        if (cursor !== undefined) seen.add(cursor);
      } while (cursor !== undefined);
      raw = values;
    } else {
      raw =
        definition.paged ?
          await list<unknown>(ctx, path, definition.pageSize)
        : await get<unknown>(ctx, path);
    }
    const items =
      definition.nested === undefined || definition.cursor !== undefined ?
        records(raw)
      : records((raw as RecordValue)?.[definition.nested]);
    for (const item of items) {
      const name = first(item, definition.name) ?? "unknown";
      const id = first(item, definition.id) ?? null;
      const bindingId =
        definition.bindingField === undefined ? undefined : first(item, [definition.bindingField]);
      const rowDetails: Record<string, string> = {};
      for (const field of definition.detailFields ?? []) {
        const value = first(item, [field]);
        if (value !== undefined)
          rowDetails[field] = field === "destination_conf" ? redactDestination(value) : value;
      }
      const discovered = resource({
        product: definition.product,
        resourceType: definition.resourceType,
        name,
        id,
        details: rowDetails,
        referencedBy:
          definition.bindingKind !== undefined && bindingId !== undefined ?
            ctx.bindings.get(definition.bindingKind, bindingId)
          : [],
        deletionBlockers: definition.builtIn === name ? ["built-in"] : [],
        deletionDiscoveryComplete:
          definition.complete === true
          && (definition.bindingKind === undefined || ctx.bindingDiscoveryComplete)
      });
      if (
        definition.product === "Workers for Platforms"
        && Number(rowDetails.script_count ?? "0") > 0
      )
        discovered.deletionBlockers.push(
          `contains ${rowDetails.script_count} dispatched Worker script(s)`
        );
      target.resources.push(discovered);
    }
  } catch (error) {
    addError(target, definition.operation, error);
  }
}

async function queryAnalytics(ctx: InventoryContext): Promise<InventorySection> {
  const target = section("Analytics Engine", [
    "Datasets are discovered with SHOW TABLES because no list/CRUD endpoint exists."
  ]);
  try {
    const envelope = await request<unknown>(
      ctx,
      `/accounts/${segment(ctx.accountId)}/analytics_engine/sql`,
      { method: "POST", body: "SHOW TABLES" }
    );
    const rows = records((envelope.result as RecordValue)?.data ?? envelope.result);
    for (const row of rows) {
      const name = first(row, ["name", "table"]);
      if (name !== undefined)
        target.resources.push(
          resource({
            product: target.product,
            resourceType: "Dataset",
            name,
            id: null,
            referencedBy: ctx.bindings.get(BindingKind.analytics, name),
            deletionDiscoveryComplete: ctx.bindingDiscoveryComplete
          })
        );
    }
  } catch (error) {
    addError(target, "discover Analytics Engine datasets via SHOW TABLES", error);
  }
  return target;
}

async function inspectResource(
  ctx: InventoryContext,
  target: InventorySection,
  row: InventoryResource,
  operation: string,
  path: string,
  apply: (value: unknown) => void
): Promise<void> {
  try {
    apply(await get<unknown>(ctx, `/accounts/${segment(ctx.accountId)}/${path}`));
  } catch (error) {
    row.deletionDiscoveryComplete = false;
    addError(target, operation, error);
  }
}

async function discoverSupplemental(
  ctx: InventoryContext,
  sections: InventorySection[]
): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const target of sections)
    for (const row of [...target.resources]) {
      if (row.product === "R2") {
        tasks.push(
          ctx.limit(() =>
            inspectResource(
              ctx,
              target,
              row,
              `list custom domains for R2 bucket "${row.name}"`,
              `r2/buckets/${segment(row.name)}/domains/custom`,
              (value) => {
                row.details.custom_domains = String(
                  records((value as RecordValue)?.domains).length
                );
              }
            )
          ),
          ctx.limit(() =>
            inspectResource(
              ctx,
              target,
              row,
              `get event notification config for R2 bucket "${row.name}"`,
              `event_notifications/r2/${segment(row.name)}/configuration`,
              (value) => {
                const count = records(value).reduce(
                  (total, config) =>
                    total + (Array.isArray(config.rules) ? config.rules.length : 0),
                  0
                );
                row.details.event_notification_rules = String(count);
                if (count > 0)
                  row.deletionBlockers.push(`has ${count} event notification rule(s) configured`);
              }
            )
          ),
          ctx.limit(() =>
            inspectResource(
              ctx,
              target,
              row,
              `get R2 Data Catalog status for bucket "${row.name}"`,
              `r2-catalog/${segment(row.name)}`,
              (value) => {
                const status = text((value as RecordValue)?.status);
                if (status !== undefined) row.details.data_catalog_status = status;
              }
            )
          )
        );
      } else if (row.product === "Artifacts" && row.resourceType === "Namespace") {
        tasks.push(
          ctx.limit(() =>
            inspectResource(
              ctx,
              target,
              row,
              `list repos for Artifacts namespace "${row.name}"`,
              `artifacts/namespaces/${segment(row.name)}/repos`,
              (value) => {
                for (const repo of records(value)) {
                  const name = first(repo, ["name", "id"]) ?? "unknown";
                  target.resources.push(
                    resource({
                      product: target.product,
                      resourceType: "Repo",
                      name: `${row.name}/${name}`,
                      id: first(repo, ["id"]) ?? null
                    })
                  );
                }
              }
            )
          )
        );
      } else if (row.product === "Workflows") {
        tasks.push(
          ctx.limit(async () => {
            try {
              const response = await request<unknown[]>(
                ctx,
                `/accounts/${segment(ctx.accountId)}/workflows/${segment(row.name)}/instances?page=1&per_page=1&status=running`
              );
              row.details.active_instances = String(
                response.result_info?.total_count ?? response.result.length
              );
            } catch (error) {
              row.deletionDiscoveryComplete = false;
              addError(target, `count active instances for Workflow "${row.name}"`, error);
            }
          })
        );
      } else if (row.product === "Secrets Store" && row.resourceType === "Store") {
        tasks.push(
          ctx.limit(async () => {
            try {
              const secrets = await list<RecordValue>(
                ctx,
                `/accounts/${segment(ctx.accountId)}/secrets_store/stores/${segment(row.id ?? row.name)}/secrets`,
                50
              );
              row.details.secret_count = String(secrets.length);
              for (const secret of secrets) {
                const name = first(secret, ["name", "id"]) ?? "unknown";
                target.resources.push(
                  resource({
                    product: target.product,
                    resourceType: "Secret",
                    name,
                    id: first(secret, ["id"]) ?? null,
                    referencedBy: ctx.bindings.get(
                      BindingKind.secret,
                      `${row.id ?? row.name}/${name}`
                    ),
                    deletionDiscoveryComplete: ctx.bindingDiscoveryComplete
                  })
                );
              }
            } catch (error) {
              row.deletionDiscoveryComplete = false;
              addError(target, `list secrets in store "${row.name}"`, error);
            }
          })
        );
      } else if (row.product === "Vectorize") {
        tasks.push(
          ctx.limit(() =>
            inspectResource(
              ctx,
              target,
              row,
              `list metadata indexes for Vectorize index "${row.name}"`,
              `vectorize/v2/indexes/${segment(row.name)}/metadata_index/list`,
              (value) => {
                const entries =
                  Array.isArray(value) ? value : (value as RecordValue)?.metadataIndexes;
                row.details.metadata_indexes = records(entries)
                  .map((entry) => first(entry, ["propertyName", "property_name"]))
                  .filter((name): name is string => name !== undefined)
                  .join(", ");
              }
            )
          )
        );
      } else if (row.product === "AI Gateway") {
        for (const [suffix, key] of [
          ["custom-domains", "custom_domains"],
          ["routes", "dynamic_routes"]
        ] as const)
          tasks.push(
            ctx.limit(() =>
              inspectResource(
                ctx,
                target,
                row,
                `list ${suffix} for AI Gateway "${row.name}"`,
                `ai-gateway/gateways/${segment(row.name)}/${suffix}`,
                (value) => {
                  row.details[key] = String(records(value).length);
                }
              )
            )
          );
      } else if (row.product === "AI Search" && row.resourceType === "Namespace") {
        tasks.push(
          ctx.limit(() =>
            inspectResource(
              ctx,
              target,
              row,
              `list AI Search instances in namespace "${row.name}"`,
              `ai-search/namespaces/${segment(row.name)}/instances`,
              (value) => {
                const instances = records(value);
                row.details.instance_count = String(instances.length);
                for (const instance of instances) {
                  const id = first(instance, ["id"]) ?? "unknown";
                  target.resources.push(
                    resource({
                      product: target.product,
                      resourceType: "Instance",
                      name: id,
                      id,
                      details: {
                        namespace: row.name,
                        source: first(instance, ["source"]) ?? "",
                        ai_gateway: first(instance, ["ai_gateway_id"]) ?? ""
                      }
                    })
                  );
                }
              }
            )
          )
        );
      } else if (row.product === "Containers" && row.resourceType === "Application") {
        for (const [suffix, key] of [
          ["versions", "versions"],
          ["instances", "running_instances"]
        ] as const)
          tasks.push(
            ctx.limit(() =>
              inspectResource(
                ctx,
                target,
                row,
                `list ${suffix} for Container application "${row.name}"`,
                `containers/applications/${segment(row.id ?? row.name)}/${suffix}`,
                (value) => {
                  row.details[key] = String(records(value).length);
                }
              )
            )
          );
      }
    }

  for (const images of sections.filter((target) => target.product === "Images")) {
    const anchor = resource({
      product: images.product,
      resourceType: "Configuration",
      name: "account",
      id: null
    });
    tasks.push(
      ctx.limit(() =>
        inspectResource(
          ctx,
          images,
          anchor,
          "list Images variants",
          "images/v1/variants",
          (value) => {
            const variants = (value as RecordValue)?.variants;
            if (variants !== null && typeof variants === "object")
              for (const [name, variant] of Object.entries(variants))
                images.resources.push(
                  resource({
                    product: images.product,
                    resourceType: "Variant",
                    name,
                    id: first(variant as RecordValue, ["id"]) ?? name,
                    deletionBlockers: name === "public" ? ["built-in"] : []
                  })
                );
          }
        )
      ),
      ctx.limit(() =>
        inspectResource(
          ctx,
          images,
          anchor,
          "list Images signing keys",
          "images/v1/keys",
          (value) => {
            for (const [index, key] of records((value as RecordValue)?.keys).entries())
              images.resources.push(
                resource({
                  product: images.product,
                  resourceType: "Signing Key",
                  name: first(key, ["name", "id"]) ?? `key-${index}`,
                  id: first(key, ["id"]) ?? null
                })
              );
          }
        )
      )
    );
  }
  await Promise.all(tasks);
}

async function discoverBlockers(
  ctx: InventoryContext,
  sections: InventorySection[]
): Promise<void> {
  const byProduct = new Map(sections.map((value) => [value.product, value]));
  const tasks: Promise<void>[] = [];
  for (const target of sections)
    for (const row of target.resources) {
      let path: string | undefined;
      let operation: string | undefined;
      if (row.product === "Queues" && row.id !== null) {
        path = `queues/${segment(row.id)}/consumers`;
        operation = `list consumers for Queue "${row.name}"`;
      } else if (row.product === "mTLS Certificates" && row.id !== null) {
        path = `mtls_certificates/${segment(row.id)}/associations`;
        operation = `get associations for mTLS certificate "${row.name}"`;
      }
      if (path !== undefined && operation !== undefined)
        tasks.push(
          ctx.limit(async () => {
            try {
              const found = records(
                await get<unknown>(ctx, `/accounts/${segment(ctx.accountId)}/${path}`)
              );
              if (found.length > 0)
                row.deletionBlockers.push(`${found.length} attached association(s)`);
              row.deletionDiscoveryComplete = ctx.bindingDiscoveryComplete;
            } catch (error) {
              row.deletionDiscoveryComplete = false;
              addError(byProduct.get(row.product)!, operation, error);
            }
          })
        );
    }
  await Promise.all(tasks);
}

/** Phase two: discovers all non-Workers/Pages product groups. */
export async function queryOtherProducts(ctx: InventoryContext): Promise<InventorySection[]> {
  const sections = new Map<string, InventorySection>();
  for (const definition of simpleProducts) {
    const target = sections.get(definition.product) ?? section(definition.product);
    target.coverageNotes.push(
      ...(definition.coverageNotes ?? []).filter((note) => !target.coverageNotes.includes(note))
    );
    sections.set(definition.product, target);
  }
  await Promise.all(
    simpleProducts.map((definition) =>
      ctx.limit(() => querySimple(ctx, definition, sections.get(definition.product)!))
    )
  );
  const values = [...sections.values()];
  await discoverSupplemental(ctx, values);
  await discoverBlockers(ctx, values);
  values.push(await queryAnalytics(ctx));
  return values;
}
