// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
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
import {
  cleanupPrivateResource,
  containerResolver,
  strongEtag,
  validateBinaryType,
} from "./pod-writer-policy.js";
import type { PodWriter } from "./types.js";

export interface StoragePodWriterOptions {
  /** Storage transport should take cancellation from operation options. */
  readonly storage: StorageClient;
  /** Absolute connector container, e.g. <storage.root>integrations/spotify/. */
  readonly container: string;
  readonly webId?: string;
  readonly verifyPrivateDestination?: PodWriter["verifyPrivateDestination"];
  readonly confirmPrivateWrite?: PodWriter["confirmPrivateWrite"];
  /** Authenticated transport independent of the run signal for refused creates. */
  readonly cleanupFetch?: typeof fetch;
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
  const privateWrites = !!(options.verifyPrivateDestination || options.confirmPrivateWrite);
  const mutationSignal = privateWrites ? undefined : signal;
  if (storage.protocol !== "solid")
    throw new TypeError("Connector slugs require a Solid storage backend.");
  const resolve = containerResolver(container, "storage");
  if (!storage.isWithinStorage(container)) throw new TypeError("Container is outside storage.");
  const cleanupFetch =
    options.cleanupFetch &&
    createPodScopedFetch(container, { fetch: options.cleanupFetch, allowRoot: false });
  function writeValidator({ etag, etagSource }: WriteResult) {
    // Some backends fall back to HEAD, which may observe another writer's version.
    return privateWrites && etagSource === "response" && etag !== null ? { writeEtag: etag } : {};
  }
  async function acceptWrite(url: string, pending: Promise<WriteResult>): Promise<WriteResult> {
    try {
      return await pending;
    } catch (error) {
      // Solid rejects unfamiliar 2xx responses. Confirm the destination without a create receipt.
      if (
        privateWrites &&
        error instanceof StorageError &&
        error.code === "invalid-response" &&
        error.method === "PUT" &&
        error.url === url &&
        error.status !== null &&
        error.status >= 200 &&
        error.status < 300
      )
        return { url, etag: null, created: false };
      throw error;
    }
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
      confirmPrivateWrite: options.confirmPrivateWrite,
      ...(cleanupFetch && {
        cleanupPrivateWrite: (slug, cleanup) =>
          cleanupPrivateResource(cleanupFetch, resolve(slug), cleanup),
      }),
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
      async write(doc, conditions = {}, guard) {
        const url = resolve(doc.slug);
        if (conditions.ifMatch !== undefined && conditions.ifNoneMatch !== undefined)
          throw new TypeError("Supply only one write precondition.");
        let conditional = conditions;
        if (conditions.ifMatch === undefined && conditions.ifNoneMatch === undefined) {
          const etag = await currentEtag(url);
          conditional = etag === undefined ? { ifNoneMatch: "*" } : { ifMatch: etag };
        }
        const result = await acceptWrite(
          url,
          writeStorageRdf(
            storage,
            url,
            doc.dataset,
            conditional,
            signal,
            undefined,
            privateWrites,
            guard,
          ),
        );
        return {
          url,
          ...(privateWrites && { writeCreated: conditional.ifNoneMatch === "*" && result.created }),
          ...writeValidator(result),
          category: doc.category,
          forClass: doc.forClass,
          skipRegistration: doc.skipRegistration,
        };
      },
      async writeBinary(doc, guard) {
        const url = resolve(doc.slug);
        validateBinaryType(doc.contentType, "storage");
        const body = new Blob([doc.body as Uint8Array<ArrayBuffer>], { type: doc.contentType });
        const mode = doc.mode ?? "create";
        if (mode !== "create" && mode !== "replace") throw new TypeError("Invalid binary mode.");
        const etag = mode === "replace" ? await currentEtag(url) : undefined;
        signal?.throwIfAborted();
        const refused = guard?.();
        if (refused) return refused;
        try {
          const result = await acceptWrite(
            url,
            etag !== undefined
              ? storage.write(url, body, {
                  contentType: doc.contentType,
                  ifMatch: etag,
                  signal: mutationSignal,
                })
              : createStorageResource(storage, url, body, doc.contentType, mutationSignal),
          );
          return {
            url,
            created: true,
            ...(privateWrites && { writeCreated: etag === undefined && result.created }),
            ...writeValidator(result),
          };
        } catch (error) {
          if (mode === "create" && error instanceof StorageError && error.status === 412)
            return { url, created: false };
          throw error;
        }
      },
      async remove(slug, conditions = {}, guard) {
        const url = resolve(slug);
        const etag =
          conditions.ifMatch === undefined
            ? await currentEtag(url)
            : strongEtag(conditions.ifMatch, "storage", url);
        if (etag === undefined) return;
        signal?.throwIfAborted();
        const refused = guard?.();
        if (refused) return refused;
        try {
          await storage.delete(url, { ifMatch: etag, signal: mutationSignal });
        } catch (error) {
          if (!missingResource(error)) throw error;
        }
      },
      async registerType(registrations, guard) {
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
          finishMutations: privateWrites,
          guard,
        });
      },
    },
    signal,
  );
}
