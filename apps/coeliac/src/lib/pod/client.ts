// AUTHORED-BY Codex GPT-6.1-Sol
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { createPodClient, type StorageClient } from "@jeswr/storage-client";

/** Tests inject a client directly; sessions resolve it lazily to allow offline login. */
export type PodStorage = StorageClient | (() => Promise<StorageClient>);

export async function resolvePodStorage(storage: PodStorage): Promise<StorageClient> {
  return typeof storage === "function" ? storage() : storage;
}

/** The diary's fixed URLs and WAC ACLs require a Solid backend. */
export class UnsupportedStorageError extends Error {
  readonly code = "unsupported-storage";

  constructor() {
    super("This diary requires Solid storage with fixed URLs and owner-only WAC ACLs. LWS storage is not supported.");
    this.name = "UnsupportedStorageError";
  }
}

/** One shared client per session. Failed discovery can be retried on reconnect. */
export function createSessionStorage(fetch: typeof globalThis.fetch, root: string): PodStorage {
  const guarded = createPodScopedFetch(root, { fetch });
  let pending: Promise<StorageClient> | undefined;
  return () => {
    pending ??= createPodClient({ fetch: guarded, storage: root })
      .then(({ storage }) => {
        if (storage.protocol !== "solid") throw new UnsupportedStorageError();
        return storage;
      })
      .catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    return pending;
  };
}
