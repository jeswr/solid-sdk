// AUTHORED-BY GPT-6.1-Sol (Codex)
import type { ProfilePersistence, ProfileRecord, ProfileSnapshot } from './core/profile-store';

const RECORDS = 'profiles';
const META = 'metadata';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

/** Each token set and structured-cloned non-extractable key is keyed by profile id. */
export class ProfileDb implements ProfilePersistence {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = globalThis.indexedDB): Promise<ProfileDb> {
    if (!factory) throw new Error('ProfileStore requires IndexedDB.');
    const req = factory.open('solid-ext-profiles', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(RECORDS);
      req.result.createObjectStore(META);
    };
    return new ProfileDb(await request(req));
  }

  async read(): Promise<ProfileSnapshot> {
    const tx = this.db.transaction([RECORDS, META], 'readonly');
    const done = complete(tx);
    const [records, meta] = await Promise.all([
      request<ProfileRecord[]>(tx.objectStore(RECORDS).getAll()),
      request<Omit<ProfileSnapshot, 'records'> | undefined>(tx.objectStore(META).get('state')),
      done,
    ]);
    return {
      records: records.sort((a, b) => Number(a.profile.id) - Number(b.profile.id)),
      defaultProfileId: null,
      nextId: 1,
      migrated: false,
      ...meta,
    };
  }

  async write({ records, ...meta }: ProfileSnapshot): Promise<void> {
    const tx = this.db.transaction([RECORDS, META], 'readwrite');
    const done = complete(tx);
    const store = tx.objectStore(RECORDS);
    store.clear();
    for (const record of records) store.put(record, record.profile.id);
    tx.objectStore(META).put(meta, 'state');
    await done;
  }

  close(): void {
    this.db.close();
  }
}
