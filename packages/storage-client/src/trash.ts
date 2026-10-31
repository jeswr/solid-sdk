// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@jeswr/fetch-rdf";
import { LiteralAs, OptionalFrom } from "@rdfjs/wrapper";
import { Resource } from "@solid/object/solid";
import { DataFactory } from "n3";
import { StorageError } from "./errors.js";
import { dateOf } from "./http.js";
import { invalidService, serviceEndpoint, serviceEtag, serviceUrl } from "./services.js";
import type { MetadataLink, StorageClient, WriteResult } from "./types.js";

const ORIGINAL = "http://www.iana.org/assignments/relation/original";
const MODIFIED = "http://purl.org/dc/terms/modified";

/** A server-managed trash entry. Optional listing fields remain null when absent. */
export interface TrashEntry {
  url: string;
  original: string;
  trashedAt: Date;
  size: number | null;
  contentType: string | null;
}
/** Optional TrashService operations, gated before any storage request. */
export interface TrashClient {
  trash(url: string): Promise<WriteResult>;
  listTrash(): Promise<TrashEntry[]>;
  restore(trashedUrl: string): Promise<WriteResult>;
  purge(trashedUrl: string): Promise<void>;
}

/** Bind the trash client to an existing pod or memory StorageClient. */
export function createTrashClient(storage: StorageClient): TrashClient {
  const endpoint = () => serviceUrl(storage, "POST", serviceEndpoint(storage, "trash"));
  const client: TrashClient = {
    async trash(url) {
      const service = endpoint();
      const resource = serviceUrl(storage, "POST", url);
      return storage.create(service, JSON.stringify({ resource }), {
        contentType: "application/json",
      });
    },
    async listTrash() {
      const service = endpoint();
      const entries: TrashEntry[] = [];
      for await (const entry of storage.listAll(service)) {
        const url = serviceUrl(storage, "GET", entry.url);
        const metadata = await storage.metadata(url);
        const targets = metadata.links
          .get(url)
          ?.get(storage.protocol === "solid" ? ORIGINAL : "original");
        if (targets?.length !== 1) throw invalidService("GET", url);
        const target = targets[0] as MetadataLink;
        let modified: string | undefined;
        if (storage.protocol === "lws") modified = target.params.modified;
        else {
          try {
            modified = OptionalFrom.subjectPredicate(
              new Resource(url, metadata.raw as DatasetCore, DataFactory),
              MODIFIED,
              LiteralAs.string,
            );
          } catch {
            throw invalidService("GET", url);
          }
        }
        const trashedAt = dateOf(modified ?? null);
        if (trashedAt === null) throw invalidService("GET", url);
        entries.push({
          url,
          original: serviceUrl(storage, "GET", target.href),
          trashedAt,
          size: entry.size,
          contentType: entry.contentType,
        });
      }
      return entries;
    },
    async restore(trashedUrl) {
      const service = endpoint();
      const url = serviceUrl(storage, "POST", trashedUrl);
      const entry = (await client.listTrash()).find((entry) => entry.url === url);
      if (!entry) throw new StorageError("not-found", { method: "POST", url });
      const result = await storage.create(service, JSON.stringify({ restore: url }), {
        contentType: "application/json",
      });
      if (
        (storage.protocol === "solid" && result.url !== entry.original) ||
        (storage.protocol === "lws" && result.url === entry.original)
      )
        throw invalidService("POST", service);
      return result;
    },
    async purge(trashedUrl) {
      endpoint();
      const url = serviceUrl(storage, "DELETE", trashedUrl);
      if (!(await client.listTrash()).some((entry) => entry.url === url))
        throw new StorageError("not-found", { method: "DELETE", url });
      const head = await storage.head(url);
      await storage.delete(url, { ifMatch: serviceEtag(head) });
    },
  };
  return client;
}
