// AUTHORED-BY Claude Opus 5.5
import { StorageError } from "@jeswr/storage-client";

/** fetch's own messages, whole: Drive's own TypeErrors may mention "fetch" or "network". */
const FETCH_FAILURE =
  /^(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|fetch failed|network error)$/i;

/**
 * Whether a failure means the request never got an HTTP answer. Drive wraps the first failed
 * request of a write (its access discovery) in its own error, so this walks the cause chain.
 * Only fetch's own TypeError counts (Chrome "Failed to fetch", Firefox "NetworkError when
 * attempting to fetch resource", Safari "Load failed"): Drive also throws TypeErrors for invalid
 * data, and queueing those would retry them forever.
 */
export function isNetworkFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current = error; current && !seen.has(current); ) {
    seen.add(current);
    if (current instanceof TypeError && FETCH_FAILURE.test(current.message)) return true;
    if (current instanceof StorageError && current.code === "network") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
