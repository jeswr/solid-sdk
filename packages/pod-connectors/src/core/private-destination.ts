// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope, createPodScopedFetch, normalizePodBase } from "@jeswr/guarded-fetch";
import { checkOwnerOnly } from "@jeswr/pod-access";
import { accessModel } from "@jeswr/pod-access/requests-solid";
import { CapabilitiesError } from "@jeswr/storage-capabilities";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
import { abortableFetch } from "./abort.js";
import { isStrongEtag } from "./pod-writer-policy.js";
import { createWacImportStorage } from "./storage-pod-writer.js";
import type { MutationGuard, PodWriter } from "./types.js";

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
    const head = await storage.head(url, { revalidate: true, signal });
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

  async function ensureContainer(
    storage: StorageClient,
    url: string,
    guard?: MutationGuard,
  ): Promise<boolean> {
    if (!(await exists(storage, url, "container"))) {
      if (url === root) return false;
      const parent = new URL("../", url).href;
      if (!(await ensureContainer(storage, parent, guard))) return false;
      signal?.throwIfAborted();
      const refused = guard?.();
      if (refused) return refused;
      try {
        await storage.create(parent, null, { exactUrl: url, kind: "container" });
      } catch (error) {
        if (!(error instanceof StorageError && error.status === 412)) throw error;
      }
    }
    return privateAccess(storage, url, signal);
  }

  async function verifyPrivateDestination(url: string, guard?: MutationGuard) {
    const storage = await openFor(url);
    if (!storage || !(await ensureContainer(storage, new URL(".", url).href, guard))) return false;
    // A stored document may have its own policy even in an owner-only container.
    const verified =
      !(await exists(storage, url, "resource")) || (await privateAccess(storage, url, signal));
    signal?.throwIfAborted();
    return verified;
  }

  return {
    verifyPrivateDestination: Object.assign((url: string) => verifyPrivateDestination(url), {
      beforeWrite: verifyPrivateDestination,
    }),
    async confirmPrivateWrite(url, { etag }, observeEtag) {
      const storage = await openFor(url, true);
      if (!storage) return false;
      const head = await exactHead(storage, url, "resource");
      if (!isStrongEtag(head.etag)) return false;
      observeEtag?.(head.etag);
      if (etag !== undefined && head.etag !== etag) return false;
      const container = new URL(".", url).href;
      await exactHead(storage, container, "container");
      if (!(await privateAccess(storage, url)) || !(await privateAccess(storage, container)))
        return false;
      return (await exactHead(storage, url, "resource")).etag === head.etag;
    },
  };
}

/** Verify the containing policy and any existing resource policy before writing. */
export function createOwnerOnlyDestinationVerifier(options: DestinationOptions) {
  return createOwnerOnlyDestinationChecks(options).verifyPrivateDestination;
}
