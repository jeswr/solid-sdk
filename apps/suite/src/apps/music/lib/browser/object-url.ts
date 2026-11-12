// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
/** Caller owns revocation, including results that arrive after cancellation. */
export async function podObjectUrl(
  fetch: typeof globalThis.fetch,
  storage: string,
  url: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await createPodScopedFetch(storage, { fetch })(url, { signal });
  if (!response.ok) throw new Error("File unavailable");
  return URL.createObjectURL(await response.blob());
}

interface SharedObjectUrl {
  users: number;
  controller: AbortController;
  promise: Promise<string>;
  url?: string;
}
// Authenticated fetch identity keeps cached bytes isolated between sessions.
const covers = new WeakMap<typeof globalThis.fetch, Map<string, SharedObjectUrl>>();
export function acquireCoverUrl(fetch: typeof globalThis.fetch, storage: string, url: string) {
  let cache = covers.get(fetch);
  if (!cache) {
    cache = new Map();
    covers.set(fetch, cache);
  }
  const key = `${storage}\n${url}`;
  let entry = cache.get(key);
  if (!entry) {
    const controller = new AbortController();
    const created: SharedObjectUrl = {
      users: 0,
      controller,
      promise: podObjectUrl(fetch, storage, url, controller.signal).then((objectUrl) => {
        if (!created.users) URL.revokeObjectURL(objectUrl);
        else created.url = objectUrl;
        return objectUrl;
      }),
    };
    entry = created;
    cache.set(key, entry);
  }
  entry.users++;
  let released = false;
  return {
    promise: entry.promise,
    release() {
      if (released) return;
      released = true;
      if (--entry.users) return;
      cache.delete(key);
      entry.controller.abort();
      if (entry.url) URL.revokeObjectURL(entry.url);
    },
  };
}
