/** @file Shared types for the account-wide Cloudflare inventory CLI. */

/** A normalized Cloudflare API error. */
export interface InventoryError {
  product: string;
  operation: string;
  status?: number;
  code?: number;
  message: string;
  permissionDenied: boolean;
}

/** Tri-state deletion assessment. */
export type DeletionStatus = "Yes" | "No" | "Unknown";

/** One account-owned Cloudflare resource. */
export interface InventoryResource {
  product: string;
  resourceType: string;
  name: string;
  id: string | null;
  details: Record<string, string>;
  referencedBy: string[];
  deletionBlockers: string[];
  /** True only when every relevant binding/blocker lookup completed. */
  deletionDiscoveryComplete: boolean;
  deletionStatus?: DeletionStatus;
}

/** Inventory for one Cloudflare product. */
export interface InventorySection {
  product: string;
  resources: InventoryResource[];
  errors: InventoryError[];
  coverageNotes: string[];
}

/** Deterministic JSON document emitted by `cf-inventory`. */
export interface InventoryDocument {
  schemaVersion: 1;
  accountId: string;
  status: "complete" | "partial";
  summary: {
    products: number;
    resources: number;
    errors: number;
    deletion: Record<DeletionStatus, number>;
  };
  resources: InventoryResource[];
  errors: InventoryError[];
  coverageNotes: { product: string; note: string }[];
}

/** Minimal cross-product binding index contract. */
export interface BindingIndexLike {
  add(kind: string, identifier: string, referrer: string): void;
  get(kind: string, identifier: string): string[];
}

/** Dependencies and credentials shared by product queries. */
export interface InventoryContext {
  accountId: string;
  token: string;
  fetchImpl: typeof fetch;
  bindings: BindingIndexLike;
  bindingDiscoveryComplete: boolean;
  limit<T>(fn: () => Promise<T>): Promise<T>;
  timeoutMs: number;
  retries: number;
  sleep(ms: number): Promise<void>;
}
