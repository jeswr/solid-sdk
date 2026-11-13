// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import {
  createStorageResource,
  missingResource,
  writeStorageRdf,
} from "../pod/storage-resource.js";
import { ensureTypeRegistrations } from "../pod/type-index-write.js";
import { abortablePodWriter } from "./abort.js";
import { IntegrationSyncError } from "./errors.js";
import { containerResolver, strongEtag, validateBinaryType } from "./pod-writer-policy.js";
import type { PodWriter } from "./types.js";

export interface StoragePodWriterOptions {
  readonly storage: StorageClient;
  /** Absolute connector container, e.g. <storage.root>integrations/spotify/. */
  readonly container: string;
  readonly webId?: string;
  readonly signal?: AbortSignal;
  readonly typeIndex?: {
    readonly profileDocumentUrl: string;
    readonly podRoot?: string;
    /** Select a client for the pinned profile or validated index in another storage. */
    readonly storageFor?: (url: string) => StorageClient;
  };
}

/** Storage-backed PodWriter with deterministic Solid paths and conditional mutations only. */
export function createStoragePodWriter(options: StoragePodWriterOptions): PodWriter {
  const { storage, container, webId, signal, typeIndex } = options;
  if (storage.protocol !== "solid")
    throw new TypeError("Connector slugs require a Solid storage backend.");
  const resolve = containerResolver(container, "storage");
  if (!storage.isWithinStorage(container)) throw new TypeError("Container is outside storage.");
  async function currentEtag(url: string): Promise<string | undefined> {
    signal?.throwIfAborted();
    try {
      const current = await storage.head(url, { signal, revalidate: true });
      return strongEtag(current.etag, "storage", url);
    } catch (error) {
      if (missingResource(error)) return undefined;
      throw error;
    }
  }
  return abortablePodWriter(
    {
      webId,
      resolve,
      async read(slug) {
        try {
          const result = await storage.readRdf(resolve(slug), { signal });
          // storage-client's RdfReadResult does not expose Last-Modified today. Forward it once
          // a backend supplies one; until then two-way lww conflicts fall back to manual.
          const modified = (result as { lastModified?: unknown }).lastModified;
          const lastModified =
            modified instanceof Date && Number.isFinite(modified.getTime())
              ? modified.toISOString()
              : undefined;
          return {
            dataset: result.dataset,
            etag: result.etag,
            ...(lastModified ? { lastModified } : {}),
          };
        } catch (error) {
          if (missingResource(error)) return undefined;
          throw error;
        }
      },
      async write(doc, conditions = {}) {
        const url = resolve(doc.slug);
        if (conditions.ifMatch !== undefined && conditions.ifNoneMatch !== undefined)
          throw new TypeError("Supply only one write precondition.");
        let conditional = conditions;
        if (conditions.ifMatch === undefined && conditions.ifNoneMatch === undefined) {
          const etag = await currentEtag(url);
          conditional = etag === undefined ? { ifNoneMatch: "*" } : { ifMatch: etag };
        }
        await writeStorageRdf(storage, url, doc.dataset, conditional, signal);
        return {
          url,
          category: doc.category,
          forClass: doc.forClass,
          skipRegistration: doc.skipRegistration,
        };
      },
      async writeBinary(doc) {
        const url = resolve(doc.slug);
        validateBinaryType(doc.contentType, "storage");
        const body = new Blob([doc.body as Uint8Array<ArrayBuffer>], { type: doc.contentType });
        const mode = doc.mode ?? "create";
        if (mode !== "create" && mode !== "replace") throw new TypeError("Invalid binary mode.");
        const etag = mode === "replace" ? await currentEtag(url) : undefined;
        signal?.throwIfAborted();
        try {
          if (etag !== undefined)
            await storage.write(url, body, {
              contentType: doc.contentType,
              ifMatch: etag,
              signal,
            });
          else await createStorageResource(storage, url, body, doc.contentType, signal);
        } catch (error) {
          if (mode === "create" && error instanceof StorageError && error.status === 412)
            return { url, created: false };
          throw error;
        }
        return { url, created: true };
      },
      async remove(slug, conditions = {}) {
        const url = resolve(slug);
        const etag =
          conditions.ifMatch === undefined
            ? await currentEtag(url)
            : strongEtag(conditions.ifMatch, "storage", url);
        if (etag === undefined) return;
        signal?.throwIfAborted();
        try {
          await storage.delete(url, { ifMatch: etag, signal });
        } catch (error) {
          if (!missingResource(error)) throw error;
        }
      },
      async registerType(registrations) {
        if (!webId || !typeIndex)
          throw new IntegrationSyncError(
            "storage",
            "Type Index registration requires a WebID and profile document.",
          );
        return ensureTypeRegistrations({
          webId,
          profileDocumentUrl: typeIndex.profileDocumentUrl,
          podRoot: typeIndex.podRoot ?? storage.root,
          registrations: [...registrations],
          storageFor: typeIndex.storageFor ?? (() => storage),
          signal,
        });
      },
    },
    signal,
  );
}
