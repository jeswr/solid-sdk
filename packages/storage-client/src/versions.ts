// AUTHORED-BY Codex GPT-6.1-Sol
import { StorageError } from "./errors.js";
import { discard, scoped } from "./http.js";
import {
  encodeResource,
  invalidService,
  serviceEndpoint,
  serviceEtag,
  serviceUrl,
} from "./services.js";
import type { StorageClient, WriteResult } from "./types.js";

/** An immutable Memento and its representation validator. */
export interface VersionEntry {
  url: string;
  at: Date;
  etag: string | null;
}
/** Optional VersioningService operations. Restores always use the live resource's ETag. */
export interface VersionsClient {
  versions(url: string): Promise<VersionEntry[]>;
  restoreVersion(url: string, versionUrl: string): Promise<WriteResult>;
}

/** Bind version history and conditional restore to an existing StorageClient. */
export function createVersionsClient(storage: StorageClient): VersionsClient {
  async function history(url: string): Promise<{ resource: string; container: string }> {
    const template = serviceEndpoint(storage, "versioning");
    const resource = serviceUrl(storage, "GET", url);
    if (
      template.split("{resource}").length !== 2 ||
      /[{}]/.test(template.replace("{resource}", ""))
    )
      throw invalidService("GET", storage.root);
    scoped(storage.root, "GET", template.replace("{resource}", "resource"));
    const live = await storage.head(resource);
    const linked = live.links.get("version-history");
    if (linked !== undefined && linked.length !== 1) throw invalidService("HEAD", resource);
    const container = scoped(
      storage.root,
      "GET",
      linked?.[0]?.target ?? template.replace("{resource}", encodeResource(resource)),
    );
    return { resource, container };
  }
  const client: VersionsClient = {
    async versions(url) {
      const { container } = await history(url);
      const entries: VersionEntry[] = [];
      for await (const entry of storage.listAll(container)) {
        const target = serviceUrl(storage, "HEAD", entry.url);
        const head = await storage.head(target);
        if (!head.mementoDatetime || Number.isNaN(head.mementoDatetime.getTime()))
          throw invalidService("HEAD", target);
        entries.push({ url: target, at: head.mementoDatetime, etag: head.etag });
      }
      return entries;
    },
    async restoreVersion(url, versionUrl) {
      serviceEndpoint(storage, "versioning");
      const version = serviceUrl(storage, "GET", versionUrl);
      const { resource } = await history(url);
      if (
        version === resource ||
        !(await client.versions(resource)).some((entry) => entry.url === version)
      )
        throw new StorageError("not-found", { method: "GET", url: version });
      const live = await storage.head(resource);
      const ifMatch = serviceEtag(live);
      const read = await storage.read(version);
      if (
        read.status !== 200 ||
        read.contentType === null ||
        !read.mementoDatetime ||
        Number.isNaN(read.mementoDatetime.getTime())
      ) {
        discard(read.body);
        throw invalidService("GET", version);
      }
      return storage.write(resource, read.body ?? new Uint8Array(), {
        contentType: read.contentType,
        ifMatch,
      });
    },
  };
  return client;
}
