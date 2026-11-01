// AUTHORED-BY Codex GPT-6.1-Sol
import type { NotificationSource, SuiteNotification } from "../lib/notifications-model";

export interface LocalNotificationStore extends NotificationSource {
  add(notification: SuiteNotification): Promise<void>;
}
const stores = new Map<string, LocalNotificationStore>();
/** One store per account also shares invalidation listeners between local producers and the shell. */
export function localNotificationSource(accountId: string): LocalNotificationStore {
  let store = stores.get(accountId);
  if (!store) {
    store = createLocalNotificationStore(accountId);
    stores.set(accountId, store);
  }
  return store;
}
export function addLocalNotification(
  accountId: string,
  notification: SuiteNotification,
): Promise<void> {
  return localNotificationSource(accountId).add(notification);
}
export function createLocalNotificationStore(
  accountId: string,
  factory: IDBFactory | undefined = globalThis.indexedDB,
): LocalNotificationStore {
  const memory = new Map<string, SuiteNotification>();
  const listeners = new Set<() => void>();
  let unavailable = !factory;
  let database: Promise<IDBDatabase> | undefined;
  const open = () => {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!factory) throw new Error("Notification storage is unavailable");
      const request = factory.open(`suite-notifications-${accountId}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("events", { keyPath: "id" });
      request.onsuccess = () => {
        const db = request.result;
        // Let "Clear saved copies" (or an upgrade) proceed: close and reopen lazily.
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Notification storage is busy"));
    });
    return database;
  };
  const read = async () => {
    if (unavailable) return;
    try {
      const db = await open();
      const events = await new Promise<SuiteNotification[]>((resolve, reject) => {
        const transaction = db.transaction("events", "readonly");
        const request = transaction.objectStore("events").getAll();
        transaction.oncomplete = () => resolve(request.result as SuiteNotification[]);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      for (const event of events) memory.set(event.id, event);
    } catch {
      unavailable = true;
    }
  };
  // Serialize mutations so a read of an old IDB record cannot undo a pending local write.
  let queue: Promise<void> = Promise.resolve();
  const mutate = (change: () => SuiteNotification[]) => {
    const operation = queue.then(async () => {
      await read();
      const changed = change();
      if (!unavailable) {
        try {
          const db = await open();
          await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction("events", "readwrite");
            for (const item of changed) transaction.objectStore("events").put(item);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
          });
        } catch {
          unavailable = true;
        }
      }
      for (const listener of listeners) listener();
    });
    queue = operation.catch(() => {});
    return operation;
  };
  return {
    id: `local:${accountId}`,
    list(signal) {
      const operation = queue.then(async () => {
        signal.throwIfAborted();
        await read();
        signal.throwIfAborted();
        return structuredClone([...memory.values()]);
      });
      queue = operation.then(
        () => {},
        () => {},
      );
      return operation;
    },
    add: (notification) =>
      mutate(() => {
        const copy = structuredClone(notification);
        memory.set(copy.id, copy);
        return [copy];
      }),
    markRead: (ids) =>
      mutate(() => {
        const changed: SuiteNotification[] = [];
        for (const id of ids) {
          const item = memory.get(id);
          if (item) {
            const next = { ...item, read: true };
            memory.set(id, next);
            changed.push(next);
          }
        }
        return changed;
      }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
