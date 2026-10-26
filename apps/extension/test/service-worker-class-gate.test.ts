// AUTHORED-BY Claude Opus 4.8
//
// INTEGRATION tests for the Phase-2 PER-DATA-CLASS gate AS WIRED INTO the service worker. These
// drive the REAL `chrome.runtime.onMessage` listener with an in-memory chrome + captured fetch,
// proving the enforcement end-to-end (not just the pure logic in class-grant.test.ts):
//
//   - a class-only origin READ inside its pinned targets → ALLOW (egress);
//   - out-of-pinned-set (wrong resource / wrong mode) → DENY 403, distinguishable reason, NO egress;
//   - an EXPIRED grant → DENY + pruned from storage;
//   - REVOCATION (SOLID_REVOKE_GRANT) takes effect on the NEXT request;
//   - an UNKNOWN / unresolved class (empty targets) → fail-closed DENY;
//   - a DIFFERENT-WebID grant is ignored (session boundary);
//   - LEGACY origin-only (granted-origins) grants keep WHOLE-POD access (backwards compatibility);
//   - the requestAccess → consent-window → grant flow mints a pinned grant; listGrants reflects it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassGrant } from '../src/background/core/class-grant';
import { generateDpopKeyPair } from '../src/background/core/dpop';
import type { StoredDpopKeyRecord } from '../src/background/core/dpop-key-db';
import { ProfileStore } from '../src/background/core/profile-store';
import type { ReplicaMetadata } from '../src/background/core/replica-db';
import type { StoredSession } from '../src/background/session-store';
import { MemoryProfileDb, profileCredentials } from './profile-fixtures';

let profileDb: MemoryProfileDb;
vi.mock('../src/background/profile-db', () => ({
  ProfileDb: { open: async () => profileDb },
}));

// --- An in-memory DpopKeyDb double (see service-worker-gate.test.ts for the rationale) --
let idbDpopKey: StoredDpopKeyRecord | undefined;
class FakeDpopKeyDb {
  static async open() {
    return new FakeDpopKeyDb();
  }
  async get() {
    return idbDpopKey;
  }
  async put(record: StoredDpopKeyRecord) {
    idbDpopKey = record;
  }
  async clear() {
    idbDpopKey = undefined;
  }
  close() {}
}
vi.mock('../src/background/core/dpop-key-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/background/core/dpop-key-db')>();
  return { ...actual, DpopKeyDb: FakeDpopKeyDb };
});

async function seedDpopKeyPair(keyPair: CryptoKeyPair): Promise<void> {
  idbDpopKey = {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicJwk: (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey,
  };
}

// --- In-memory replica stores (as in service-worker-gate.test.ts) ---------------------
const idbMeta = new Map<string, ReplicaMetadata>();
const idbNonces = new Map<string, string>();
class FakeReplicaDb {
  static async open() {
    return new FakeReplicaDb();
  }
  async getMetadata(key: string) {
    return idbMeta.get(key);
  }
  async putMetadata(record: ReplicaMetadata) {
    idbMeta.set(record.key, record);
  }
  async deleteMetadata(key: string) {
    idbMeta.delete(key);
  }
  async getMetadataByWebId(webId: string) {
    return [...idbMeta.values()].filter((r) => r.webId === webId);
  }
  async deleteMetadataByWebId(webId: string) {
    for (const [k, v] of idbMeta) if (v.webId === webId) idbMeta.delete(k);
  }
  async clearMetadata() {
    idbMeta.clear();
  }
  async getNonce(origin: string) {
    return idbNonces.get(origin);
  }
  async setNonce(origin: string, nonce: string) {
    idbNonces.set(origin, nonce);
  }
  async clearNonces() {
    idbNonces.clear();
  }
  close() {}
}
vi.mock('../src/background/core/replica-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/background/core/replica-db')>();
  return { ...actual, ReplicaDb: FakeReplicaDb };
});

const cacheStore = new Map<
  string,
  { body: string; status: number; headers: Record<string, string> }
>();
function installCaches(): void {
  (globalThis as unknown as { caches: unknown }).caches = {
    open: async () => ({
      match: async (request: Request) => {
        const e = cacheStore.get(request.url);
        return e ? new Response(e.body, { status: e.status, headers: e.headers }) : undefined;
      },
      put: async (request: Request, response: Response) => {
        cacheStore.set(request.url, {
          body: await response.text(),
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        });
      },
      delete: async (request: Request) => cacheStore.delete(request.url),
      keys: async () => [...cacheStore.keys()].map((url) => new Request(url)),
    }),
  };
}

interface CapturedSender {
  origin?: string;
  url?: string;
  id?: string;
}
type MessageListener = (
  message: unknown,
  sender: CapturedSender,
  sendResponse: (r: unknown) => void,
) => boolean | undefined;

let storage: Map<string, unknown>;
let messageListeners: MessageListener[];
let fetchCalls: Array<{ url: string; init?: RequestInit }>;
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
let createdWindows: string[];

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXT_SENDER: CapturedSender = {
  origin: `chrome-extension://${EXTENSION_ID}`,
  id: EXTENSION_ID,
};

const WEBID = 'https://alice.pod.example/profile/card#me';

function installChrome(): void {
  storage = new Map();
  messageListeners = [];
  fetchCalls = [];
  createdWindows = [];

  const chromeStub = {
    runtime: {
      id: EXTENSION_ID,
      lastError: undefined as { message?: string } | undefined,
      getURL: (p: string) => `chrome-extension://${EXTENSION_ID}/${p}`,
      onMessage: { addListener: (fn: MessageListener) => messageListeners.push(fn) },
      onInstalled: { addListener: (_fn: () => void) => {} },
      sendMessage: (_m: unknown, _cb?: (r: unknown) => void) => Promise.resolve(),
    },
    storage: {
      local: {
        get: async (key: string) => {
          const out: Record<string, unknown> = {};
          if (storage.has(key)) out[key] = storage.get(key);
          return out;
        },
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) storage.set(k, v);
        },
        remove: async (key: string) => {
          storage.delete(key);
        },
      },
    },
    tabs: { query: async () => [], sendMessage: async () => {} },
    action: {
      setIcon: async () => {},
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
    contextMenus: {
      create: () => {},
      remove: (_id: string, cb?: () => void) => cb?.(),
      onClicked: { addListener: () => {} },
    },
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
    identity: { launchWebAuthFlow: async () => '' },
    windows: {
      create: (opts: { url: string }, cb?: (w: unknown) => void) => {
        createdWindows.push(opts.url);
        cb?.({ id: createdWindows.length });
      },
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;

  fetchImpl = async () => new Response('ok', { status: 200 });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    },
  ) as unknown as typeof fetch;
}

function send(
  message: Record<string, unknown>,
  sender: CapturedSender,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    for (const listener of messageListeners) {
      const handled = listener(message, sender, (r) => resolve(r as Record<string, unknown>));
      if (handled) return;
    }
    // A sync-handled message (returns false after calling sendResponse) already resolved.
    setTimeout(() => resolve({ error: 'no async listener handled' }), 0);
  });
}

function sendFetch(
  message: Record<string, unknown>,
  sender: CapturedSender,
): Promise<Record<string, unknown>> {
  return send(
    {
      type: 'SOLID_FETCH_REQUEST',
      requestId: 'r1',
      method: 'GET',
      headers: {},
      body: null,
      ...message,
    },
    sender,
  );
}

async function seedSession(overrides: Partial<StoredSession> = {}): Promise<void> {
  const keyPair = await generateDpopKeyPair();
  await seedDpopKeyPair(keyPair);
  storage.set('solid:session', {
    webId: WEBID,
    accessToken: 'access-token-xyz',
    refreshToken: 'refresh-xyz',
    issuer: 'https://idp.example/',
    tokenEndpoint: 'https://idp.example/token',
    clientId: 'https://pm.example/clientid.jsonld',
    expiresAt: Date.now() + 60 * 60 * 1000,
    ...overrides,
  } satisfies StoredSession);
}

function classGrant(overrides: Partial<ClassGrant> = {}): ClassGrant {
  return {
    grantId: 'grant-1',
    webId: WEBID,
    origin: 'https://appx.example',
    dataClass: 'https://w3id.org/jeswr/sectors/finance#Transaction',
    modes: ['read'],
    purpose: 'https://w3id.org/dpv#ServiceProvision',
    expiresAt: Date.now() + 60 * 60 * 1000,
    targets: [{ url: 'https://alice.pod.example/finance/', kind: 'container' }],
    createdAt: Date.now(),
    ...overrides,
  };
}

async function loadWorker(): Promise<void> {
  messageListeners.length = 0;
  vi.resetModules();
  await import('../src/background/service-worker');
  await new Promise((r) => setTimeout(r, 0));
}

const APPX = {
  origin: 'https://appx.example',
  url: 'https://appx.example/app',
} satisfies CapturedSender;

beforeEach(() => {
  profileDb = new MemoryProfileDb();
  installChrome();
  installCaches();
  cacheStore.clear();
  idbMeta.clear();
  idbNonces.clear();
  idbDpopKey = undefined;
});

describe('Phase-2 per-data-class gate (wired into the SW)', () => {
  it('a class-only origin READS within its pinned container → ALLOW with egress', async () => {
    await seedSession();
    storage.set('solid:class-grants', [classGrant()]);
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://alice.pod.example/finance/statement.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(res.status).toBe(200);
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example/finance/'))).toBe(
      true,
    );
  });

  it('DENIES a resource OUTSIDE the pinned targets — distinguishable reason, NO egress', async () => {
    await seedSession();
    storage.set('solid:class-grants', [classGrant()]);
    await loadWorker();
    fetchCalls.length = 0;

    const res = await sendFetch(
      { url: 'https://alice.pod.example/health/record.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(res.status).toBe(403);
    expect(res.error).toBe('Out of grant scope');
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(false);
  });

  it('DENIES a WRITE against a read-only grant (mode not satisfied)', async () => {
    await seedSession();
    storage.set('solid:class-grants', [classGrant({ modes: ['read'] })]);
    await loadWorker();
    fetchCalls.length = 0;

    const res = await sendFetch(
      {
        url: 'https://alice.pod.example/finance/statement.ttl',
        method: 'PUT',
        body: '<a> <b> <c> .',
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(res.status).toBe(403);
    expect(res.error).toBe('Out of grant scope');
    expect(fetchCalls.length).toBe(0);
  });

  it('ALLOWS a WRITE when the grant carries write mode', async () => {
    await seedSession();
    storage.set('solid:class-grants', [classGrant({ modes: ['write'] })]);
    await loadWorker();

    const res = await sendFetch(
      {
        url: 'https://alice.pod.example/finance/statement.ttl',
        method: 'PUT',
        body: '<a> <b> <c> .',
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(res.status).toBe(200);
  });

  it('an EXPIRED grant → DENY (no live grant) and is PRUNED from storage', async () => {
    await seedSession();
    storage.set('solid:class-grants', [classGrant({ expiresAt: Date.now() - 1000 })]);
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://alice.pod.example/finance/statement.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    // An expired grant no longer makes the origin a granted requester → forbidden-origin.
    expect(res.status).toBe(403);
    // The expired grant was pruned on the fetch path.
    expect(profileDb.state.records[0]?.classGrants).toEqual([]);
  });

  it('an UNKNOWN / unresolved class (empty targets) is fail-closed DENY even if unexpired', async () => {
    await seedSession();
    storage.set('solid:class-grants', [classGrant({ targets: [] })]);
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://alice.pod.example/finance/statement.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    // The origin passes the per-origin gate (it holds a live grant) but the empty-target grant
    // covers nothing → out-of-grant-scope.
    expect(res.status).toBe(403);
    expect(res.error).toBe('Out of grant scope');
  });

  it('ignores a grant minted under a DIFFERENT WebID (session boundary)', async () => {
    await seedSession(); // active WebID = alice
    storage.set('solid:class-grants', [classGrant({ webId: 'https://bob.pod.example/card#me' })]);
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://alice.pod.example/finance/statement.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(res.status).toBe(403);
  });

  it('BACKWARDS COMPAT: a legacy origin-only grant keeps WHOLE-POD access', async () => {
    await seedSession();
    // pm.example is a legacy full grant; NO class grant. It may read ANY pod resource.
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();

    const pm = { origin: 'https://pm.example', url: 'https://pm.example/app' };
    const a = await sendFetch(
      { url: 'https://alice.pod.example/finance/x.ttl', stampedOrigin: pm.origin },
      pm,
    );
    const b = await sendFetch(
      { url: 'https://alice.pod.example/health/y.ttl', stampedOrigin: pm.origin },
      pm,
    );
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it('a full-grant origin that ALSO holds a class grant keeps whole-pod access (full wins)', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://appx.example']);
    storage.set('solid:class-grants', [classGrant()]); // finance-only
    await loadWorker();

    // Outside the class targets, but appx is a FULL grant → still allowed.
    const res = await sendFetch(
      { url: 'https://alice.pod.example/health/y.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(res.status).toBe(200);
  });

  it('REVOCATION via SOLID_REVOKE_GRANT takes effect on the NEXT request', async () => {
    await seedSession();
    storage.set('solid:class-grants', [classGrant()]);
    await loadWorker();

    // Before: allowed.
    const before = await sendFetch(
      { url: 'https://alice.pod.example/finance/x.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(before.status).toBe(200);

    // Revoke (as the same origin).
    const rev = await send(
      {
        type: 'SOLID_REVOKE_GRANT',
        requestId: 'rev1',
        grantId: 'grant-1',
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(rev.ok).toBe(true);

    // After: denied on the very next request.
    const after = await sendFetch(
      { url: 'https://alice.pod.example/finance/x.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(after.status).toBe(403);
  });

  it('REVOKE purges exactly the revoked class replica slice, leaving other classes resident (residual b)', async () => {
    await seedSession();
    storage.set('solid:class-grants', [
      classGrant({
        grantId: 'grant-1',
        dataClass: 'https://w3id.org/jeswr/sectors/finance#Transaction',
        targets: [{ url: 'https://alice.pod.example/finance/', kind: 'container' }],
      }),
      classGrant({
        grantId: 'grant-2',
        dataClass: 'https://w3id.org/jeswr/sectors/health#Record',
        targets: [{ url: 'https://alice.pod.example/health/', kind: 'container' }],
      }),
    ]);
    await loadWorker();

    // Replicate ONE resource of EACH class → two cached byte entries + two metadata rows.
    await sendFetch(
      { url: 'https://alice.pod.example/finance/statement.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    await sendFetch(
      { url: 'https://alice.pod.example/health/record.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(cacheStore.size).toBe(2);
    expect(idbMeta.size).toBe(2);

    // Revoke ONLY the finance grant.
    const rev = await send(
      {
        type: 'SOLID_REVOKE_GRANT',
        requestId: 'rv',
        grantId: 'grant-1',
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(rev.ok).toBe(true);

    // ZERO bytes of the finance class remain; the health slice is untouched.
    expect(idbMeta.size).toBe(1);
    expect([...idbMeta.values()][0]?.resourceUrl).toBe(
      'https://alice.pod.example/health/record.ttl',
    );
    expect(cacheStore.size).toBe(1);
  });

  it('RETAINS overlapping cached bytes when a surviving READ grant still covers them (residual b)', async () => {
    await seedSession();
    // Two READ grants for the same origin BOTH covering finance/ (overlap).
    storage.set('solid:class-grants', [
      classGrant({ grantId: 'read-a', modes: ['read'] }),
      classGrant({ grantId: 'read-b', modes: ['read'] }),
    ]);
    await loadWorker();

    await sendFetch(
      { url: 'https://alice.pod.example/finance/statement.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(idbMeta.size).toBe(1);

    // Revoke ONE read grant; the other READ grant survives and still authorises the bytes → KEPT.
    const rev = await send(
      {
        type: 'SOLID_REVOKE_GRANT',
        requestId: 'rv',
        grantId: 'read-a',
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(rev.ok).toBe(true);
    expect(idbMeta.size).toBe(1); // retained — the surviving read grant still covers it
    expect(cacheStore.size).toBe(1);
  });

  it('PURGES cached read bytes even when an overlapping WRITE-only grant survives (read ≠ write, residual b)', async () => {
    await seedSession();
    // A READ grant (revoked) + a WRITE-only grant (survivor), both covering finance/.
    storage.set('solid:class-grants', [
      classGrant({ grantId: 'read-grant', modes: ['read'] }),
      classGrant({ grantId: 'write-grant', modes: ['write'] }),
    ]);
    await loadWorker();

    // Read caches the finance bytes (authorised by the read grant).
    await sendFetch(
      { url: 'https://alice.pod.example/finance/statement.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(idbMeta.size).toBe(1);

    // Revoke the READ grant. The write-only survivor does NOT authorise READING these bytes, so
    // they MUST be purged (a write grant does not imply read in this codebase).
    const rev = await send(
      {
        type: 'SOLID_REVOKE_GRANT',
        requestId: 'rv',
        grantId: 'read-grant',
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(rev.ok).toBe(true);
    expect(idbMeta.size).toBe(0); // purged — the surviving write-only grant cannot retain read bytes
    expect(cacheStore.size).toBe(0);
  });

  it('a PURGE FAILURE on revoke still denies access (fail-closed: removal precedes purge, residual b)', async () => {
    await seedSession();
    storage.set('solid:class-grants', [classGrant()]);
    // A cache whose delete THROWS (purge cannot complete), but put/match still work so a read caches.
    (globalThis as unknown as { caches: unknown }).caches = {
      open: async () => ({
        match: async (request: Request) => {
          const e = cacheStore.get(request.url);
          return e ? new Response(e.body, { status: e.status, headers: e.headers }) : undefined;
        },
        put: async (request: Request, response: Response) => {
          cacheStore.set(request.url, {
            body: await response.text(),
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
          });
        },
        delete: async () => {
          throw new Error('cache delete unavailable');
        },
        keys: async () => [...cacheStore.keys()].map((url) => new Request(url)),
      }),
    };
    await loadWorker();

    const before = await sendFetch(
      { url: 'https://alice.pod.example/finance/x.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(before.status).toBe(200);

    const rev = await send(
      {
        type: 'SOLID_REVOKE_GRANT',
        requestId: 'rv',
        grantId: 'grant-1',
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    // The grant was removed (the authoritative deny) EVEN THOUGH the byte purge could not complete.
    expect(rev.ok).toBe(true);

    // Access is denied on the very next request — never left live because cleanup failed.
    const after = await sendFetch(
      { url: 'https://alice.pod.example/finance/x.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(after.status).toBe(403);
  });

  it("a page CANNOT revoke another origin's grant", async () => {
    await seedSession();
    storage.set('solid:class-grants', [classGrant({ origin: 'https://appx.example' })]);
    await loadWorker();

    const evil = { origin: 'https://evil.example', url: 'https://evil.example/x' };
    const rev = await send(
      {
        type: 'SOLID_REVOKE_GRANT',
        requestId: 'rev1',
        grantId: 'grant-1',
        stampedOrigin: evil.origin,
      },
      evil,
    );
    expect(rev.ok).toBe(false);
    expect((profileDb.state.records[0]?.classGrants as unknown[]).length).toBe(1);
  });

  it('CONCURRENT save + revoke do not resurrect the revoked grant (serialised store)', async () => {
    const { saveClassGrant, revokeClassGrant, loadClassGrants } = await import(
      '../src/background/session-store'
    );
    storage.set('solid:class-grants', [classGrant({ grantId: 'existing' })]);
    // Fire a save (of a NEW grant) and a revoke (of the existing grant) concurrently. Without
    // serialisation a stale save could write back an array that resurrects 'existing'.
    await Promise.all([
      saveClassGrant(classGrant({ grantId: 'added' })),
      revokeClassGrant('existing', 'https://appx.example'),
    ]);
    const ids = (await loadClassGrants()).map((g) => g.grantId).sort();
    expect(ids).toEqual(['added']); // 'existing' stayed revoked; 'added' landed (no lost update).
  });

  it('CONCURRENT save + clear (logout) is serialised — clear wins, no grant survives', async () => {
    const { saveClassGrant, clearClassGrants, loadClassGrants } = await import(
      '../src/background/session-store'
    );
    // save enqueues first, clear (logout) second → serialised: clear runs after → empty. Without
    // the mutex, a stale save could persist a grant AFTER the logout clear.
    await Promise.all([saveClassGrant(classGrant({ grantId: 'x' })), clearClassGrants()]);
    expect(await loadClassGrants()).toEqual([]);
  });

  it('resolveClass: a class-only origin may resolve ONLY a class it holds a grant for', async () => {
    await seedSession();
    storage.set('solid:class-grants', [classGrant()]); // finance grant only
    await loadWorker();
    fetchImpl = async (url) => {
      if (url.includes('/profile/card'))
        return new Response(
          `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
           <${WEBID}> solid:publicTypeIndex <https://alice.pod.example/settings/pub.ttl> .`,
          { status: 200 },
        );
      if (url.includes('/settings/pub.ttl'))
        return new Response(
          `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
           <#h> a solid:TypeRegistration ;
             solid:forClass <https://w3id.org/jeswr/sectors/health#Record> ;
             solid:instanceContainer <https://alice.pod.example/health/> .`,
          { status: 200 },
        );
      return new Response('ok', { status: 200 });
    };

    // Its OWN class (finance) → allowed (resolves, even if empty).
    const ownClass = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'rc1',
        classIRI: 'https://w3id.org/jeswr/sectors/finance#Transaction',
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(ownClass.error).toBeUndefined();

    // An UNRELATED class (health) it holds no grant for → DENY (no private-structure leak).
    const otherClass = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'rc2',
        classIRI: 'https://w3id.org/jeswr/sectors/health#Record',
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(otherClass.error).toBe('No access grant for this data class');
    expect(otherClass.targets).toBeUndefined();
  });

  it('resolveClass does NOT follow a type-index ref on the ISSUER origin (pod-only, SSRF)', async () => {
    await seedSession(); // issuer = https://idp.example/
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();
    const issuerFetches: string[] = [];
    fetchImpl = async (url) => {
      if (url.startsWith('https://idp.example')) issuerFetches.push(url);
      if (url.includes('/profile/card'))
        // A hostile profile points the type index at the ISSUER origin.
        return new Response(
          `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
           <${WEBID}> solid:publicTypeIndex <https://idp.example/typeindex.ttl> .`,
          { status: 200 },
        );
      return new Response('', { status: 200 });
    };

    const pm = { origin: 'https://pm.example', url: 'https://pm.example/app' };
    const res = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'rc4',
        classIRI: 'https://w3id.org/jeswr/sectors/finance#Transaction',
        stampedOrigin: pm.origin,
      },
      pm,
    );
    expect(res.targets).toEqual([]);
    // The issuer-hosted type-index ref was NEVER fetched.
    expect(issuerFetches.filter((u) => u.includes('typeindex'))).toEqual([]);
  });

  it('resolveClass FOLLOWS a same-origin type-index ref when the pod IS the issuer (CSS single-origin)', async () => {
    // CSS default: WebID + IdP on ONE origin. The issuer exclusion must NOT drop this origin,
    // or class resolution breaks entirely on the most common Solid topology.
    await seedSession({ issuer: 'https://alice.pod.example/' }); // issuer === WebID origin
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();
    fetchImpl = async (url) => {
      if (url.includes('/profile/card'))
        return new Response(
          `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
           <${WEBID}> solid:publicTypeIndex <https://alice.pod.example/settings/pub.ttl> .`,
          { status: 200 },
        );
      if (url.includes('/settings/pub.ttl'))
        return new Response(
          `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
           <#fin> a solid:TypeRegistration ;
             solid:forClass <https://w3id.org/jeswr/sectors/finance#Transaction> ;
             solid:instanceContainer <https://alice.pod.example/finance/> .`,
          { status: 200 },
        );
      return new Response('', { status: 404 });
    };

    const pm = { origin: 'https://pm.example', url: 'https://pm.example/app' };
    const res = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'rc5',
        classIRI: 'https://w3id.org/jeswr/sectors/finance#Transaction',
        stampedOrigin: pm.origin,
      },
      pm,
    );
    // The pod-origin ref (== issuer origin here) WAS followed → the target resolved.
    expect(res.targets).toEqual([{ url: 'https://alice.pod.example/finance/', kind: 'container' }]);
  });

  it('resolveClass: a FULL-grant origin may resolve any class', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();
    fetchImpl = async () => new Response('', { status: 404 }); // resolution degrades to []

    const pm = { origin: 'https://pm.example', url: 'https://pm.example/app' };
    const res = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'rc3',
        classIRI: 'https://w3id.org/jeswr/sectors/health#Record',
        stampedOrigin: pm.origin,
      },
      pm,
    );
    expect(res.error).toBeUndefined();
    expect(res.targets).toEqual([]);
  });

  it("listGrants returns ONLY this origin's live grants", async () => {
    await seedSession();
    storage.set('solid:class-grants', [
      classGrant({ grantId: 'mine', origin: 'https://appx.example' }),
      classGrant({ grantId: 'other', origin: 'https://appy.example' }),
    ]);
    await loadWorker();

    const res = await send(
      { type: 'SOLID_LIST_GRANTS', requestId: 'lg1', stampedOrigin: APPX.origin },
      APPX,
    );
    const grants = res.grants as Array<{ grantId: string }>;
    expect(grants.map((g) => g.grantId)).toEqual(['mine']);
  });
});

describe('Phase-2 requestAccess → consent → grant (wired)', () => {
  const PROFILE = `
    @prefix solid: <http://www.w3.org/ns/solid/terms#> .
    <${WEBID}> solid:publicTypeIndex <https://alice.pod.example/settings/pub.ttl> .`;
  const INDEX = `
    @prefix solid: <http://www.w3.org/ns/solid/terms#> .
    <#fin> a solid:TypeRegistration ;
      solid:forClass <https://w3id.org/jeswr/sectors/finance#Transaction> ;
      solid:instanceContainer <https://alice.pod.example/finance/> .`;

  function routeFetch(url: string): Promise<Response> {
    if (url.includes('/profile/card'))
      return Promise.resolve(new Response(PROFILE, { status: 200 }));
    if (url.includes('/settings/pub.ttl'))
      return Promise.resolve(new Response(INDEX, { status: 200 }));
    return Promise.resolve(new Response('ok', { status: 200 }));
  }

  it('resolves the class, opens consent, mints a PINNED grant on approve, and enforces it', async () => {
    await seedSession();
    await loadWorker();
    fetchImpl = (url) => routeFetch(url);

    // Fire requestAccess (do not await yet — it awaits the consent decision).
    const reqPromise = send(
      {
        type: 'SOLID_REQUEST_ACCESS',
        requestId: 'ra1',
        classes: ['https://w3id.org/jeswr/sectors/finance#Transaction'],
        modes: ['read'],
        purpose: 'https://w3id.org/dpv#ServiceProvision',
        duration: 'P30D',
        stampedOrigin: APPX.origin,
        userActivated: true,
      },
      APPX,
    );

    // Wait for the consent window to open, then read the consentId from its URL.
    for (let i = 0; i < 50 && createdWindows.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(createdWindows.length).toBe(1);
    const consentId = new URL(createdWindows[0]).searchParams.get('consentId');
    expect(consentId).toBeTruthy();

    // The consent window fetches the pending record to render it.
    const view = (await send(
      { type: 'SOLID_GET_PENDING_CONSENT', consentId },
      EXT_SENDER,
    )) as unknown as { classes: Array<{ targets: unknown[] }> } | null;
    expect(view?.classes[0].targets).toHaveLength(1);

    // Approve the finance class.
    await send(
      {
        type: 'SOLID_CONSENT_DECISION',
        consentId,
        approvedClasses: ['https://w3id.org/jeswr/sectors/finance#Transaction'],
      },
      EXT_SENDER,
    );

    const res = await reqPromise;
    expect(res.ok).toBe(true);
    const grants = res.grants as Array<{ targets: Array<{ url: string; kind: string }> }>;
    expect(grants).toHaveLength(1);
    expect(grants[0].targets).toEqual([
      { url: 'https://alice.pod.example/finance/', kind: 'container' },
    ]);

    // The minted grant now ENFORCES: appx can read finance, not health.
    const ok = await sendFetch(
      { url: 'https://alice.pod.example/finance/x.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(ok.status).toBe(200);
    const denied = await sendFetch(
      { url: 'https://alice.pod.example/health/x.ttl', stampedOrigin: APPX.origin },
      APPX,
    );
    expect(denied.status).toBe(403);
  });

  it.each([
    'switch',
    'remove',
    'signout',
    'relogin',
  ] as const)('binds delayed consent to its original profile through %s', async (action) => {
    await seedSession();
    await loadWorker();
    const store = new ProfileStore(profileDb, async () => {});
    const b = await profileCredentials('bob');
    await store.login(b.session, b.keyPair, { ...b.display, photoUrl: null });
    fetchImpl = (url) => routeFetch(url);
    const request = send(
      {
        type: 'SOLID_REQUEST_ACCESS',
        requestId: 'delayed',
        classes: ['https://w3id.org/jeswr/sectors/finance#Transaction'],
        modes: ['read'],
        duration: 'P30D',
        stampedOrigin: APPX.origin,
        userActivated: true,
      },
      APPX,
    );
    for (let i = 0; i < 50 && createdWindows.length === 0; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(createdWindows).toHaveLength(1);
    const consentId = new URL(createdWindows[0]).searchParams.get('consentId');
    if (action === 'switch')
      await send({ type: 'SOLID_PROFILE_SET_DEFAULT', profileId: '2' }, EXT_SENDER);
    if (action === 'remove')
      await send({ type: 'SOLID_PROFILE_REMOVE', profileId: '1' }, EXT_SENDER);
    if (action === 'signout') await send({ type: 'SOLID_LOGOUT' }, EXT_SENDER);
    if (action === 'relogin') {
      const a = await profileCredentials('alice');
      const session = { ...a.session, webId: profileDb.state.records[0].profile.webId };
      await store.login(session, a.keyPair, { ...a.display, webId: session.webId, photoUrl: null });
    }
    await send(
      {
        type: 'SOLID_CONSENT_DECISION',
        consentId,
        approvedClasses: ['https://w3id.org/jeswr/sectors/finance#Transaction'],
      },
      EXT_SENDER,
    );
    const result = await request;
    expect((await store.get('2')).classGrants).toEqual([]);
    if (action === 'switch') {
      expect(result.ok).toBe(true);
      expect((await store.get('1')).classGrants).toHaveLength(1);
    } else {
      expect(result.error).toMatch(/session changed/);
      expect(profileDb.state.records.every((r) => r.classGrants.length === 0)).toBe(true);
    }
  });

  it('a DENY-all consent decision mints NO grant', async () => {
    await seedSession();
    await loadWorker();
    fetchImpl = (url) => routeFetch(url);

    const reqPromise = send(
      {
        type: 'SOLID_REQUEST_ACCESS',
        requestId: 'ra2',
        classes: ['https://w3id.org/jeswr/sectors/finance#Transaction'],
        modes: ['read'],
        duration: 'P30D',
        stampedOrigin: APPX.origin,
        userActivated: true,
      },
      APPX,
    );
    for (let i = 0; i < 50 && createdWindows.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const consentId = new URL(createdWindows[0]).searchParams.get('consentId');
    await send({ type: 'SOLID_CONSENT_DECISION', consentId, approvedClasses: [] }, EXT_SENDER);

    const res = await reqPromise;
    expect(res.ok).toBe(false);
    expect(res.grants).toEqual([]);
    expect(profileDb.state.records[0]?.classGrants ?? []).toEqual([]);
  });

  it('a NON-extension sender cannot post a consent decision (fail-closed)', async () => {
    await seedSession();
    await loadWorker();
    fetchImpl = (url) => routeFetch(url);

    const reqPromise = send(
      {
        type: 'SOLID_REQUEST_ACCESS',
        requestId: 'ra3',
        classes: ['https://w3id.org/jeswr/sectors/finance#Transaction'],
        modes: ['read'],
        duration: 'P30D',
        stampedOrigin: APPX.origin,
        userActivated: true,
      },
      APPX,
    );
    for (let i = 0; i < 50 && createdWindows.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const consentId = new URL(createdWindows[0]).searchParams.get('consentId');

    // A WEB PAGE tries to self-approve — must be ignored (not the extension's own window).
    await send(
      {
        type: 'SOLID_CONSENT_DECISION',
        consentId,
        approvedClasses: ['https://w3id.org/jeswr/sectors/finance#Transaction'],
      },
      APPX,
    );
    // The forged decision did not resolve the request; the grant store stays empty.
    await new Promise((r) => setTimeout(r, 20));
    expect(profileDb.state.records[0]?.classGrants ?? []).toEqual([]);
    void reqPromise;
  });

  it('REJECTS requestAccess with NO user gesture — opens NO consent window (residual c)', async () => {
    await seedSession();
    await loadWorker();
    fetchImpl = (url) => routeFetch(url);

    const res = await send(
      {
        type: 'SOLID_REQUEST_ACCESS',
        requestId: 'rg1',
        classes: ['https://w3id.org/jeswr/sectors/finance#Transaction'],
        modes: ['read'],
        duration: 'P30D',
        stampedOrigin: APPX.origin,
        // userActivated omitted → false (an autonomous, non-gesture call).
      },
      APPX,
    );
    expect(res.error).toMatch(/user action/i);
    // No consent window was opened and no pod fetch was made.
    expect(createdWindows.length).toBe(0);
    expect(fetchCalls.length).toBe(0);
  });

  it('RATE-LIMITS rapid repeated requestAccess from ONE origin (residual c)', async () => {
    await seedSession();
    await loadWorker();
    fetchImpl = (url) => routeFetch(url);

    const base = {
      type: 'SOLID_REQUEST_ACCESS',
      classes: ['https://w3id.org/jeswr/sectors/finance#Transaction'],
      modes: ['read'],
      duration: 'P30D',
      stampedOrigin: APPX.origin,
      userActivated: true,
    } as const;

    // Fire the first 3 (the default per-origin/minute cap): each passes the throttle and opens a
    // consent window, then AWAITS its decision — so we do NOT await these promises.
    void send({ ...base, requestId: 'rl1' }, APPX);
    void send({ ...base, requestId: 'rl2' }, APPX);
    void send({ ...base, requestId: 'rl3' }, APPX);
    for (let i = 0; i < 100 && createdWindows.length < 3; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(createdWindows.length).toBe(3);

    // The 4th within the same window → RATE-LIMITED, resolves immediately, opens NO 4th window.
    const r4 = await send({ ...base, requestId: 'rl4' }, APPX);
    expect(r4.error).toMatch(/too many/i);
    expect(createdWindows.length).toBe(3);
  });
});
