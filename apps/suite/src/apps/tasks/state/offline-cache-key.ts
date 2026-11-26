// AUTHORED-BY Claude Fable 5.2
/** The Tasks read cache's localStorage keys, kept apart from the store so the shell can purge them. */
export const CACHE_PREFIX = "suite.tasks.cache.v1.";
export const cacheKey = (webId: string, storageUrl: string) =>
  `${CACHE_PREFIX}${webId}\u0000${storageUrl}`;

/** Remove every cached Tasks document of one account, whichever of its storages it was read from. */
export function clearTasksCachesFor(
  webId: string,
  storage?: Pick<Storage, "key" | "length" | "removeItem">,
): void {
  try {
    const target = storage ?? globalThis.localStorage;
    const prefix = `${CACHE_PREFIX}${webId}\u0000`;
    const keys: string[] = [];
    for (let index = 0; index < target.length; index++) {
      const key = target.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) target.removeItem(key);
  } catch {
    /* Storage may be blocked or unavailable. */
  }
}
