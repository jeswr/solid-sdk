// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Databases that hold the only copy of their data, not a saved copy of storage. App-local
 * notifications (read and dismissed state, device-only events) live here.
 */
const KEPT_DATABASES = ["suite-notifications-"];

/** Delete only disposable suite copies. Account sessions and the demo's original data stay intact. */
export async function clearSavedCopies({
  cacheStorage,
  databaseFactory,
  blockedTimeoutMs = 5000,
}: {
  cacheStorage?: Pick<CacheStorage, "keys" | "delete">;
  databaseFactory?: Pick<IDBFactory, "databases" | "deleteDatabase">;
  /** "blocked" only means another connection must close first; give it this long. */
  blockedTimeoutMs?: number;
}): Promise<void> {
  if (cacheStorage) {
    const names = await cacheStorage.keys();
    await Promise.all(
      names.filter((name) => name.startsWith("suite-")).map((name) => cacheStorage.delete(name)),
    );
  }
  if (databaseFactory) {
    if (!databaseFactory.databases) throw new Error("This browser can't list saved databases.");
    const databases = await databaseFactory.databases();
    await Promise.all(
      databases.map(async ({ name }) => {
        if (!name?.startsWith("suite-") || KEPT_DATABASES.some((prefix) => name.startsWith(prefix)))
          return;
        await new Promise<void>((resolve, reject) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const request = databaseFactory.deleteDatabase(name);
          request.onsuccess = () => {
            clearTimeout(timer);
            resolve();
          };
          request.onerror = () => {
            clearTimeout(timer);
            reject(new Error("Couldn't clear saved copies."));
          };
          // Open connections get a versionchange event and close; only fail if one doesn't.
          request.onblocked = () => {
            timer ??= setTimeout(
              () => reject(new Error("Close other Solid Suite tabs and try again.")),
              blockedTimeoutMs,
            );
          };
        });
      }),
    );
  }
}
