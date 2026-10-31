// AUTHORED-BY Codex GPT-6.1-Sol
// Shared checks for the optional solid-sd service clients. No backend internals are used.

import type { Features } from "@jeswr/storage-capabilities";
import { StorageError } from "./errors.js";
import { discard, failed, linksOf, scoped, send } from "./http.js";
import { pathParent } from "./internal.js";
import type { AuthFetch, Body, ReadResult, StorageClient, WriteResult } from "./types.js";

export function invalidService(method: string, url: string): StorageError {
  return new StorageError("invalid-response", { method, url, message: "Invalid service response" });
}

export function serviceEndpoint(storage: StorageClient, feature: "trash" | "versioning"): string {
  const value = storage.features[feature];
  if (value.state !== "available" || !value.detail.endpoint) {
    throw new StorageError("unsupported", { method: "GET", url: storage.root, feature });
  }
  return value.detail.endpoint;
}

export function serviceUrl(storage: StorageClient, method: string, url: string): string {
  const result = scoped(storage.root, method, url);
  if (/[?#]/.test(result)) throw new StorageError("bad-request", { method, url: result });
  return result;
}

/** RFC 6570 simple expansion permits only unreserved characters unescaped. */
export function encodeResource(url: string): string {
  return encodeURIComponent(url).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Only the advertised version template may introduce a query on an initial listing. */
export function versionHistoryQuery(features: Features, root: string, url: string): boolean {
  const template = features.versioning.detail.endpoint;
  if (features.versioning.state !== "available" || !template?.includes("?")) return false;
  const parts = template.split("{resource}");
  if (parts.length !== 2 || template.indexOf("{resource}") < template.indexOf("?")) return false;
  try {
    const [prefix, suffix] = scoped(root, "GET", template).split("{resource}") as [string, string];
    const target = scoped(root, "GET", url);
    if (!target.startsWith(prefix) || !target.endsWith(suffix)) return false;
    const encoded = target.slice(prefix.length, target.length - suffix.length);
    const resource = decodeURIComponent(encoded);
    return (
      scoped(root, "GET", resource) === resource &&
      !/[?#]/.test(resource) &&
      encodeResource(resource) === encoded
    );
  } catch {
    return false;
  }
}

/** Service edits never turn a missing, weak or wildcard validator into an unconditional write. */
export function serviceEtag(result: ReadResult): string {
  if (result.etag === null || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(result.etag)) {
    throw invalidService("HEAD", result.url);
  }
  return result.etag;
}

export function isTrashEndpoint(storage: StorageClient, url: string): boolean {
  const feature = storage.features.trash;
  if (feature.state !== "available" || !feature.detail.endpoint) return false;
  try {
    return (
      serviceUrl(storage, "POST", feature.detail.endpoint) === serviceUrl(storage, "POST", url)
    );
  } catch {
    return false;
  }
}

/** A TrashService container accepts command POSTs through the public create operation. */
export function trashCommand(body: Body | null): { resource: string } | { restore: string } {
  if (typeof body !== "string") throw new TypeError("Trash commands must be JSON strings");
  let command: unknown;
  try {
    command = JSON.parse(body);
  } catch {
    throw new TypeError("Invalid trash command");
  }
  if (command && typeof command === "object" && Object.keys(command).length === 1) {
    if ("resource" in command && typeof command.resource === "string")
      return { resource: command.resource };
    if ("restore" in command && typeof command.restore === "string")
      return { restore: command.restore };
  }
  throw new TypeError("Invalid trash command");
}

export async function postTrash(
  storage: StorageClient,
  fetch: AuthFetch,
  url: string,
  body: Body | null,
  signal: AbortSignal | undefined,
  inspect: (method: string, url: string, response: Response) => unknown = (method, url, response) =>
    linksOf(response, url, method),
): Promise<WriteResult> {
  const endpoint = serviceUrl(storage, "POST", url);
  const command = trashCommand(body);
  const source = serviceUrl(
    storage,
    "POST",
    "resource" in command ? command.resource : command.restore,
  );
  if (!endpoint.endsWith("/") || source === storage.root || source === endpoint) {
    throw new StorageError("bad-request", { method: "POST", url: endpoint });
  }
  const response = await send(
    fetch,
    "POST",
    endpoint,
    { "Content-Type": "application/json" },
    signal,
    JSON.stringify(command),
  );
  inspect("POST", endpoint, response);
  if (response.status >= 400) return failed("POST", endpoint, response, signal);
  discard(response.body);
  if (!("resource" in command ? [201] : [200, 201]).includes(response.status)) {
    throw invalidService("POST", endpoint);
  }
  let location: string;
  try {
    const value = response.headers.get("location");
    if (!value?.trim()) throw new TypeError();
    location = serviceUrl(storage, "POST", new URL(value, endpoint).href);
    if (location === source || location === endpoint || location === storage.root)
      throw new TypeError();
    if (
      "resource" in command &&
      storage.protocol === "solid" &&
      pathParent(location, storage.root) !== endpoint
    )
      throw new TypeError();
  } catch {
    // Never retain an untrusted Location, including credentials, in an error/cause.
    throw invalidService("POST", endpoint);
  }
  return { url: location, etag: response.headers.get("etag"), created: response.status === 201 };
}
