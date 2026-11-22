// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope, normalizePodBase } from "@jeswr/guarded-fetch";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { checkOwnerOnly } from "./owner-only.js";

/** Verify the containing policy and any existing resource policy before writing. */
export function createOwnerOnlyDestinationVerifier(options: {
  readonly podRoot: string;
  readonly ownerWebId: string;
  /** Use a client whose transport observes the run signal, including during policy reads. */
  readonly openStorage: () => StorageClient | Promise<StorageClient>;
  readonly signal?: AbortSignal;
}): (url: string) => Promise<boolean> {
  const { ownerWebId, openStorage, signal } = options;
  const root = normalizePodBase(options.podRoot);
  const requestOptions = signal === undefined ? {} : { signal };
  let opened: StorageClient | Promise<StorageClient> | undefined;

  async function exists(storage: StorageClient, url: string, kind: "container" | "resource") {
    signal?.throwIfAborted();
    try {
      const head = await storage.head(url, { revalidate: true, ...requestOptions });
      if (head.status !== 200 || head.url !== url || head.kind !== kind)
        throw new Error("Unexpected destination metadata.");
      return true;
    } catch (error) {
      if (error instanceof StorageError && error.status === 404) return false;
      throw error;
    }
  }

  async function privateAccess(storage: StorageClient, url: string) {
    signal?.throwIfAborted();
    return (await checkOwnerOnly({ storage, url, ownerWebId })).private;
  }

  async function ensureContainer(storage: StorageClient, url: string): Promise<boolean> {
    if (!(await exists(storage, url, "container"))) {
      if (url === root) return false;
      const parent = new URL("../", url).href;
      if (!(await ensureContainer(storage, parent))) return false;
      signal?.throwIfAborted();
      try {
        await storage.create(parent, null, { exactUrl: url, kind: "container", ...requestOptions });
      } catch (error) {
        if (!(error instanceof StorageError && error.status === 412)) throw error;
      }
    }
    return privateAccess(storage, url);
  }

  return async (url) => {
    assertWithinPodScope(root, url, { allowRoot: false });
    signal?.throwIfAborted();
    opened ??= openStorage();
    const storage = await opened;
    if (storage.protocol !== "solid" || storage.root !== root) return false;
    if (!(await ensureContainer(storage, new URL(".", url).href))) return false;
    // A stored document may have its own policy even in an owner-only container.
    const verified =
      !(await exists(storage, url, "resource")) || (await privateAccess(storage, url));
    signal?.throwIfAborted();
    return verified;
  };
}
