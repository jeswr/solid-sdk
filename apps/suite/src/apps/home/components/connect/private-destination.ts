// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch, normalizePodBase } from "@jeswr/guarded-fetch";
import { accessModel } from "@jeswr/pod-access/requests-solid";
import { createOwnerOnlyDestinationVerifier, createWacImportStorage } from "@jeswr/pod-connectors";
import { CapabilitiesError } from "@jeswr/storage-capabilities";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient, type StorageClient } from "@jeswr/storage-client";
import type { PodSession } from "../../../../lib/session/pod-session";

type ImportSession = Pick<PodSession, "fetch" | "storageUrl" | "webId">;

/** Open storage for an authenticated Suite import session. */
export function privateDestinationVerifier(session: ImportSession, signal: AbortSignal) {
  const { storageUrl, webId } = session;
  const root = normalizePodBase(storageUrl);
  const fetch = createPodScopedFetch(root, { fetch: session.fetch });
  async function open(): Promise<StorageClient> {
    try {
      const { storage } = await createPodClient({
        storage: root,
        fetch,
        signal,
        capabilities: createMemoryCache(),
      });
      return storage;
    } catch (error) {
      // Legacy Solid roots may expose WAC without a storage-description or Updates-Via link.
      if (!(error instanceof CapabilitiesError && error.code === "no-storage-link")) throw error;
      if ((await accessModel({ fetch, storage: root, signal })) !== "wac") throw error;
      const storage = createWacImportStorage({ root, fetch });
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
    openStorage: open,
    signal,
  });
}
