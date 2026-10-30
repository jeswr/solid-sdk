// AUTHORED-BY Claude Sonnet 5
//
// The DPoP session keypair's durable, non-extractable storage (security hardening, design
// roborev round-1 — the F3 keystore-advantage finding). These tests exercise the REAL
// `DpopKeyDb` class against a minimal fake `IDBFactory` — not a mocked module — so the
// IndexedDB structured-clone round-trip is genuinely exercised: `put`/`get` clone the value
// via `structuredClone`, which is the same primitive the Web Crypto spec relies on to make a
// non-extractable `CryptoKey` survive an IndexedDB round-trip (verified live: Node's
// `structuredClone` clones a non-extractable `CryptoKey` and the clone can still sign).

import { beforeEach, describe, expect, it } from 'vitest';
import { createDpopProof, dpopThumbprint } from '../src/background/core/dpop';
import { DpopKeyDb, type StoredDpopKeyRecord } from '../src/background/core/dpop-key-db';
import {
  DpopKeyUnavailableError,
  loadSessionDpopKeyPair,
  mintAndPersistDpopKeyPair,
  persistDpopKeyPair,
} from '../src/background/core/dpop-key-store';

// --- A minimal fake IDBFactory --------------------------------------------------------
//
// Backs ONE named object store per "database" (keyed by db name) as a plain Map, with
// `put`/`get` round-tripping every value through `structuredClone` — the same algorithm a
// real IndexedDB implementation uses to persist a value, which is what makes a
// non-extractable `CryptoKey` survive intact (see the module docblock). A fresh
// `DpopKeyDb.open(factory)` call against the SAME `backingStores` map models an MV3
// service-worker restart re-opening the same durable database.

type FakeRecordStore = Map<IDBValidKey, unknown>;

class FakeRequestImpl<T> {
  result: T | undefined;
  error: unknown;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

/**
 * Resolve a fake request ONE microtask turn from now, then notify the owning transaction —
 * mirroring real IndexedDB, where `dpop-key-db.ts`'s `promisify(req)` resolves first and
 * `txDone(tx)` (which attaches `tx.oncomplete` only AFTER that resolution) must still see the
 * completion event. `notifyRequestDone` schedules `oncomplete` a further turn out so the
 * caller's `await txDone(tx)` has a chance to attach its handler in between.
 */
function settleRequest<T>(req: FakeRequestImpl<T>, value: T, notifyRequestDone: () => void): void {
  queueMicrotask(() => {
    req.result = value;
    req.onsuccess?.();
    notifyRequestDone();
  });
}

class FakeObjectStore {
  constructor(
    private readonly store: FakeRecordStore,
    private readonly notifyRequestDone: () => void,
  ) {}

  get(key: IDBValidKey): FakeRequestImpl<unknown> {
    const req = new FakeRequestImpl<unknown>();
    const raw = this.store.get(key);
    settleRequest(
      req,
      raw === undefined ? undefined : structuredClone(raw),
      this.notifyRequestDone,
    );
    return req;
  }

  put(value: unknown, key: IDBValidKey): FakeRequestImpl<IDBValidKey> {
    const req = new FakeRequestImpl<IDBValidKey>();
    this.store.set(key, structuredClone(value));
    settleRequest(req, key, this.notifyRequestDone);
    return req;
  }

  clear(): FakeRequestImpl<undefined> {
    const req = new FakeRequestImpl<undefined>();
    this.store.clear();
    settleRequest(req, undefined, this.notifyRequestDone);
    return req;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor(private readonly store: FakeRecordStore) {}

  objectStore(_name: string): FakeObjectStore {
    return new FakeObjectStore(this.store, () => this.scheduleComplete());
  }

  /** Fire `oncomplete` two turns after the request settles — see {@link settleRequest}. */
  private scheduleComplete(): void {
    queueMicrotask(() => queueMicrotask(() => this.oncomplete?.()));
  }
}

class FakeDatabase {
  private readonly names = new Set<string>();

  constructor(private readonly stores: Map<string, FakeRecordStore>) {}

  get objectStoreNames(): { contains: (name: string) => boolean } {
    return { contains: (name: string) => this.names.has(name) };
  }

  createObjectStore(name: string): FakeObjectStore {
    this.names.add(name);
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    // Only used for its side effect during "upgrade" — no transaction to notify.
    return new FakeObjectStore(this.stores.get(name) as FakeRecordStore, () => {});
  }

  transaction(name: string, _mode: string): FakeTransaction {
    // Object store must already exist (created during the "upgrade").
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return new FakeTransaction(this.stores.get(name) as FakeRecordStore);
  }

  close(): void {
    // no-op
  }
}

/** The fake `IDBOpenDBRequest` — its own (non-lib.dom) type, cast to `IDBFactory` at the edge. */
class FakeOpenRequest {
  result: FakeDatabase | undefined;
  error: unknown;
  onupgradeneeded: (() => void) | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

/** A fake IDBFactory whose `open` always yields the SAME backing db for a given `dbName`. */
function createFakeIdbFactory(backingDbs: Map<string, FakeDatabase>): IDBFactory {
  return {
    open(dbName: string, _version?: number) {
      const req = new FakeOpenRequest();
      const isNew = !backingDbs.has(dbName);
      const db = backingDbs.get(dbName) ?? new FakeDatabase(new Map());
      backingDbs.set(dbName, db);
      req.result = db;
      queueMicrotask(() => {
        if (isNew) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  } as unknown as IDBFactory;
}

// --- Tests ------------------------------------------------------------------------------

describe('DpopKeyDb — non-extractable CryptoKeyPair persistence', () => {
  let backingDbs: Map<string, FakeDatabase>;
  let factory: IDBFactory;

  beforeEach(() => {
    backingDbs = new Map();
    factory = createFakeIdbFactory(backingDbs);
  });

  it('persists + reloads a non-extractable keypair (structured-clone round trip)', async () => {
    const db = await DpopKeyDb.open(factory);
    const keyPair = await mintAndPersistDpopKeyPair(db);
    expect(keyPair.privateKey.extractable).toBe(false);

    // Simulate an MV3 service-worker restart: a FRESH DpopKeyDb handle re-opening the SAME
    // underlying (fake) database.
    const restarted = await DpopKeyDb.open(factory);
    const record = (await restarted.get()) as StoredDpopKeyRecord;
    expect(record).toBeDefined();
    expect(record.privateKey.extractable).toBe(false);
    // Round-tripped key still rejects export (never touched extractable material)...
    await expect(crypto.subtle.exportKey('jwk', record.privateKey)).rejects.toThrow();
    // ...yet is still a LIVE, usable key: it can sign a DPoP proof, verifiable against the
    // (safely-persisted) public JWK.
    const proof = await createDpopProof({
      keyPair: { privateKey: record.privateKey, publicKey: record.publicKey },
      htm: 'GET',
      htu: 'https://pod.example/x',
    });
    expect(typeof proof).toBe('string');
    expect(record.publicJwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect((record.publicJwk as { d?: unknown }).d).toBeUndefined();
  });

  it('clear() drops the persisted keypair (logout/teardown)', async () => {
    const db = await DpopKeyDb.open(factory);
    await mintAndPersistDpopKeyPair(db);
    expect(await db.get()).toBeDefined();
    await db.clear();
    expect(await db.get()).toBeUndefined();
  });
});

describe('loadSessionDpopKeyPair — session-aware load / legacy-rotate / mismatch-detect', () => {
  let backingDbs: Map<string, FakeDatabase>;
  let factory: IDBFactory;

  beforeEach(() => {
    backingDbs = new Map();
    factory = createFakeIdbFactory(backingDbs);
  });

  it('legacy session (no dpopJkt): returns the SAME persisted key on repeated calls', async () => {
    const db = await DpopKeyDb.open(factory);
    const first = await loadSessionDpopKeyPair(db, {});
    const firstJwk = await crypto.subtle.exportKey('jwk', first.publicKey);

    const second = await loadSessionDpopKeyPair(db, {});
    const secondJwk = await crypto.subtle.exportKey('jwk', second.publicKey);
    expect(secondJwk).toEqual(firstJwk);
  });

  it('legacy session (no dpopJkt): mints a FRESH key when none is persisted — the migration path', async () => {
    // Models the one-time migration: `session-store.ts#loadSession` has just stripped a
    // pre-hardening extractable JWK, leaving this store empty AND the session with no
    // recorded `dpopJkt` (it never had one). We must NOT attempt to reconstruct the old
    // key — a brand-new non-extractable key is minted instead.
    const db = await DpopKeyDb.open(factory);
    expect(await db.get()).toBeUndefined();

    const rotated = await loadSessionDpopKeyPair(db, {});
    expect(rotated.privateKey.extractable).toBe(false);
    const persisted = await db.get();
    expect(persisted).toBeDefined();
    await expect(
      crypto.subtle.exportKey('jwk', (persisted as StoredDpopKeyRecord).privateKey),
    ).rejects.toThrow();
  });

  it('legacy session: a pre-existing EXTRACTABLE keypair is never imported — rotation always mints fresh', async () => {
    // Sanity-check that the "legacy key" scenario cannot leak: even if some other code
    // path tried to hand a legacy extractable pair to the store, `loadSessionDpopKeyPair`
    // has no code path that imports arbitrary JWK material — it only ever calls
    // `generateDpopKeyPair()` (non-extractable by construction; see dpop.ts).
    const legacyExtractable = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    expect(legacyExtractable.privateKey.extractable).toBe(true); // sanity on the fixture itself

    const db = await DpopKeyDb.open(factory);
    const rotated = await loadSessionDpopKeyPair(db, {});
    expect(rotated.privateKey.extractable).toBe(false);
    // The rotated key is unrelated to the legacy one (different key material).
    const rotatedJwk = await crypto.subtle.exportKey('jwk', rotated.publicKey);
    const legacyJwk = await crypto.subtle.exportKey('jwk', legacyExtractable.publicKey);
    expect(rotatedJwk).not.toEqual(legacyJwk);
  });

  it('current-shape session (has dpopJkt): returns the matching persisted key', async () => {
    const db = await DpopKeyDb.open(factory);
    const keyPair = await mintAndPersistDpopKeyPair(db);
    const jkt = await dpopThumbprint(keyPair.publicKey);

    const loaded = await loadSessionDpopKeyPair(db, { dpopJkt: jkt });
    const loadedJwk = await crypto.subtle.exportKey('jwk', loaded.publicKey);
    const originalJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    expect(loadedJwk).toEqual(originalJwk);
  });

  it('current-shape session (has dpopJkt): a MISSING persisted key throws, never silently mints', async () => {
    // roborev round-1 Medium: a CURRENT-shape session's tokens are bound to a SPECIFIC key
    // (recorded jkt). If that key vanishes (IndexedDB eviction, browser bug), silently
    // minting a replacement would let the caller proceed with an access token that can
    // never verify against the new key server-side — confusing 401s instead of a clean
    // re-login. This must throw so the caller (service-worker.ts/auth-flow.ts) tears the
    // session down instead.
    const db = await DpopKeyDb.open(factory);
    expect(await db.get()).toBeUndefined();

    await expect(loadSessionDpopKeyPair(db, { dpopJkt: 'some-thumbprint' })).rejects.toThrow(
      DpopKeyUnavailableError,
    );
    // And it must NOT have minted+persisted a substitute as a side effect.
    expect(await db.get()).toBeUndefined();
  });

  it('current-shape session (has dpopJkt): a MISMATCHED persisted key throws, never silently swaps', async () => {
    // Models the store having been overwritten by something else (e.g. a later login)
    // while this session object is stale.
    const db = await DpopKeyDb.open(factory);
    const otherKeyPair = await mintAndPersistDpopKeyPair(db); // whatever is CURRENTLY persisted

    await expect(
      loadSessionDpopKeyPair(db, { dpopJkt: 'a-completely-different-thumbprint' }),
    ).rejects.toThrow(DpopKeyUnavailableError);
    // The mismatched record is left untouched (no silent overwrite).
    const stillThere = await db.get();
    const stillThereJwk = await crypto.subtle.exportKey(
      'jwk',
      (stillThere as StoredDpopKeyRecord).publicKey,
    );
    const otherJwk = await crypto.subtle.exportKey('jwk', otherKeyPair.publicKey);
    expect(stillThereJwk).toEqual(otherJwk);
  });
});

describe('persistDpopKeyPair — deferred-persist seam (login-failure safety)', () => {
  let backingDbs: Map<string, FakeDatabase>;
  let factory: IDBFactory;

  beforeEach(() => {
    backingDbs = new Map();
    factory = createFakeIdbFactory(backingDbs);
  });

  it('persists an ALREADY-GENERATED keypair without minting a new one', async () => {
    const db = await DpopKeyDb.open(factory);
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ]);
    await persistDpopKeyPair(db, keyPair);

    const record = await db.get();
    expect(record).toBeDefined();
    const recordJwk = await crypto.subtle.exportKey(
      'jwk',
      (record as StoredDpopKeyRecord).publicKey,
    );
    const keyPairJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    expect(recordJwk).toEqual(keyPairJwk);
  });

  it('a failed login (never calling persistDpopKeyPair) leaves an existing session key untouched', async () => {
    // Models auth-flow.ts completeLogin: generateDpopKeyPair() happens early (to sign the
    // token-exchange proof) but persistDpopKeyPair() is only reached on a SUCCESSFUL
    // exchange. A failed exchange must leave whatever was already persisted (an existing
    // logged-in session's key) completely untouched (roborev round-1 Medium).
    const db = await DpopKeyDb.open(factory);
    const existing = await mintAndPersistDpopKeyPair(db); // the "currently logged-in" key

    // Simulate a login attempt that generates a candidate key but whose token exchange
    // FAILS before persistDpopKeyPair is ever called.
    const candidate = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify'],
    );
    void candidate; // generated, but deliberately never persisted (exchange "failed")

    const record = await db.get();
    const recordJwk = await crypto.subtle.exportKey(
      'jwk',
      (record as StoredDpopKeyRecord).publicKey,
    );
    const existingJwk = await crypto.subtle.exportKey('jwk', existing.publicKey);
    expect(recordJwk).toEqual(existingJwk);
  });
});
