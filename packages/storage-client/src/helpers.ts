// AUTHORED-BY Claude Opus 5.5
/** Helpers for ETag conflict handling (ADR-003 §3) and JSON Patch (RFC 6902). */
import { StorageError } from "./errors.js";

export { applyJsonPatch, JsonPatchError, jsonEqual } from "./json-patch.js";

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
