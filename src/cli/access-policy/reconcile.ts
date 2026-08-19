/** @file Access configuration validation, planning, and execution. */
import type {
  AccessApplication,
  AccessConfig,
  AccessPolicy,
  AccessRule
} from "../../lib/access-config.js";
import type { AccessApi } from "./cf.js";

/** A discovered reusable Access policy. */
export interface RemotePolicy {
  /** Cloudflare resource ID. */
  id: string;
  /** Policy name. */
  name: string;
  /** Configured decision. */
  decision?: string;
  /** Include rules. */
  include?: unknown[];
  /** Exclude rules. */
  exclude?: unknown[];
  /** Require rules. */
  require?: unknown[];
  /** API-form session duration. */
  session_duration?: string;
  /** Number of linked applications reported by Cloudflare. */
  app_count?: number;
}

/** A discovered Access application. */
export interface RemoteApplication {
  /** Cloudflare resource ID. */
  id: string;
  /** Application name. */
  name: string;
  /** Primary domain. */
  domain?: string;
  /** Application type. */
  type?: string;
  /** Public destinations. */
  destinations?: { type?: string; uri?: string }[];
  /** API-form session duration. */
  session_duration?: string;
  /** Linked reusable policies. */
  policies?: { id?: string; precedence?: number; reusable?: boolean }[];
}

/** One immutable discovery snapshot used to plan and execute a run. */
export interface AccessSnapshot {
  /** All reusable policies visible to `cf`. */
  policies: RemotePolicy[];
  /** All Access applications visible to `cf`. */
  applications: RemoteApplication[];
}

/** A planned Access resource operation. */
export interface AccessChange {
  /** Operation to perform or report. */
  action: "create" | "update" | "delete" | "no-change";
  /** Resource category. */
  kind: "policy" | "application";
  /** Stable configured resource name. */
  name: string;
}

const DECISIONS = new Set(["allow", "deny", "non_identity", "bypass"]);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function rules(value: unknown): value is AccessRule[] {
  return Array.isArray(value) && value.every(object);
}

/**
 * Validates an imported Access configuration.
 *
 * @param value - Unknown default export loaded from `access.config.ts`.
 * @throws Error when any configuration field is invalid.
 */
export function validateAccessConfig(value: unknown): asserts value is AccessConfig {
  if (!object(value) || !Array.isArray(value.policies) || !Array.isArray(value.applications))
    throw new Error("access.config.ts must export policies and applications arrays.");
  const policyNames = new Set<string>();
  for (const candidate of value.policies) {
    if (!object(candidate) || !nonempty(candidate.name) || policyNames.has(candidate.name))
      throw new Error("Reusable policy names must be non-empty and unique.");
    if (!DECISIONS.has(String(candidate.decision)))
      throw new Error(`Reusable policy '${candidate.name}' has an invalid decision.`);
    if (!rules(candidate.include) || candidate.include.length === 0)
      throw new Error(`Reusable policy '${candidate.name}' must have a non-empty include array.`);
    if (candidate.exclude !== undefined && !rules(candidate.exclude))
      throw new Error(`Reusable policy '${candidate.name}' has an invalid exclude array.`);
    if (candidate.require !== undefined && !rules(candidate.require))
      throw new Error(`Reusable policy '${candidate.name}' has an invalid require array.`);
    if (candidate.sessionDuration !== undefined && !nonempty(candidate.sessionDuration))
      throw new Error(`Reusable policy '${candidate.name}' has an invalid session duration.`);
    policyNames.add(candidate.name);
  }
  const applicationNames = new Set<string>();
  for (const candidate of value.applications) {
    if (!object(candidate) || !nonempty(candidate.name) || applicationNames.has(candidate.name))
      throw new Error("Access application names must be non-empty and unique.");
    if (!nonempty(candidate.domain) || !Array.isArray(candidate.policies))
      throw new Error(`Access application '${candidate.name}' has invalid fields.`);
    if (candidate.sessionDuration !== undefined && !nonempty(candidate.sessionDuration))
      throw new Error(`Access application '${candidate.name}' has an invalid session duration.`);
    if (
      candidate.destinations !== undefined
      && (!Array.isArray(candidate.destinations)
        || !candidate.destinations.every(
          (destination) =>
            object(destination) && destination.type === "public" && nonempty(destination.uri)
        ))
    )
      throw new Error(`Access application '${candidate.name}' has invalid destinations.`);
    const precedences = new Set<number>();
    for (const reference of candidate.policies) {
      if (
        !object(reference)
        || !nonempty(reference.name)
        || !policyNames.has(reference.name)
        || !Number.isInteger(reference.precedence)
        || (reference.precedence as number) < 1
        || precedences.has(reference.precedence as number)
      )
        throw new Error(`Access application '${candidate.name}' has an invalid policy reference.`);
      precedences.add(reference.precedence as number);
    }
    applicationNames.add(candidate.name);
  }
}

function remotePolicy(value: unknown): RemotePolicy {
  if (!object(value) || !nonempty(value.id) || !nonempty(value.name))
    throw new Error("cf returned an invalid reusable Access policy.");
  if (value.decision !== undefined && typeof value.decision !== "string")
    throw new Error("cf returned an invalid reusable Access policy.");
  for (const field of ["include", "exclude", "require"] as const) {
    if (value[field] !== undefined && !Array.isArray(value[field]))
      throw new Error("cf returned an invalid reusable Access policy.");
  }
  if (value.session_duration !== undefined && typeof value.session_duration !== "string")
    throw new Error("cf returned an invalid reusable Access policy.");
  if (
    value.app_count !== undefined
    && (!Number.isInteger(value.app_count) || (value.app_count as number) < 0)
  )
    throw new Error("cf returned an invalid reusable Access policy.");
  return value as unknown as RemotePolicy;
}

function remoteApplication(value: unknown): RemoteApplication {
  if (!object(value) || !nonempty(value.id) || !nonempty(value.name))
    throw new Error("cf returned an invalid Access application.");
  for (const field of ["domain", "type", "session_duration"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string")
      throw new Error("cf returned an invalid Access application.");
  }
  if (
    value.destinations !== undefined
    && (!Array.isArray(value.destinations) || !value.destinations.every(object))
  )
    throw new Error("cf returned an invalid Access application.");
  if (value.policies !== undefined && !Array.isArray(value.policies))
    throw new Error("cf returned an invalid Access application.");
  if (
    Array.isArray(value.policies)
    && !value.policies.every(
      (policy) =>
        object(policy)
        && nonempty(policy.id)
        && Number.isInteger(policy.precedence)
        && (policy.precedence as number) > 0
    )
  )
    throw new Error("cf returned an invalid Access application.");
  return value as unknown as RemoteApplication;
}

function uniqueByName<T extends { name: string }>(resources: T[], kind: string): T[] {
  if (new Set(resources.map(({ name }) => name)).size !== resources.length)
    throw new Error(`cf returned duplicate ${kind} names.`);
  return resources;
}

/**
 * Discovers and validates all resources once for a reconciliation run.
 *
 * @param api - Cloudflare CLI adapter.
 * @returns A strict reusable-policy and application snapshot.
 */
export function discoverAccess(api: AccessApi): AccessSnapshot {
  return {
    policies: uniqueByName(api.listPolicies().map(remotePolicy), "reusable Access policy"),
    applications: uniqueByName(api.listApplications().map(remoteApplication), "Access application")
  };
}

function policyBody(policy: AccessPolicy): Record<string, unknown> {
  return {
    name: policy.name,
    decision: policy.decision,
    include: policy.include,
    ...(policy.exclude === undefined ? {} : { exclude: policy.exclude }),
    ...(policy.require === undefined ? {} : { require: policy.require }),
    ...(policy.sessionDuration === undefined ? {} : { session_duration: policy.sessionDuration })
  };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function policyMatches(remote: RemotePolicy, desired: AccessPolicy): boolean {
  const body = policyBody(desired);
  return (
    remote.name === body.name
    && remote.decision === body.decision
    && same(remote.include ?? [], body.include)
    && same(remote.exclude ?? [], body.exclude ?? [])
    && same(remote.require ?? [], body.require ?? [])
    && remote.session_duration === body.session_duration
  );
}

function applicationBody(
  application: AccessApplication,
  policies: ReadonlyMap<string, RemotePolicy>
): Record<string, unknown> {
  return {
    name: application.name,
    domain: application.domain,
    type: "self_hosted",
    ...(application.destinations === undefined ? {} : { destinations: application.destinations }),
    ...(application.sessionDuration === undefined ?
      {}
    : { session_duration: application.sessionDuration }),
    policies: [...application.policies]
      .sort((left, right) => left.precedence - right.precedence)
      .map((reference) => {
        const policy = policies.get(reference.name);
        if (policy === undefined) throw new Error(`Policy '${reference.name}' was not resolved.`);
        return { id: policy.id, precedence: reference.precedence };
      })
  };
}

function applicationMatches(remote: RemoteApplication, body: Record<string, unknown>): boolean {
  const links = (remote.policies ?? [])
    .map(({ id, precedence }) => ({ id, precedence }))
    .sort((left, right) => left.precedence! - right.precedence!);
  return (
    remote.name === body.name
    && remote.domain === body.domain
    && remote.type === body.type
    && same(remote.destinations ?? [], body.destinations ?? [])
    && remote.session_duration === body.session_duration
    && same(links, body.policies)
  );
}

/**
 * Plans an apply against one discovery snapshot.
 *
 * @param config - Validated desired configuration.
 * @param snapshot - Previously discovered account state.
 * @returns Ordered policy-first changes.
 */
export function planAccessApply(config: AccessConfig, snapshot: AccessSnapshot): AccessChange[] {
  const policies = new Map(snapshot.policies.map((policy) => [policy.name, policy]));
  const changes: AccessChange[] = config.policies.map((policy) => {
    const found = policies.get(policy.name);
    return {
      action:
        found === undefined ? "create"
        : policyMatches(found, policy) ? "no-change"
        : "update",
      kind: "policy",
      name: policy.name
    };
  });
  const resolved = new Map(
    config.policies.map((policy) => [
      policy.name,
      policies.get(policy.name) ?? { id: `(new:${policy.name})`, name: policy.name }
    ])
  );
  const applications = new Map(
    snapshot.applications.map((application) => [application.name, application])
  );
  for (const application of config.applications) {
    const found = applications.get(application.name);
    const body = applicationBody(application, resolved);
    changes.push({
      action:
        found === undefined ? "create"
        : applicationMatches(found, body) ? "no-change"
        : "update",
      kind: "application",
      name: application.name
    });
  }
  return changes;
}

function checkRemovalLinks(config: AccessConfig, snapshot: AccessSnapshot): void {
  const configuredApplications = new Set(config.applications.map(({ name }) => name));
  for (const configuredPolicy of config.policies) {
    const policy = snapshot.policies.find(({ name }) => name === configuredPolicy.name);
    if (policy === undefined) continue;
    if (policy.app_count === undefined)
      throw new Error(`Reusable policy '${policy.name}' has no verifiable application count.`);
    const linked = snapshot.applications.filter((application) =>
      (application.policies ?? []).some(({ id }) => id === policy.id)
    );
    if (linked.some(({ name }) => !configuredApplications.has(name)))
      throw new Error(`Reusable policy '${policy.name}' is linked to an unmanaged application.`);
    if (policy.app_count !== linked.length)
      throw new Error(`Reusable policy '${policy.name}' has unverified application links.`);
  }
}

/**
 * Plans bounded removal after verifying no configured policy is linked to an unmanaged app.
 *
 * @param config - Validated desired configuration.
 * @param snapshot - Previously discovered account state.
 * @returns Ordered application-first changes.
 */
export function planAccessRemove(config: AccessConfig, snapshot: AccessSnapshot): AccessChange[] {
  checkRemovalLinks(config, snapshot);
  return [
    ...config.applications.map((application): AccessChange => ({
      action:
        snapshot.applications.some(({ name }) => name === application.name) ?
          "delete"
        : "no-change",
      kind: "application",
      name: application.name
    })),
    ...config.policies.map((policy): AccessChange => ({
      action: snapshot.policies.some(({ name }) => name === policy.name) ? "delete" : "no-change",
      kind: "policy",
      name: policy.name
    }))
  ];
}

function unwrapCreated(value: unknown): unknown {
  if (object(value) && value.result !== undefined) return value.result;
  if (object(value) && value.data !== undefined) return value.data;
  return value;
}

/**
 * Executes a previously computed apply plan without rediscovery.
 *
 * @param config - Validated desired configuration.
 * @param snapshot - Snapshot used to compute the plan.
 * @param changes - Previously computed apply plan.
 * @param api - Cloudflare CLI adapter.
 */
export function executeAccessApply(
  config: AccessConfig,
  snapshot: AccessSnapshot,
  changes: AccessChange[],
  api: AccessApi
): void {
  const policies = new Map(snapshot.policies.map((policy) => [policy.name, policy]));
  for (const policy of config.policies) {
    const change = changes.find(
      (candidate) => candidate.kind === "policy" && candidate.name === policy.name
    )!;
    const found = policies.get(policy.name);
    if (change.action === "create") {
      const created = remotePolicy(unwrapCreated(api.createPolicy(policyBody(policy))));
      policies.set(policy.name, created);
    } else if (change.action === "update") {
      api.updatePolicy(found!.id, policyBody(policy));
    }
  }
  const applications = new Map(
    snapshot.applications.map((application) => [application.name, application])
  );
  for (const application of config.applications) {
    const change = changes.find(
      (candidate) => candidate.kind === "application" && candidate.name === application.name
    )!;
    const found = applications.get(application.name);
    const body = applicationBody(application, policies);
    if (change.action === "create") api.createApplication(body);
    else if (change.action === "update") api.updateApplication(found!.id, body);
  }
}

/**
 * Executes a previously computed bounded removal plan without rediscovery.
 *
 * @param snapshot - Snapshot used to compute the plan.
 * @param changes - Previously computed removal plan.
 * @param api - Cloudflare CLI adapter.
 */
export function executeAccessRemove(
  snapshot: AccessSnapshot,
  changes: AccessChange[],
  api: AccessApi
): void {
  for (const change of changes) {
    if (change.action !== "delete") continue;
    if (change.kind === "application")
      api.deleteApplication(snapshot.applications.find(({ name }) => name === change.name)!.id);
    else api.deletePolicy(snapshot.policies.find(({ name }) => name === change.name)!.id);
  }
}
