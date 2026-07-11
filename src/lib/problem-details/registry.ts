/**
 * @file A registry for pre-defined, type-safe RFC 9457 problem types.
 */
import { ProblemDetailsError } from "./error.js";

/** The base RFC 9457 definition (type, status, title) registered for a problem type key. */
export interface ProblemTypeDefinition {
  /** A URI identifying the problem type, per RFC 9457. */
  readonly type: string;
  /** The HTTP status code for this problem type. */
  readonly status: number;
  /** A short, human-readable summary of the problem type. */
  readonly title: string;
}

/** Per-instance overrides accepted by {@link ProblemTypeRegistry}'s `create()` method. */
export interface CreateOptions<T extends Record<string, unknown> = Record<string, unknown>> {
  /** A human-readable explanation specific to this occurrence of the problem. */
  detail?: string;
  /** A URI identifying this specific occurrence of the problem. */
  instance?: string;
  /** Additional problem-specific extension members. */
  extensions?: T;
}

/** A registry of pre-defined problem types, returned by {@link createProblemTypeRegistry}. */
export interface ProblemTypeRegistry<K extends string> {
  /** Create a {@link ProblemDetailsError} from a registered problem type key. */
  create: <T extends Record<string, unknown>>(
    key: K,
    options?: CreateOptions<T>
  ) => ProblemDetailsError;
  /**
   * Get the base definition (type, status, title) for a registered key.
   * Returns a defensive shallow copy on every call, so mutating the result never affects the
   * registry's internal definitions.
   */
  get: (key: K) => Readonly<ProblemTypeDefinition>;
  /** List all registered problem type keys. */
  types: () => K[];
}

/**
 * Create a registry of pre-defined problem types.
 * Provides type-safe error creation from registered definitions.
 *
 * @param definitions - A map of problem type keys to their base definition (type, status, title).
 * @returns A {@link ProblemTypeRegistry} for the given definitions.
 * @example
 * ```ts
 * const problems = createProblemTypeRegistry({
 *   ORDER_CONFLICT: {
 *     type: "https://api.example.com/problems/order-conflict",
 *     status: 409,
 *     title: "Order Conflict",
 *   },
 * });
 * throw problems.create("ORDER_CONFLICT", { detail: "Already exists" });
 * ```
 */
export function createProblemTypeRegistry<K extends string>(
  definitions: Record<K, ProblemTypeDefinition>
): ProblemTypeRegistry<K> {
  return {
    create: (key, options) => new ProblemDetailsError({ ...definitions[key], ...options }),
    get: (key) => ({ ...definitions[key] }),
    types: () => Object.keys(definitions) as K[]
  };
}
