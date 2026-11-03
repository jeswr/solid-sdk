// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
/** Compatibility RDF helpers over the public storage client. */
import {
  createPodClient,
  type RdfReadResult,
  type StorageClient,
  StorageError,
} from "@jeswr/storage-client";
import type { DatasetCore } from "@rdfjs/types";
import { Writer } from "n3";

export const REVALIDATE_HEADERS = { "cache-control": "no-cache" } as const;

/** Resolve through the SDK; callers with a client reuse its discovery and scope. */
export async function storageFor(
  url: string,
  fetchImpl = globalThis.fetch,
  storage?: StorageClient,
  onStorageId?: (id: string) => void,
): Promise<StorageClient> {
  if (storage) return storage;
  let accessFailure: { status: 401 | 403; url: string; method: string } | undefined;
  // Transport cache policy only; discovery, protocol requests and parsing stay in the SDK.
  const revalidatingFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("cache-control", "no-cache");
    const response = await fetchImpl(input, { ...init, headers, cache: "no-cache" });
    if (response.status === 401 || response.status === 403) {
      accessFailure = {
        status: response.status,
        url: String(input),
        method: init?.method ?? "GET",
      };
    }
    return response;
  };
  const target = new URL(url);
  target.hash = "";
  try {
    const client = await createPodClient({ storage: target.href, fetch: revalidatingFetch });
    onStorageId?.(client.description.id);
    return client.storage;
  } catch (error) {
    if (accessFailure) {
      throw new StorageError(accessFailure.status === 401 ? "unauthenticated" : "forbidden", {
        ...accessFailure,
        cause: error,
      });
    }
    throw error;
  }
}

/** Revalidate RDF using the authenticated SDK transport. Strip WebID fragments for HTTP. */
export async function readRdf(
  url: string,
  fetchImpl?: typeof fetch,
  storage?: StorageClient,
): Promise<RdfReadResult> {
  const target = new URL(url);
  target.hash = "";
  return (await storageFor(url, fetchImpl, storage)).readRdf(target.href);
}

/** n3.Writer preserves explicit relative fragments and absolute external references. */
export function serializeTurtle(
  dataset: DatasetCore,
  prefixes?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "text/turtle", prefixes });
    for (const quad of dataset) writer.addQuad(quad);
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });
}

export interface WriteOptions {
  etag?: string | null;
  createOnly?: boolean;
  fetchImpl?: typeof fetch;
  storage?: StorageClient;
  prefixes?: Record<string, string>;
}

/** Refuse edits without the validator from the caller's read. Never silently overwrite. */
export function requireEtag(etag: string | null | undefined, url: string): string {
  if (!etag || etag === "*")
    throw new StorageError("precondition-required", { url, method: "PUT", status: 428 });
  return etag;
}

/** Exact-name creation is retained only for Solid Type Index bootstrap. */
export async function writeRdf(
  url: string,
  dataset: DatasetCore,
  opts: WriteOptions = {},
): Promise<{ etag: string | null }> {
  const storage = await storageFor(url, opts.fetchImpl, opts.storage);
  if (opts.createOnly) {
    if (storage.protocol !== "solid")
      throw new StorageError("unsupported", { url, method: "POST" });
    const parent = new URL(".", url).href;
    const name = decodeURIComponent(new URL(url).pathname.split("/").at(-1) as string);
    return storage.create(parent, await serializeTurtle(dataset, opts.prefixes), {
      name,
      contentType: "text/turtle",
    });
  }
  return storage.writeRdf(url, dataset, {
    ifMatch: requireEtag(opts.etag, url),
    prefixes: opts.prefixes,
  });
}

/** Idempotent removal; observe a validator when the caller has no prior read. */
export async function deleteRdf(
  url: string,
  fetchImpl?: typeof fetch,
  storage?: StorageClient,
  etag?: string | null,
): Promise<void> {
  const client = await storageFor(url, fetchImpl, storage);
  try {
    const validator = etag ?? (await client.head(url, { revalidate: true })).etag;
    await client.delete(url, { ifMatch: requireEtag(validator, url) });
  } catch (error) {
    if (error instanceof StorageError && error.code === "not-found") return;
    throw error;
  }
}

/** Derive a friendly name from a resource URL (last non-empty path segment). */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const last = segments.at(-1);
    return last ? decodeURIComponent(last) : u.hostname;
  } catch {
    return url;
  }
}
