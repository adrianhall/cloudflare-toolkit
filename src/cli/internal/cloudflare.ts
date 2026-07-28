/** @file Private Cloudflare and OCI adapters used by cleanup CLIs. */
import type { Logger } from "./logger.js";

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
