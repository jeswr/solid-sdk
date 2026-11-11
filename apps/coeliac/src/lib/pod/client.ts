// AUTHORED-BY Codex GPT-6.1-Sol
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { createPodClient, type StorageClient } from "@jeswr/storage-client";

/** Tests inject a client directly; sessions resolve it lazily to allow offline login. */
export type PodStorage = StorageClient | (() => Promise<StorageClient>);

export async function resolvePodStorage(storage: PodStorage): Promise<StorageClient> {
  return typeof storage === "function" ? storage() : storage;
}

/** One shared client per session. Failed discovery can be retried on reconnect. */
export function createSessionStorage(fetch: typeof globalThis.fetch, root: string): PodStorage {
  const guarded = createPodScopedFetch(root, { fetch });
  let pending: Promise<StorageClient> | undefined;
  return () => {
    pending ??= createPodClient({ fetch: guarded, storage: root })
      .then(({ storage }) => storage)
      .catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    return pending;
  };
}
