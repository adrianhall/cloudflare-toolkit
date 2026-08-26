/** @file Cross-product Worker and Pages binding index. */
import type { BindingIndexLike } from "./types.js";

/** Binding identifiers shared by discovery writers and readers. */
export const BindingKind = {
  kv: "kv",
  d1: "d1",
  r2: "r2",
  queue: "queue",
  durableObject: "durable-object",
  service: "service",
  workflow: "workflow",
  hyperdrive: "hyperdrive",
  vectorize: "vectorize",
  secret: "secret",
  analytics: "analytics",
  dispatch: "dispatch",
  mtls: "mtls",
  pipeline: "pipeline"
} as const;

/** In-memory binding reverse index. */
export class BindingIndex implements BindingIndexLike {
  private readonly values = new Map<string, Set<string>>();

  /** Records one binding reference. */
  add(kind: string, identifier: string, referrer: string): void {
    if (identifier === "") return;
    const key = `${kind}:${identifier}`;
    const values = this.values.get(key) ?? new Set<string>();
    values.add(referrer);
    this.values.set(key, values);
  }

  /** Returns sorted binding references. */
  get(kind: string, identifier: string): string[] {
    return [...(this.values.get(`${kind}:${identifier}`) ?? [])].sort((a, b) => a.localeCompare(b));
  }
}

interface WorkerBinding {
  type?: string;
  namespace_id?: string;
  id?: string;
  bucket_name?: string;
  queue_name?: string;
  class_name?: string;
  script_name?: string;
  service?: string;
  workflow_name?: string;
  index_name?: string;
  store_id?: string;
  secret_name?: string;
  dataset?: string;
  namespace?: string;
  certificate_id?: string;
  pipeline?: string;
}

/** Indexes binding shapes returned by a Worker settings endpoint. */
export function indexWorkerBindings(
  index: BindingIndexLike,
  bindings: WorkerBinding[],
  referrer: string,
  owner: string
): void {
  const add = (kind: string, value: string | undefined): void => {
    if (value !== undefined) index.add(kind, value, referrer);
  };
  for (const binding of bindings) {
    if (binding.type === "kv_namespace") add(BindingKind.kv, binding.namespace_id);
    else if (binding.type === "d1") add(BindingKind.d1, binding.id);
    else if (binding.type === "r2_bucket") add(BindingKind.r2, binding.bucket_name);
    else if (binding.type === "queue") add(BindingKind.queue, binding.queue_name);
    else if (binding.type === "durable_object_namespace")
      add(
        BindingKind.durableObject,
        binding.namespace_id ?? `class:${binding.class_name ?? ""}@${binding.script_name ?? owner}`
      );
    else if (binding.type === "service") add(BindingKind.service, binding.service);
    else if (binding.type === "workflow") add(BindingKind.workflow, binding.workflow_name);
    else if (binding.type === "hyperdrive") add(BindingKind.hyperdrive, binding.id);
    else if (binding.type === "vectorize") add(BindingKind.vectorize, binding.index_name);
    else if (
      binding.type === "secrets_store_secret"
      && binding.store_id !== undefined
      && binding.secret_name !== undefined
    )
      add(BindingKind.secret, `${binding.store_id}/${binding.secret_name}`);
    else if (binding.type === "analytics_engine") add(BindingKind.analytics, binding.dataset);
    else if (binding.type === "dispatch_namespace") add(BindingKind.dispatch, binding.namespace);
    else if (binding.type === "mtls_certificate") add(BindingKind.mtls, binding.certificate_id);
    else if (binding.type === "pipeline" || binding.type === "pipelines")
      add(BindingKind.pipeline, binding.pipeline);
  }
}
