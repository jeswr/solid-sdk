// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch, normalizePodBase } from "@jeswr/guarded-fetch";
import { createOwnerOnlyDestinationChecks } from "@jeswr/pod-access";
import { accessModel } from "@jeswr/pod-access/requests-solid";
import { CapabilitiesError } from "@jeswr/storage-capabilities";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient, type StorageClient } from "@jeswr/storage-client";
import { abortableFetch } from "./abort.js";
import { createWacImportStorage } from "./storage-pod-writer.js";
import type { PodWriter } from "./types.js";

export {
  createOwnerOnlyDestinationChecks,
  createOwnerOnlyDestinationVerifier,
} from "@jeswr/pod-access";

type PrivateDestinationChecks = Required<
  Pick<PodWriter, "verifyPrivateDestination" | "confirmPrivateWrite">
>;

interface SessionOptions {
  readonly fetch: typeof fetch;
  readonly storageUrl: string;
  readonly webId: string;
  readonly signal?: AbortSignal;
}

/** Open owner-only destination checks for an authenticated Pod session. */
export function createSessionPrivateDestinationChecks(
  options: SessionOptions,
): PrivateDestinationChecks {
  const { storageUrl, webId, signal } = options;
  const root = normalizePodBase(storageUrl);
  async function openStorage(signal?: AbortSignal): Promise<StorageClient> {
    const scopedFetch = createPodScopedFetch(root, {
      fetch: signal ? abortableFetch(options.fetch, signal, true) : options.fetch,
    });
    try {
      const { storage } = await createPodClient({
        storage: root,
        fetch: scopedFetch,
        signal,
        capabilities: createMemoryCache(),
      });
      return storage;
    } catch (error) {
      // Legacy Solid roots may expose WAC without a storage-description or Updates-Via link.
      if (!(error instanceof CapabilitiesError && error.code === "no-storage-link")) throw error;
      if ((await accessModel({ fetch: scopedFetch, storage: root, signal })) !== "wac") throw error;
      const storage = createWacImportStorage({ root, fetch: scopedFetch });
      const head = await storage.head(root, { revalidate: true, signal });
      if (
        !(head.links.get("type") ?? []).some(
          ({ target }) => target === "http://www.w3.org/ns/pim/space#Storage",
        )
      )
        throw error;
      return storage;
    }
  }
  return createOwnerOnlyDestinationChecks({
    podRoot: root,
    ownerWebId: webId,
    openStorage,
    ...(signal && { signal }),
  });
}

/** Verify the containing policy and any existing resource policy before writing. */
export function createSessionPrivateDestinationVerifier(options: SessionOptions) {
  return createSessionPrivateDestinationChecks(options).verifyPrivateDestination;
}
