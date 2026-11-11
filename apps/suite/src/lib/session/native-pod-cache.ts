// AUTHORED-BY Codex GPT-6
import { createPageCache, type PageCache, purgeForWebId } from "@jeswr/suite-sdk/offline";

const caches = new Map<string, Set<PageCache>>();
const purges = new Map<string, Promise<void>>();
const failedPurges = new Set<string>();

/** Start only after commit; importing this module never touches native platform APIs. */
export function openNativePodCache(options: Parameters<typeof createPageCache>[0]) {
  const created = createPageCache(options);
  const ready = purges.get(options.webId) ?? Promise.resolve();
  const checkCleanup = () => {
    if (failedPurges.has(options.webId)) throw new Error("Saved pod data could not be cleared");
  };
  const cache: PageCache = {
    ...created,
    fetch: async (input, init) => {
      await ready;
      checkCleanup();
      return created.fetch(input, init);
    },
    start: async () => {
      await ready;
      checkCleanup();
      return created.start();
    },
  };
  const accountCaches = caches.get(options.webId) ?? new Set<PageCache>();
  accountCaches.add(cache);
  caches.set(options.webId, accountCaches);
  return {
    cache,
    close() {
      cache.close();
      accountCaches.delete(cache);
      if (!accountCaches.size && caches.get(options.webId) === accountCaches)
        caches.delete(options.webId);
    },
  };
}

/** Existing account transitions call this before awaiting backend logout. */
export async function purgeNativePodCache(webId: string): Promise<void> {
  if (process.env.NEXT_PUBLIC_SUITE_TARGET !== "native") return;
  const pending = purges.get(webId);
  if (pending) return pending;
  const active = [...(caches.get(webId) ?? [])];
  caches.delete(webId);
  const work = (async () => {
    try {
      const results = await Promise.all(active.map((cache) => cache.logout()));
      if (!active.length) results.push(await purgeForWebId(webId));
      if (results.some((result) => result.dbBlocked || result.errors.length))
        throw new Error(
          "Saved pod data could not be cleared. Close other suite windows and retry.",
        );
      failedPurges.delete(webId);
    } catch (error) {
      failedPurges.add(webId);
      throw error;
    } finally {
      purges.delete(webId);
    }
  })();
  purges.set(webId, work);
  return work;
}
