// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope, createPodScopedFetch, normalizePodBase } from "@jeswr/guarded-fetch";
import { checkOwnerOnly } from "@jeswr/pod-access";
import { accessModel } from "@jeswr/pod-access/requests-solid";
import { CapabilitiesError } from "@jeswr/storage-capabilities";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
import { abortableFetch } from "./abort.js";
import { createWacImportStorage } from "./storage-pod-writer.js";
import type { PodWriter } from "./types.js";

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

interface DestinationOptions {
  readonly podRoot: string;
  readonly ownerWebId: string;
  /** Use a client whose transport observes the run signal, including during policy reads. */
  readonly openStorage: () => StorageClient | Promise<StorageClient>;
  readonly signal?: AbortSignal;
}

/** Share a scoped storage client between the distinct pre-write and post-write checks. */
export function createOwnerOnlyDestinationChecks(
  options: DestinationOptions,
): PrivateDestinationChecks {
  const { ownerWebId, openStorage, signal } = options;
  const root = normalizePodBase(options.podRoot);
  let opened: StorageClient | Promise<StorageClient> | undefined;

  async function openFor(url: string) {
    assertWithinPodScope(root, url, { allowRoot: false });
    signal?.throwIfAborted();
    opened ??= openStorage();
    const storage = await opened;
    if (storage.protocol === "solid" && storage.root === root) return storage;
  }

  async function exactHead(storage: StorageClient, url: string, kind: "container" | "resource") {
    signal?.throwIfAborted();
    const head = await storage.head(url, { revalidate: true, signal });
    if (head.status !== 200 || head.url !== url || head.kind !== kind)
      throw new Error("Unexpected destination metadata.");
    return head;
  }

  async function exists(storage: StorageClient, url: string, kind: "container" | "resource") {
    try {
      await exactHead(storage, url, kind);
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
        await storage.create(parent, null, { exactUrl: url, kind: "container", signal });
      } catch (error) {
        if (!(error instanceof StorageError && error.status === 412)) throw error;
      }
    }
    return privateAccess(storage, url);
  }

  return {
    async verifyPrivateDestination(url) {
      const storage = await openFor(url);
      if (!storage || !(await ensureContainer(storage, new URL(".", url).href))) return false;
      // A stored document may have its own policy even in an owner-only container.
      const verified =
        !(await exists(storage, url, "resource")) || (await privateAccess(storage, url));
      signal?.throwIfAborted();
      return verified;
    },
    async confirmPrivateWrite(url, { etag }) {
      const storage = await openFor(url);
      if (!storage) return false;
      const head = await exactHead(storage, url, "resource");
      if (etag !== undefined && head.etag !== etag) return false;
      const container = new URL(".", url).href;
      await exactHead(storage, container, "container");
      const confirmed =
        (await privateAccess(storage, url)) && (await privateAccess(storage, container));
      signal?.throwIfAborted();
      return confirmed;
    },
  };
}

/** Verify the containing policy and any existing resource policy before writing. */
export function createOwnerOnlyDestinationVerifier(options: DestinationOptions) {
  return createOwnerOnlyDestinationChecks(options).verifyPrivateDestination;
}
