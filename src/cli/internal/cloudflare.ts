/** @file Private Cloudflare and OCI adapters used by cleanup CLIs. */
import type { Logger } from "./logger.js";
import { getErrorMessage } from "./utils.js";

/** Minimal container application shape returned by Cloudflare. */
export interface ContainerApp {
  /** Application ID. */
  id: string;
  /** Application name. */
  name?: string;
  /** Image reference. */
  image?: string;
}

/** OCI repository and its human-readable tags. */
export interface RepoInfo {
  /** Repository path. */
  name: string;
  /** Tags excluding digest pseudo-tags. */
  tags: string[];
}

/** Injectable container REST API adapter. */
export interface ContainersApi {
  /** Lists applications, rejecting when discovery fails. */
  listApplications(accountId: string, apiToken: string): Promise<ContainerApp[]>;
  /** Deletes one application. */
  deleteApplication(accountId: string, apiToken: string, appId: string): Promise<boolean>;
  /** Obtains short-lived Basic auth for the Cloudflare OCI registry. */
  getRegistryCredentials(accountId: string, apiToken: string): Promise<string>;
}

/** Injectable OCI registry adapter. */
export interface RegistryClient {
  /** Lists matching repositories and tags, rejecting when discovery fails. */
  listRepos(auth: string, workerName: string): Promise<RepoInfo[]>;
  /** Deletes one tag's manifest. */
  deleteTag(auth: string, repoName: string, tag: string): Promise<boolean>;
}

const API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const REGISTRY_BASE = "https://registry.cloudflare.com";
const MANIFEST_ACCEPT =
  "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json";

/** Creates the Cloudflare container REST API adapter. */
export function createContainersApi(
  logger: Logger,
  fetchFn: typeof fetch = globalThis.fetch
): ContainersApi {
  return {
    async listApplications(accountId, apiToken) {
      const url = `${API_BASE}/${accountId}/containers/applications`;
      logger.debug(`Listing container applications: ${url}`);
      try {
        const response = await fetchFn(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiToken}` }
        });
        logger.debug(`Container applications response: ${response.status}`);
        if (!response.ok)
          throw new Error(`Container applications API returned HTTP ${response.status}`);
        const body: { result?: unknown } = await response.json();
        if (!Array.isArray(body.result))
          throw new Error("Container applications response missing result array");
        const apps = body.result as ContainerApp[];
        logger.debug(`Found ${apps.length} container application(s)`);
        return apps;
      } catch (error: unknown) {
        throw new Error(`Container application discovery failed: ${String(error)}`);
      }
    },
    async deleteApplication(accountId, apiToken, appId) {
      const url = `${API_BASE}/${accountId}/containers/applications/${appId}`;
      logger.debug(`Deleting container application: ${url}`);
      try {
        const response = await fetchFn(url, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${apiToken}` }
        });
        logger.debug(`Delete application response: ${response.status}`);
        if (!response.ok)
          logger.error(`Failed to delete application ${appId}: HTTP ${response.status}`);
        return response.ok;
      } catch (error: unknown) {
        logger.error(`Failed to delete application ${appId}: ${String(error)}`);
        return false;
      }
    },
    async getRegistryCredentials(accountId, apiToken) {
      const url = `${API_BASE}/${accountId}/containers/registries/registry.cloudflare.com/credentials`;
      logger.debug(`Requesting registry credentials: ${url}`);
      try {
        const response = await fetchFn(url, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ expiration_minutes: 5, permissions: ["pull", "push"] })
        });
        logger.debug(`Registry credentials response: ${response.status}`);
        if (!response.ok)
          throw new Error(`Registry credentials API returned HTTP ${response.status}`);
        const body: { result?: { password?: string } } = await response.json();
        if (!body.result?.password)
          throw new Error("Registry credentials response missing password");
        return Buffer.from(`v1:${body.result.password}`).toString("base64");
      } catch (error: unknown) {
        throw new Error(`Registry credential discovery failed: ${String(error)}`);
      }
    }
  };
}

/** Creates the Cloudflare OCI registry adapter. */
export function createRegistryClient(
  logger: Logger,
  fetchFn: typeof fetch = globalThis.fetch
): RegistryClient {
  return {
    async listRepos(auth, workerName) {
      const url = `${REGISTRY_BASE}/v2/_catalog?tags=true`;
      logger.debug(`Listing OCI catalog: ${url}`);
      try {
        const response = await fetchFn(url, {
          method: "GET",
          headers: { Authorization: `Basic ${auth}` }
        });
        logger.debug(`OCI catalog response: ${response.status}`);
        if (!response.ok) throw new Error(`OCI catalog returned HTTP ${response.status}`);
        const body: { repositories?: unknown } = await response.json();
        if (
          typeof body.repositories !== "object"
          || body.repositories === null
          || Array.isArray(body.repositories)
        ) {
          throw new Error("OCI catalog response missing repositories object");
        }
        const repositories = body.repositories as Record<string, string[]>;
        logger.debug(`Raw repository count: ${Object.keys(repositories).length}`);
        const result: RepoInfo[] = [];
        for (const [path, tags] of Object.entries(repositories)) {
          const name = path.startsWith("/") ? path.slice(1) : path;
          if (!name.includes(workerName)) continue;
          const humanTags = tags.filter((tag) => !tag.startsWith("sha256:"));
          logger.debug(
            `Repo ${name}: ${tags.length} total tag(s), ${humanTags.length} human-readable`
          );
          if (humanTags.length > 0) result.push({ name, tags: humanTags });
        }
        return result;
      } catch (error: unknown) {
        throw new Error(`OCI registry discovery failed: ${String(error)}`);
      }
    },
    async deleteTag(auth, repoName, tag) {
      const headers = { Authorization: `Basic ${auth}`, Accept: MANIFEST_ACCEPT };
      const headUrl = `${REGISTRY_BASE}/v2/${repoName}/manifests/${tag}`;
      logger.debug(`Resolving digest: HEAD ${headUrl}`);
      let digest: string | null = null;
      try {
        const response = await fetchFn(headUrl, { method: "HEAD", headers });
        if (response.ok) {
          digest = response.headers.get("Docker-Content-Digest");
          logger.debug(`Resolved digest: ${digest ?? "(missing header)"}`);
        } else logger.debug(`HEAD returned ${response.status} - will fall back to delete by tag`);
      } catch (error: unknown) {
        logger.debug(`HEAD failed: ${String(error)} - will fall back to delete by tag`);
      }
      const deleteUrl = `${REGISTRY_BASE}/v2/${repoName}/manifests/${digest ?? tag}`;
      logger.debug(`Deleting manifest: DELETE ${deleteUrl}`);
      try {
        const response = await fetchFn(deleteUrl, { method: "DELETE", headers });
        logger.debug(`Delete manifest response: ${response.status}`);
        if (!response.ok)
          logger.error(`Failed to delete ${repoName}:${tag}: HTTP ${response.status}`);
        return response.ok;
      } catch (error: unknown) {
        logger.error(`Failed to delete ${repoName}:${tag}: ${String(error)}`);
        return false;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// R2 bucket emptying (empty-r2-bucket)
// ---------------------------------------------------------------------------

/**
 * Target bucket for an {@link R2BucketCleaner} operation.
 *
 * Remote (Cloudflare REST API) targets populate `accountId`/`apiToken`; local (Miniflare Local
 * Explorer) targets populate `localUrl` instead. `empty-r2-bucket`'s orchestration resolves
 * exactly one mode per invocation and only ever calls the matching adapter, so each adapter only
 * reads the fields relevant to it.
 */
export interface R2Target {
  /** Bucket name to operate on. */
  bucketName: string;
  /** Cloudflare account ID (remote mode only). */
  accountId?: string;
  /** Cloudflare API token (remote mode only). */
  apiToken?: string;
  /** Local Explorer API base URL, e.g. `http://localhost:5173/cdn-cgi/explorer/api` (local mode only). */
  localUrl?: string;
}

/**
 * Injectable adapter that checks for and empties objects in one R2 bucket.
 *
 * One contract is shared by the production (Cloudflare REST API) and local (Miniflare Local
 * Explorer) adapters, which are free to use different platform-appropriate mechanisms internally.
 */
export interface R2BucketCleaner {
  /** Resolves `true` only after a successful probe finds at least one object. */
  hasObjects(target: R2Target): Promise<boolean>;
  /** Empties the bucket, resolving only once emptying is confirmed complete. */
  empty(target: R2Target): Promise<void>;
}

/** Injectable delay used by the production adapter's completion poll. */
export type SleepFn = (ms: number) => Promise<void>;

// Bounded backoff for the production completion poll: 30 attempts * 2s = 60s total. Cloudflare
// documents that large empty operations can run in the background, so a successful DELETE
// response is treated as acceptance rather than completion (see docs/specs/EMPTY_R2_BUCKET.md).
const R2_POLL_MAX_ATTEMPTS = 30;
const R2_POLL_INTERVAL_MS = 2000;

// Local Explorer's delete-objects endpoint accepts an array of keys with no documented limit;
// batching bounds request/response size and mirrors the list endpoint's own 1000-item default.
const R2_LOCAL_DELETE_BATCH_SIZE = 1000;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Parsed `{ result, result_info }` envelope shared by the Cloudflare and Local Explorer APIs. */
interface R2ListEnvelope {
  result: unknown[];
  resultInfo?: { cursor?: unknown; is_truncated?: unknown };
}

/** Parses and validates a `{ result: [...] }` list-objects response envelope. */
async function parseR2ListEnvelope(response: Response, context: string): Promise<R2ListEnvelope> {
  if (!response.ok) throw new Error(`${context} returned HTTP ${response.status}`);
  const body: { result?: unknown; result_info?: unknown } = await response.json();
  if (!Array.isArray(body.result)) throw new Error(`${context} response missing result array`);
  return { result: body.result, resultInfo: body.result_info as R2ListEnvelope["resultInfo"] };
}

/** Creates the production Cloudflare REST API R2 bucket-emptying adapter. */
export function createRemoteR2Cleaner(
  logger: Logger,
  fetchFn: typeof fetch = globalThis.fetch,
  sleepFn: SleepFn = defaultSleep
): R2BucketCleaner {
  async function probe(target: R2Target): Promise<boolean> {
    const url = `${API_BASE}/${target.accountId}/r2/buckets/${target.bucketName}/objects?per_page=1`;
    logger.debug(`Probing R2 bucket objects: GET ${url}`);
    const response = await fetchFn(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${target.apiToken}` }
    });
    logger.debug(`R2 objects probe response: ${response.status}`);
    const { result } = await parseR2ListEnvelope(response, "R2 objects probe");
    return result.length > 0;
  }

  return {
    async hasObjects(target) {
      try {
        return await probe(target);
      } catch (error: unknown) {
        throw new Error(`R2 bucket probe failed: ${String(error)}`);
      }
    },
    async empty(target) {
      const deleteUrl = `${API_BASE}/${target.accountId}/r2/buckets/${target.bucketName}/objects?prefix=`;
      logger.debug(`Emptying R2 bucket: DELETE ${deleteUrl}`);
      let response: Response;
      try {
        response = await fetchFn(deleteUrl, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${target.apiToken}` }
        });
      } catch (error: unknown) {
        throw new Error(`R2 bucket empty request failed: ${String(error)}`);
      }
      logger.debug(`R2 bucket empty response: ${response.status}`);
      if (!response.ok) throw new Error(`R2 bucket empty request returned HTTP ${response.status}`);
      // The DELETE response is acceptance, not completion - poll until the probe confirms empty.
      for (let attempt = 1; attempt <= R2_POLL_MAX_ATTEMPTS; attempt++) {
        let stillHasObjects: boolean;
        try {
          stillHasObjects = await probe(target);
        } catch (error: unknown) {
          throw new Error(`R2 bucket completion poll failed: ${String(error)}`);
        }
        if (!stillHasObjects) {
          logger.debug(`R2 bucket confirmed empty after ${attempt} poll attempt(s)`);
          return;
        }
        logger.debug(
          `R2 bucket still has objects - poll attempt ${attempt}/${R2_POLL_MAX_ATTEMPTS}`
        );
        if (attempt < R2_POLL_MAX_ATTEMPTS) await sleepFn(R2_POLL_INTERVAL_MS);
      }
      throw new Error(
        `R2 bucket did not become empty after ${R2_POLL_MAX_ATTEMPTS} poll attempt(s)`
      );
    }
  };
}

/** Lists one page of objects from the Local Explorer API and validates its shape. */
async function listLocalR2Page(
  fetchFn: typeof fetch,
  logger: Logger,
  localUrl: string,
  bucketName: string,
  params: URLSearchParams
): Promise<{ keys: string[]; cursor?: string; truncated: boolean }> {
  const url = `${localUrl}/r2/buckets/${bucketName}/objects?${params.toString()}`;
  logger.debug(`Listing local R2 bucket objects: GET ${url}`);
  let response: Response;
  try {
    response = await fetchFn(url, { method: "GET" });
  } catch (error: unknown) {
    throw new Error(`Local R2 objects request failed: ${String(error)}`);
  }
  logger.debug(`Local R2 objects response: ${response.status}`);
  const { result, resultInfo } = await parseR2ListEnvelope(response, "Local R2 objects request");
  const keys = result.map((entry) => {
    if (
      typeof entry !== "object"
      || entry === null
      || typeof (entry as { key?: unknown }).key !== "string"
    ) {
      throw new Error("Local R2 objects response contains a malformed entry");
    }
    return (entry as { key: string }).key;
  });
  // Local Explorer reports `is_truncated` as the string "true"/"false", not a boolean.
  const truncated = resultInfo?.is_truncated === "true";
  let cursor: string | undefined;
  if (truncated) {
    if (typeof resultInfo?.cursor !== "string" || resultInfo.cursor === "")
      throw new Error("Local R2 objects response is truncated but missing a cursor");
    cursor = resultInfo.cursor;
  }
  return { keys, cursor, truncated };
}

/** Paginates through every object and deletes it in batches, stopping at the first failure. */
async function deleteAllLocalR2Objects(
  fetchFn: typeof fetch,
  logger: Logger,
  localUrl: string,
  bucketName: string
): Promise<void> {
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const params = new URLSearchParams({ per_page: String(R2_LOCAL_DELETE_BATCH_SIZE) });
    if (cursor !== undefined) params.set("cursor", cursor);
    const page = await listLocalR2Page(fetchFn, logger, localUrl, bucketName, params);
    if (page.keys.length > 0) {
      const deleteUrl = `${localUrl}/r2/buckets/${bucketName}/objects`;
      logger.debug(`Deleting ${page.keys.length} local R2 object(s): DELETE ${deleteUrl}`);
      const response = await fetchFn(deleteUrl, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(page.keys)
      });
      logger.debug(`Local R2 batch delete response: ${response.status}`);
      if (!response.ok)
        throw new Error(`Local R2 batch delete request returned HTTP ${response.status}`);
      const body: { result?: unknown } = await response.json();
      if (!Array.isArray(body.result) || body.result.length !== page.keys.length)
        throw new Error("Local R2 batch delete response did not confirm every key");
    }
    if (!page.truncated) return;
    if (page.cursor === undefined || seenCursors.has(page.cursor))
      throw new Error("Local R2 pagination did not make progress (repeated or missing cursor)");
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  }
}

/** Creates the Miniflare Local Explorer R2 bucket-emptying adapter. */
export function createLocalR2Cleaner(
  logger: Logger,
  fetchFn: typeof fetch = globalThis.fetch
): R2BucketCleaner {
  async function probe(target: R2Target): Promise<boolean> {
    const page = await listLocalR2Page(
      fetchFn,
      logger,
      target.localUrl!,
      target.bucketName,
      new URLSearchParams({ per_page: "1" })
    );
    return page.keys.length > 0;
  }

  return {
    async hasObjects(target) {
      try {
        return await probe(target);
      } catch (error: unknown) {
        throw new Error(`Local R2 bucket probe failed: ${String(error)}`);
      }
    },
    async empty(target) {
      let loopError: unknown;
      try {
        await deleteAllLocalR2Objects(fetchFn, logger, target.localUrl!, target.bucketName);
      } catch (error: unknown) {
        loopError = error;
        logger.debug(`Local R2 batch deletion stopped early: ${String(error)}`);
      }
      let stillHasObjects: boolean;
      try {
        stillHasObjects = await probe(target);
      } catch (error: unknown) {
        throw new Error(`Local R2 final verification failed: ${String(error)}`);
      }
      if (stillHasObjects) {
        throw new Error(
          loopError !== undefined ?
            `Local R2 batch deletion failed and objects remain: ${getErrorMessage(loopError)}`
          : "Local R2 bucket still contains objects after batch deletion"
        );
      }
    }
  };
}
