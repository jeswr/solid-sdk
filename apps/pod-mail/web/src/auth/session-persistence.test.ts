// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Tests for the durable, WebID-scoped DPoP-bound refresh-token store. Pins the
// SessionStore CONTRACT (round-trip put→get→delete, miss → undefined, keyed by
// issuer) against a faithful in-memory IDBFactory double that drives the REAL
// IndexedDbSessionStore code paths (open / onupgradeneeded / transaction /
// get/put/delete / db.close), plus indexedDbAvailable(). Security-critical: this is
// where a refresh token lives, so the store's key-scoping + round-trip fidelity is
// pinned here rather than assumed.
import { afterEach, describe, expect, it } from "vitest";
import {
  IndexedDbSessionStore,
  indexedDbAvailable,
  type PersistedSession,
} from "./session-persistence";

// ── A minimal but faithful in-memory IndexedDB double ────────────────────────
// It implements just the slice IndexedDbSessionStore uses: open() with
// onupgradeneeded + onsuccess, a keyPath object store, and a transaction whose
// get/put/delete return event-based IDBRequests. Async callbacks fire on a
// microtask so the request handlers are attached before they run (mirroring real
// IndexedDB's deferred-event behaviour).

type Rec = Record<string, unknown>;

class FakeRequest<T> {
  result!: T;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

class FakeObjectStore {
  constructor(
    private readonly data: Map<string, Rec>,
    private readonly keyPath: string,
    private readonly tx: FakeTransaction,
  ) {}
  get(key: string): FakeRequest<Rec | undefined> {
    const req = new FakeRequest<Rec | undefined>();
    queueMicrotask(() => {
      req.result = this.data.get(key);
      req.onsuccess?.();
      // A readonly transaction completes after its request settles.
      queueMicrotask(() => this.tx.oncomplete?.());
    });
    return req;
  }
  put(value: Rec): FakeRequest<void> {
    const req = new FakeRequest<void>();
    queueMicrotask(() => {
      this.data.set(value[this.keyPath] as string, value);
      req.onsuccess?.();
      // The transaction COMMITS after the write request succeeds — fire oncomplete
      // on a later microtask so the provider (which now resolves writes on
      // tx.oncomplete) observes durable commit, mirroring real IndexedDB.
      queueMicrotask(() => this.tx.oncomplete?.());
    });
    return req;
  }
  delete(key: string): FakeRequest<void> {
    const req = new FakeRequest<void>();
    queueMicrotask(() => {
      this.data.delete(key);
      req.onsuccess?.();
      queueMicrotask(() => this.tx.oncomplete?.());
    });
    return req;
  }
}

class FakeTransaction {
  onabort: (() => void) | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: unknown = null;
  constructor(
    private readonly data: Map<string, Rec>,
    private readonly keyPath: string,
  ) {}
  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.data, this.keyPath, this);
  }
}

class FakeDatabase {
  closed = false;
  readonly objectStoreNames = {
    _names: new Set<string>(),
    contains(n: string) {
      return this._names.has(n);
    },
  };
  constructor(
    private readonly data: Map<string, Rec>,
    private readonly keyPath: string,
  ) {}
  createObjectStore(name: string, _opts: { keyPath: string }): void {
    this.objectStoreNames._names.add(name);
  }
  transaction(): FakeTransaction {
    return new FakeTransaction(this.data, this.keyPath);
  }
  close(): void {
    this.closed = true;
  }
}

class FakeIDBFactory {
  // Persist across opens so the round-trip survives the per-call open/close.
  readonly store = new Map<string, Rec>();
  readonly opened: FakeDatabase[] = [];
  upgrades = 0;
  open(_name: string, _version: number): FakeRequest<FakeDatabase> {
    const req = new FakeRequest<FakeDatabase>();
    const db = new FakeDatabase(this.store, "issuer");
    this.opened.push(db);
    queueMicrotask(() => {
      // First open triggers onupgradeneeded (creates the object store), then success.
      if (this.upgrades === 0) {
        this.upgrades += 1;
        req.result = db;
        req.onupgradeneeded?.();
      }
      req.result = db;
      req.onsuccess?.();
    });
    return req;
  }
}

const sampleKey = async (): Promise<CryptoKeyPair> =>
  (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

describe("indexedDbAvailable", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it("is false when there is no IndexedDB (SSR / locked-down env)", () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    expect(indexedDbAvailable()).toBe(false);
  });

  it("is true when an IndexedDB exists", () => {
    (globalThis as { indexedDB?: unknown }).indexedDB =
      new FakeIDBFactory() as unknown as IDBFactory;
    expect(indexedDbAvailable()).toBe(true);
  });
});

describe("IndexedDbSessionStore — the durable refresh-token store contract", () => {
  it("round-trips put → get → delete, keyed by issuer", async () => {
    const factory = new FakeIDBFactory();
    const store = new IndexedDbSessionStore(factory as unknown as IDBFactory);

    const session: PersistedSession = {
      issuer: "https://issuer.example/",
      webId: "https://alice.example/profile/card#me",
      refreshToken: "rt-A",
      dpopKey: await sampleKey(),
      clientId: "https://app.example/clientid.jsonld",
      expiresAt: 123,
    };

    expect(await store.get(session.issuer)).toBeUndefined(); // miss before put
    await store.put(session);
    const got = await store.get(session.issuer);
    expect(got?.issuer).toBe(session.issuer);
    expect(got?.webId).toBe(session.webId);
    expect(got?.refreshToken).toBe("rt-A");
    expect(got?.dpopKey).toBeDefined();

    await store.delete(session.issuer);
    expect(await store.get(session.issuer)).toBeUndefined();
  });

  it("creates the object store exactly once (onupgradeneeded), reused across opens", async () => {
    const factory = new FakeIDBFactory();
    const store = new IndexedDbSessionStore(factory as unknown as IDBFactory);
    await store.put({
      issuer: "https://i1.example/",
      webId: "https://a.example/#me",
      refreshToken: "rt",
      dpopKey: await sampleKey(),
    });
    await store.get("https://i1.example/");
    // The upgrade (createObjectStore) fired on the first open only.
    expect(factory.upgrades).toBe(1);
    // Every opened database was closed (the store closes the connection in finally).
    expect(factory.opened.every((db) => db.closed)).toBe(true);
  });

  it("scopes by issuer — two issuers' credentials never collide", async () => {
    const factory = new FakeIDBFactory();
    const store = new IndexedDbSessionStore(factory as unknown as IDBFactory);
    await store.put({
      issuer: "https://issuer-a.example/",
      webId: "https://alice.example/#me",
      refreshToken: "rt-A",
      dpopKey: await sampleKey(),
    });
    await store.put({
      issuer: "https://issuer-b.example/",
      webId: "https://bob.example/#me",
      refreshToken: "rt-B",
      dpopKey: await sampleKey(),
    });
    expect((await store.get("https://issuer-a.example/"))?.refreshToken).toBe("rt-A");
    expect((await store.get("https://issuer-b.example/"))?.refreshToken).toBe("rt-B");
    // Deleting A leaves B intact (no cross-issuer wipe).
    await store.delete("https://issuer-a.example/");
    expect(await store.get("https://issuer-a.example/")).toBeUndefined();
    expect((await store.get("https://issuer-b.example/"))?.refreshToken).toBe("rt-B");
  });
});
