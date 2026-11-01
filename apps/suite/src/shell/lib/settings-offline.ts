// AUTHORED-BY Codex GPT-6.1-Sol
/** Delete only disposable suite copies. Account sessions and the demo's original data stay intact. */
export async function clearSavedCopies({
  cacheStorage,
  databaseFactory,
}: {
  cacheStorage?: Pick<CacheStorage, "keys" | "delete">;
  databaseFactory?: Pick<IDBFactory, "databases" | "deleteDatabase">;
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
        if (!name?.startsWith("suite-")) return;
        await new Promise<void>((resolve, reject) => {
          const request = databaseFactory.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(new Error("Couldn't clear saved copies."));
          request.onblocked = () =>
            reject(new Error("Close other Solid Suite tabs and try again."));
        });
      }),
    );
  }
}
