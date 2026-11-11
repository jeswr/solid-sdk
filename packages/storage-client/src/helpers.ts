// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/** Helpers for exact creation, ETag conflicts (ADR-003 §3) and JSON Patch (RFC 6902). */
import { StorageError } from "./errors.js";
import { scoped } from "./http.js";
import type { Body, CreateOptions, Entry, StorageClient, WriteResult } from "./types.js";

export { applyJsonPatch, JsonPatchError, jsonEqual } from "./json-patch.js";

/**
 * Create at a fixed Solid URL with If-None-Match: *. Refuse LWS (`unsupported`) and URLs
 * that cannot round-trip through the backend's encoded child name (`bad-request`) before
 * calling create. Options are forwarded; the URL supplies the name. HTTP Solid taken names
 * propagate as `StorageError('conflict')` with status 412; ordinary HTTP 409 errors stay distinct.
 */
export async function createAt(
  client: StorageClient,
  url: string,
  body: Body | null,
  options: Omit<CreateOptions, "name"> = {},
): Promise<WriteResult> {
  const target = scoped(client.root, "PUT", url);
  if (client.protocol !== "solid") {
    throw new StorageError("unsupported", {
      method: "PUT",
      url: target,
      message: "Exact-URL creation requires Solid storage",
    });
  }
  const invalid = () =>
    new StorageError("bad-request", {
      method: "PUT",
      url: target,
      message: "URL cannot be created exactly through a Solid encoded child name",
    });
  if (target !== url || /[?#]/.test(target)) throw invalid();
  const kind = options.kind ?? "resource";
  if (kind !== "resource" && kind !== "container") throw new TypeError("Invalid kind");
  const parent = new URL(target);
  const path = parent.pathname.replace(/\/$/, "");
  const slash = path.lastIndexOf("/");
  let name: string;
  try {
    name = decodeURIComponent(path.slice(slash + 1));
  } catch {
    throw invalid();
  }
  parent.pathname = path.slice(0, slash + 1);
  const expected = `${parent.href}${encodeURIComponent(name)}${kind === "container" ? "/" : ""}`;
  if (!name || expected !== url) throw invalid();
  return client.create(parent.href, body, { ...options, name });
}

/**
 * Run `fn` with the current ETag, re-reading and retrying when it fails with
 * `precondition-failed` (someone else wrote first). `read()` is called again before every retry,
 * so read-modify-write callers see the competing change, not only its ETag. Other errors propagate.
 * @param attempts Total attempts including the first (default 3, at least 1).
 */
export async function retryOnConflict<T>(
  fn: (etag: string | null) => Promise<T>,
  read: () => Promise<{ etag: string | null }>,
  attempts = 3,
): Promise<T> {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new RangeError("attempts must be a positive integer");
  }
  let etag = (await read()).etag;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(etag);
    } catch (error) {
      if (
        attempt >= attempts ||
        !(error instanceof StorageError) ||
        error.code !== "precondition-failed"
      ) {
        throw error;
      }
      etag = (await read()).etag;
    }
  }
}

/** Prefer the advisory title, otherwise decode the final path segment without throwing on bad escapes. */
export function displayNameOf(entry: Entry): string {
  if (entry.displayName != null) return entry.displayName;
  const segment = new URL(entry.url).pathname.replace(/\/$/, "").split("/").pop() as string;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
