/** A single Cloudflare Access policy rule. */
export type AccessRule = Record<string, unknown>;

/** A reusable Cloudflare Access policy managed by `cf-access-policy`. */
export interface AccessPolicy {
  /** Stable policy name used as the reconciliation key. */
  name: string;
  /** Action Cloudflare Access takes when the policy matches. */
  decision: "allow" | "deny" | "non_identity" | "bypass";
  /** Rules that select identities to which the policy applies. */
  include: AccessRule[];
  /** Optional rules that exclude otherwise matching identities. */
  exclude?: AccessRule[];
  /** Optional additional rules that matching identities must satisfy. */
  require?: AccessRule[];
  /** Optional Cloudflare Access session duration, such as `24h`. */
  sessionDuration?: string;
}

/** A self-hosted Cloudflare Access application managed by `cf-access-policy`. */
export interface AccessApplication {
  /** Stable application name used as the reconciliation key. */
  name: string;
  /** Primary domain protected by the application. */
  domain: string;
  /** Optional public destinations protected by the application. */
  destinations?: { type: "public"; uri: string }[];
  /** Optional Cloudflare Access session duration, such as `24h`. */
  sessionDuration?: string;
  /** Reusable policy names and their unique evaluation precedence. */
  policies: { name: string; precedence: number }[];
}

/** Declarative configuration consumed by the `cf-access-policy` CLI. */
export interface AccessConfig {
  /** Reusable policies to reconcile. */
  policies: AccessPolicy[];
  /** Self-hosted applications to reconcile. */
  applications: AccessApplication[];
}

/**
 * Defines a typed Access configuration without changing it at runtime.
 *
 * @param config - Reusable policies and applications to reconcile.
 * @returns The exact supplied configuration object.
 */
export function defineAccessConfig<const T extends AccessConfig>(config: T): T {
  return config;
}
