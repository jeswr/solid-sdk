// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type StorageClient, StorageError, type WriteResult } from "@jeswr/storage-client";
import { createSolidBackend, type SolidBackendOptions } from "@jeswr/storage-client/solid";
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
  readonly verifyPrivateDestination?: PodWriter["verifyPrivateDestination"];
  readonly signal?: AbortSignal;
  readonly typeIndex?: {
    readonly profileDocumentUrl: string;
    readonly podRoot?: string;
    /** Select a client for the pinned profile or validated index in another storage. */
    readonly storageFor?: (url: string) => StorageClient;
  };
}

/** Connector storage at a known Solid root. The host must independently establish WAC. */
export function createWacImportStorage(
  options: Pick<SolidBackendOptions, "root" | "fetch">,
): StorageClient {
  const storage = createSolidBackend(options);
  return {
    ...storage,
    features: {
      ...storage.features,
      accessControl: { state: "available", evidence: "verified-wac", detail: { model: "wac" } },
    },
  };
}

/** Storage-backed PodWriter with deterministic Solid paths and conditional mutations only. */
export function createStoragePodWriter(options: StoragePodWriterOptions): PodWriter {
  const { storage, container, webId, signal, typeIndex } = options;
  if (storage.protocol !== "solid")
    throw new TypeError("Connector slugs require a Solid storage backend.");
  const resolve = containerResolver(container, "storage");
  if (!storage.isWithinStorage(container)) throw new TypeError("Container is outside storage.");
  function writeValidator({ etag, etagSource }: WriteResult) {
    // Some backends fall back to HEAD, which may observe another writer's version.
    return options.verifyPrivateDestination && etagSource === "response" && etag !== null
      ? { writeEtag: etag }
      : {};
  }
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
      verifyPrivateDestination: options.verifyPrivateDestination,
      async read(slug) {
        try {
          const { dataset, etag } = await storage.readRdf(resolve(slug), { signal });
          return { dataset, etag };
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
        const result = await writeStorageRdf(storage, url, doc.dataset, conditional, signal);
        return {
          url,
          ...writeValidator(result),
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
          const result =
            etag !== undefined
              ? await storage.write(url, body, {
                  contentType: doc.contentType,
                  ifMatch: etag,
                  signal,
                })
              : await createStorageResource(storage, url, body, doc.contentType, signal);
          return { url, created: true, ...writeValidator(result) };
        } catch (error) {
          if (mode === "create" && error instanceof StorageError && error.status === 412)
            return { url, created: false };
          throw error;
        }
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
