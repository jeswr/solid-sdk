// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type AccessGrant, createAccessClient } from "@jeswr/pod-access";
import {
  type Body,
  type CreateOptions,
  createPodClient,
  type Entry,
  type StorageClient,
  StorageError,
} from "@jeswr/storage-client";

/** Authenticated transport or an already discovered client (also the memory-test seam). */
export interface ListOptions {
  fetch?: typeof fetch;
  storage?: StorageClient;
  signal?: AbortSignal;
}

/** Plain listing data consumed by the existing browser view. */
export interface DriveEntry {
  url: string;
  name: string;
  isContainer: boolean;
  contentType: string | undefined;
  size: number | undefined;
  modifiedAt: Date | undefined;
}

export interface ContainerListing {
  container: { url: string; entries: DriveEntry[] };
  etag: string | null;
  url: string;
}

/** Retain the UI's login/permission distinction over SDK errors. */
export class DriveAccessError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly url: string,
    cause: unknown,
  ) {
    super(
      status === 401 ? `Authentication required to read ${url}` : `Forbidden: no access to ${url}`,
      { cause },
    );
    this.name = "DriveAccessError";
  }
}

function displayEntry(entry: Entry): DriveEntry {
  const parsed = new URL(entry.url);
  const last = parsed.pathname.split("/").filter(Boolean).at(-1);
  let name = last ?? parsed.hostname;
  try {
    name = decodeURIComponent(name);
  } catch {
    /* Keep a valid URL's non-UTF-8 spelling. */
  }
  return {
    url: entry.url,
    name,
    isContainer: entry.kind === "container",
    contentType: entry.contentType ?? undefined,
    size: entry.size ?? undefined,
    modifiedAt: entry.modified ?? undefined,
  };
}

/** Keep target status and discover Solid before recovering a container redirect. */
async function discoverStorage(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<StorageClient> {
  let accessFailure: { status: 401 | 403; url: string } | undefined;
  let targetNotFound = false;
  let slashRedirect = false;
  const transport: typeof fetch = async (input, init) => {
    const response = await fetchImpl(input, init);
    if (response.status === 401 || response.status === 403) {
      accessFailure = { status: response.status, url: String(input) };
    }
    if (String(input) === url && init?.method === "HEAD" && response.status === 404) {
      targetNotFound = true;
    }
    if (
      String(input) === url &&
      init?.method === "HEAD" &&
      !url.endsWith("/") &&
      (response.type === "opaqueredirect" || [301, 302, 303, 307, 308].includes(response.status))
    ) {
      if (response.type === "opaqueredirect") {
        slashRedirect = true;
      } else {
        const location = response.headers.get("location");
        if (location) {
          try {
            slashRedirect = new URL(location, url).href === `${url}/`;
          } catch {
            // Malformed and unrelated redirects keep the SDK's refusal.
          }
        }
      }
    }
    return response;
  };
  try {
    return (
      await createPodClient({
        storage: url,
        fetch: transport,
        ...(signal ? { signal } : {}),
      })
    ).storage;
  } catch (error) {
    if (accessFailure) throw new DriveAccessError(accessFailure.status, accessFailure.url, error);
    if (targetNotFound)
      throw new StorageError("not-found", { status: 404, url, method: "HEAD", cause: error });
    if (slashRedirect) {
      // Browsers hide Location. Discover through the parent instead of following the
      // redirect or guessing that a slashless identifier belongs to Solid.
      const storage = await discoverStorage(new URL("./", url).href, fetchImpl, signal);
      if (storage.protocol === "solid") return storage;
    }
    throw error;
  }
}

/** List through the SDK, including every LWS page, preserving opaque container URLs. */
export async function listContainer(
  containerUrl: string,
  options: ListOptions = {},
): Promise<ContainerListing> {
  let url = containerUrl;
  try {
    const storage =
      options.storage ??
      (await discoverStorage(containerUrl, options.fetch ?? globalThis.fetch, options.signal));
    if (storage.protocol === "solid" && !url.endsWith("/")) url += "/";
    // HEAD supplies a validator; traversal and pagination belong entirely to the SDK.
    const head = await storage.head(url, {
      ...(options.signal ? { signal: options.signal } : {}),
      revalidate: true,
    });
    const entries: DriveEntry[] = [];
    for await (const entry of storage.listAll(url, {
      ...(options.signal ? { signal: options.signal } : {}),
      revalidate: true,
    })) {
      entries.push(displayEntry(entry));
    }
    entries.sort(
      (a, b) => Number(b.isContainer) - Number(a.isContainer) || a.name.localeCompare(b.name),
    );
    return { container: { url, entries }, etag: head.etag, url };
  } catch (error) {
    if (error instanceof StorageError && (error.status === 401 || error.status === 403)) {
      throw new DriveAccessError(error.status, url, error);
    }
    throw error;
  }
}

/** Protocol-neutral file operations. Keep returned URLs and observed validators verbatim. */
export function createDriveStore(options: {
  root: string;
  fetch?: typeof fetch;
  storage?: StorageClient;
}) {
  let pending: Promise<StorageClient> | undefined;
  const client = () =>
    (pending ??= options.storage
      ? Promise.resolve(options.storage)
      : discoverStorage(options.root, options.fetch ?? globalThis.fetch).catch((error: unknown) => {
          pending = undefined;
          throw error;
        }));
  return {
    async list(url = options.root) {
      return listContainer(url, { storage: await client() });
    },
    async read(url: string) {
      return (await client()).read(url);
    },
    async write(url: string, body: Body, contentType: string, etag: string) {
      return (await client()).write(url, body, { contentType, ifMatch: etag });
    },
    async create(container: string, body: Body | null, opts: CreateOptions) {
      return (await client()).create(container, body, opts);
    },
    async remove(url: string, etag: string, recursive = false) {
      return (await client()).delete(url, { ifMatch: etag, recursive });
    },
    async move(url: string, destination: string, etag: string, name?: string) {
      return (await client()).move(url, destination, {
        ifMatch: etag,
        ...(name === undefined ? {} : { name }),
      });
    },
    async share(url: string, grant: AccessGrant, opts: { inherit?: boolean } = {}) {
      return createAccessClient({ storage: await client() }).share(url, grant, opts);
    },
  };
}
