// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch, normalizePodBase } from "@jeswr/guarded-fetch";
import { createOwnerOnlyDestinationVerifier } from "@jeswr/pod-access";
import { accessModel } from "@jeswr/pod-access/requests-solid";
import { CapabilitiesError } from "@jeswr/storage-capabilities";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient, type StorageClient } from "@jeswr/storage-client";
import { abortableFetch } from "./abort.js";
import { createWacImportStorage } from "./storage-pod-writer.js";

export { createOwnerOnlyDestinationVerifier };

/** Open owner-only destination verification for an authenticated Pod session. */
export function createSessionPrivateDestinationVerifier(options: {
  readonly fetch: typeof fetch;
  readonly storageUrl: string;
  readonly webId: string;
  readonly signal?: AbortSignal;
}): (url: string) => Promise<boolean> {
  const { storageUrl, webId, signal } = options;
  const root = normalizePodBase(storageUrl);
  const scopedFetch = createPodScopedFetch(root, {
    fetch: signal ? abortableFetch(options.fetch, signal) : options.fetch,
  });
  async function openStorage(): Promise<StorageClient> {
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
  return createOwnerOnlyDestinationVerifier({
    podRoot: root,
    ownerWebId: webId,
    openStorage,
    ...(signal && { signal }),
  });
}
