// AUTHORED-BY Codex GPT-6.1-Sol
export interface RecordValue {
  v: 1;
  webId: string;
  root: string;
  key: string;
  json: string;
  pending: boolean;
  order: number;
  token: string;
}

/** SDK-APP-08 can replace this durable latest-per-key replay queue. */
export interface ReplayQueue {
  list(): Promise<RecordValue[]>;
  put(record: RecordValue): Promise<void>;
  acknowledge(record: RecordValue): Promise<void>;
}

export function createQueue(webId: string, root: string): ReplayQueue {
  const memory = new Map<string, RecordValue>();
  async function transaction<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("suite-prefs", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("values", { keyPath: ["webId", "root", "key"] });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("values", mode);
      const request = work(tx.objectStore("values"));
      tx.oncomplete = () => {
        db.close();
        resolve(request.result);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
  }
  return {
    async list() {
      const records =
        typeof indexedDB === "undefined"
          ? [...memory.values()]
          : await transaction<RecordValue[]>("readonly", (store) => store.getAll());
      return records.filter((r) => r.v === 1 && r.webId === webId && r.root === root);
    },
    async put(record) {
      if (typeof indexedDB === "undefined") {
        const current = memory.get(record.key);
        if (!current || current.order <= record.order) memory.set(record.key, record);
        return;
      }
      await transaction("readwrite", (store) => {
        const request = store.get([webId, root, record.key]);
        request.onsuccess = () => {
          const current = request.result as RecordValue | undefined;
          if (!current || current.order <= record.order) store.put(record);
        };
        return request;
      });
    },
    async acknowledge(record) {
      if (typeof indexedDB === "undefined") {
        if (memory.get(record.key)?.token === record.token)
          memory.set(record.key, { ...record, pending: false });
        return;
      }
      await transaction("readwrite", (store) => {
        const request = store.get([webId, root, record.key]);
        request.onsuccess = () => {
          if (request.result?.token === record.token) store.put({ ...record, pending: false });
        };
        return request;
      });
    },
  };
}
