// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Fable 5.2
import { assertWithinPodScope, normalizePodBase } from "@jeswr/guarded-fetch";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { checkOwnerOnly } from "./owner-only.js";

/** Owner-only checks for a prospective Solid document and the version subsequently stored. */
interface PrivateDestinationChecks {
  verifyPrivateDestination(url: string): Promise<boolean>;
  confirmPrivateWrite(
    url: string,
    version: { readonly etag?: string },
    observeEtag?: (etag: string) => void,
  ): Promise<boolean>;
}

interface DestinationOptions {
  readonly podRoot: string;
  readonly ownerWebId: string;
  /** Use the supplied signal for pre-write reads. Confirmation opens without the run signal. */
  readonly openStorage: (signal?: AbortSignal) => StorageClient | Promise<StorageClient>;
  readonly signal?: AbortSignal;
}

/** Open scoped storage lazily for pre-write verification and independent confirmation. */
export function createOwnerOnlyDestinationChecks(
  options: DestinationOptions,
): PrivateDestinationChecks {
  const { ownerWebId, openStorage, signal } = options;
  const root = normalizePodBase(options.podRoot);
  let opened: StorageClient | Promise<StorageClient> | undefined;
  let confirmation: StorageClient | Promise<StorageClient> | undefined;

  async function openFor(url: string, forConfirmation = false) {
    assertWithinPodScope(root, url, { allowRoot: false });
    if (!forConfirmation) signal?.throwIfAborted();
    let pending: StorageClient | Promise<StorageClient>;
    if (forConfirmation && signal) {
      confirmation ??= openStorage();
      pending = confirmation;
    } else {
      opened ??= openStorage(signal);
      pending = opened;
    }
    const storage = await pending;
    if (storage.protocol === "solid" && storage.root === root) return storage;
  }

  async function exactHead(
    storage: StorageClient,
    url: string,
    kind: "container" | "resource",
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const head = await storage.head(url, { revalidate: true, ...(signal && { signal }) });
    if (head.status !== 200 || head.url !== url || head.kind !== kind)
      throw new Error("Unexpected destination metadata.");
    return head;
  }

  async function exists(storage: StorageClient, url: string, kind: "container" | "resource") {
    try {
      await exactHead(storage, url, kind, signal);
      return true;
    } catch (error) {
      if (error instanceof StorageError && error.status === 404) return false;
      throw error;
    }
  }

  async function privateAccess(storage: StorageClient, url: string, signal?: AbortSignal) {
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
        await storage.create(parent, null, {
          exactUrl: url,
          kind: "container",
          ...(signal && { signal }),
        });
      } catch (error) {
        if (!(error instanceof StorageError && error.status === 412)) throw error;
      }
    }
    return privateAccess(storage, url, signal);
  }

  return {
    async verifyPrivateDestination(url) {
      const storage = await openFor(url);
      if (!storage || !(await ensureContainer(storage, new URL(".", url).href))) return false;
      // A stored document may have its own policy even in an owner-only container.
      const verified =
        !(await exists(storage, url, "resource")) || (await privateAccess(storage, url, signal));
      signal?.throwIfAborted();
      return verified;
    },
    async confirmPrivateWrite(url, { etag }, observeEtag) {
      const storage = await openFor(url, true);
      if (!storage) return false;
      const head = await exactHead(storage, url, "resource");
      if (head.etag === null || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(head.etag)) return false;
      observeEtag?.(head.etag);
      if (etag !== undefined && head.etag !== etag) return false;
      const container = new URL(".", url).href;
      await exactHead(storage, container, "container");
      // Bind the policy discovery HEAD to the written version as well as the final HEAD.
      let sameVersion = true;
      const versionedStorage: StorageClient = {
        ...storage,
        protocol: storage.protocol,
        root: storage.root,
        features: storage.features,
        read: storage.read.bind(storage),
        isWithinStorage: storage.isWithinStorage.bind(storage),
        async head(target, options) {
          const metadata = await storage.head(target, options);
          if (target === url && (metadata.kind !== "resource" || metadata.etag !== head.etag))
            sameVersion = false;
          return metadata;
        },
      };
      if (
        !(await privateAccess(versionedStorage, url)) ||
        !(await privateAccess(storage, container))
      )
        return false;
      const last = await exactHead(storage, url, "resource");
      return sameVersion && last.etag === head.etag;
    },
  };
}

/** Verify the containing policy and any existing resource policy before writing. */
export function createOwnerOnlyDestinationVerifier(options: {
  readonly podRoot: string;
  readonly ownerWebId: string;
  /** Use a client whose transport observes the run signal, including during policy reads. */
  readonly openStorage: () => StorageClient | Promise<StorageClient>;
  readonly signal?: AbortSignal;
}): (url: string) => Promise<boolean> {
  return createOwnerOnlyDestinationChecks({
    ...options,
    openStorage: () => options.openStorage(),
  }).verifyPrivateDestination;
}
