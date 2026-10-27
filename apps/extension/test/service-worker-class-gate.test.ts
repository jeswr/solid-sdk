import type { OriginGrant } from '../src/background/core/origin-grant';
import { seedOriginGrantFixtures } from './profile-fixtures';
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
import { opaqueRedirect, redirectProbe } from './redirect-fixtures';

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
  frameId?: number;
  tab?: { id: number; url: string };
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
let registrations: Map<string, chrome.scripting.RegisteredContentScript>;
let alarmListener: (alarm: { name: string }) => void;

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
  registrations = new Map();

  const chromeStub = {
    scripting: {
      getRegisteredContentScripts: async () => [...registrations.values()],
      registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => {
        for (const script of scripts) registrations.set(script.id, script);
      },
      unregisterContentScripts: async ({ ids }: { ids: string[] }) => {
        for (const id of ids) registrations.delete(id);
      },
    },
    alarms: {
      clear: vi.fn(async () => true),
      create: vi.fn(async () => {}),
      onAlarm: {
        addListener: (fn: typeof alarmListener) => {
          alarmListener = fn;
        },
      },
    },
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
  seedOriginGrantFixtures(storage, profileDb);
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
    expect(
      (storage.get('solid:origin-grants') as Array<{ scope: { classes: unknown[] } }>)[0].scope
        .classes,
    ).toEqual([]);
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

  it('an explicit whole-pod origin grant keeps WHOLE-POD access', async () => {
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

  it('an explicit whole-pod scope that ALSO has old standalone class records keeps whole-pod access (full wins)', async () => {
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
    expect((profileDb.state.records[0]!.classGrants as unknown[]).length).toBe(1);
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

  it('resolveClass reads public indexes on the issuer without credentials and drops issuer targets', async () => {
    await seedSession(); // issuer = https://idp.example/
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();
    fetchImpl = async (url) => {
      if (url.includes('/profile/card'))
        return new Response(
          `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
           <${WEBID}> solid:publicTypeIndex <https://idp.example/typeindex.ttl> .`,
          { status: 200 },
        );
      return new Response(
        `<#fin> <http://www.w3.org/ns/solid/terms#forClass> <${classGrant().dataClass}> ;
          <http://www.w3.org/ns/solid/terms#instanceContainer> <https://idp.example/private/> .`,
      );
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
    expect(fetchCalls.map((call) => call.url)).toEqual([
      WEBID,
      'https://idp.example/typeindex.ttl',
    ]);
    for (const call of fetchCalls) {
      expect(new Headers(call.init?.headers).has('Authorization')).toBe(false);
      expect(new Headers(call.init?.headers).has('DPoP')).toBe(false);
      expect(call.init?.credentials).toBe('omit');
    }
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
  it.each([
    'expiry',
    'relogin',
    'rebind',
    'logout',
  ] as const)('listGrants withholds private targets when %s occurs during session lookup', async (change) => {
    await seedSession();
    storage.set('solid:class-grants', [classGrant()]);
    await loadWorker();
    const { ProfileStore: WorkerStore } = await import('../src/background/core/profile-store');
    const session = WorkerStore.prototype.session;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const lookup = vi
      .spyOn(WorkerStore.prototype, 'session')
      .mockImplementationOnce(async function (this: ProfileStore, id) {
        const result = await session.call(this, id);
        entered();
        await held;
        return result;
      });
    try {
      const pending = send(
        { type: 'SOLID_LIST_GRANTS', requestId: 'held-list', stampedOrigin: APPX.origin },
        APPX,
      );
      await started;
      if (change === 'logout') await send({ type: 'SOLID_LOGOUT' }, EXT_SENDER);
      if (change === 'relogin') {
        const replacement = await profileCredentials('replacement');
        const replacementSession = { ...replacement.session, webId: WEBID };
        await new ProfileStore(profileDb, async () => {}).login(
          replacementSession,
          replacement.keyPair,
          { ...replacement.display, webId: WEBID },
        );
      }
      if (change === 'expiry' || change === 'rebind') {
        const parents = storage.get('solid:origin-grants') as OriginGrant[];
        storage.set('solid:origin-grants', [
          {
            ...parents[0],
            ...(change === 'expiry' ? { expiresAt: Date.now() - 1 } : { profileId: 'other' }),
          },
        ]);
      }
      release();
      const result = await pending;
      expect(result.grants).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('/finance/');
    } finally {
      release();
      lookup.mockRestore();
    }
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

  it.each([
    'logout',
    'relogin',
    'expiry',
    'revoke',
  ] as const)('requestAccess stops discovery held across %s before using stale credentials', async (change) => {
    await seedSession();
    storage.set('solid:granted-origins', [APPX.origin]);
    await loadWorker();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchImpl = async (url) => {
      if (url === WEBID) await held;
      return routeFetch(url);
    };
    let settled = false;
    const pending = send(
      {
        type: 'SOLID_REQUEST_ACCESS',
        requestId: 'stale-discovery',
        classes: [classGrant().dataClass],
        modes: ['read'],
        duration: 'P1D',
        stampedOrigin: APPX.origin,
        userActivated: true,
      },
      APPX,
    ).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(fetchCalls.some((call) => call.url === WEBID)).toBe(true));
    if (change === 'logout') await send({ type: 'SOLID_LOGOUT' }, EXT_SENDER);
    if (change === 'relogin') {
      const replacement = await profileCredentials('replacement');
      const session = { ...replacement.session, webId: WEBID };
      await new ProfileStore(profileDb, async () => {}).login(session, replacement.keyPair, {
        ...replacement.display,
        webId: WEBID,
      });
    }
    if (change === 'expiry') {
      const parents = storage.get('solid:origin-grants') as OriginGrant[];
      storage.set('solid:origin-grants', [{ ...parents[0], expiresAt: Date.now() - 1 }]);
    }
    if (change === 'revoke')
      await send({ type: 'SOLID_ORIGIN_GRANT_REVOKE', origin: APPX.origin }, EXT_SENDER);
    if (change === 'logout' || change === 'revoke')
      expect(fetchCalls.find((call) => call.url === WEBID)?.init?.signal?.aborted).toBe(true);
    release();
    await vi.waitFor(() => expect(settled || createdWindows.length > 0).toBe(true));
    // Settle the vulnerable implementation too, so its failure leaves no consent timer.
    if (createdWindows.length)
      await send(
        {
          type: 'SOLID_CONSENT_DECISION',
          approvedClasses: [],
          consentId: new URL(createdWindows[0]).searchParams.get('consentId'),
        },
        EXT_SENDER,
      );
    await pending;
    expect(fetchCalls.filter((call) => call.url.includes('/settings/'))).toEqual([]);
    expect(createdWindows).toEqual([]);
  });

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
        profileId: '1',
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
    { type: 'privateTypeIndex', indexOrigin: 'https://separate.pod.example' },
    { type: 'publicTypeIndex', indexOrigin: 'https://alice.pod.example' },
    { type: 'publicTypeIndex', indexOrigin: 'https://separate.pod.example' },
    { type: 'publicTypeIndex', indexOrigin: 'http://localhost:3000' },
  ])('discovers $type on $indexOrigin after real split-host pod-only consent', async ({
    type,
    indexOrigin,
  }) => {
    await seedSession();
    await loadWorker();
    const pod = 'https://separate.pod.example';
    await new ProfileStore(profileDb, async () => {}).capabilities('1', (record) => {
      record.podOrigins = [pod];
    });
    const index = `${indexOrigin}/settings/${type}.ttl`;
    const target = `${pod}/finance/`;
    const outOfScopeIndex = 'https://alice.pod.example/settings/private.ttl';
    let probeScope = false;
    fetchImpl = async (url) =>
      new Response(
        url === WEBID
          ? `<${WEBID}> <http://www.w3.org/ns/solid/terms#${type}> <${index}> .
            ${probeScope ? `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${outOfScopeIndex}> .` : ''}`
          : `<#r> <http://www.w3.org/ns/solid/terms#forClass> <${classGrant().dataClass}> ;
          <http://www.w3.org/ns/solid/terms#instanceContainer>
          <${target}> ${probeScope ? ', <https://alice.pod.example/private/>' : ''} .`,
      );
    const pending = send(
      {
        type: 'SOLID_REQUEST_ACCESS',
        requestId: 'split-consent',
        classes: [classGrant().dataClass],
        modes: ['read'],
        duration: 'P1D',
        stampedOrigin: APPX.origin,
        userActivated: true,
      },
      APPX,
    );
    await vi.waitFor(() => expect(createdWindows).toHaveLength(1));
    await send(
      {
        type: 'SOLID_CONSENT_DECISION',
        profileId: '1',
        consentId: new URL(createdWindows[0]).searchParams.get('consentId'),
        approvedClasses: [classGrant().dataClass],
      },
      EXT_SENDER,
    );
    expect((await pending).ok).toBe(true);
    const parents = storage.get('solid:origin-grants') as OriginGrant[];
    expect(parents[0].scope.pods).toEqual([pod]);
    const consentWebId = fetchCalls.find((call) => call.url === WEBID);
    expect(new Headers(consentWebId?.init?.headers).has('Authorization')).toBe(false);
    expect(new Headers(consentWebId?.init?.headers).has('DPoP')).toBe(false);
    expect(consentWebId?.init?.credentials).toBe('omit');
    const consentIndex = fetchCalls.find((call) => call.url === index);
    const authenticated = type === 'privateTypeIndex';
    probeScope = true;
    fetchCalls.length = 0;
    const result = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'split-resolve',
        classIRI: classGrant().dataClass,
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(result.targets).toEqual([{ url: target, kind: 'container' }]);
    expect(fetchCalls.map((call) => call.url)).toEqual([WEBID, index]);
    const headers = new Headers(fetchCalls[0].init?.headers);
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has('DPoP')).toBe(false);
    expect(fetchCalls[0].init?.credentials).toBe('omit');
    expect(new Headers(fetchCalls[1].init?.headers).has('Authorization')).toBe(authenticated);
    expect(new Headers(fetchCalls[1].init?.headers).has('DPoP')).toBe(authenticated);
    expect(fetchCalls[1].init?.credentials).toBe('omit');
    expect(fetchCalls[1].init?.redirect).toBe('manual');
    expect(new Headers(consentIndex?.init?.headers).has('Authorization')).toBe(authenticated);
    expect(new Headers(consentIndex?.init?.headers).has('DPoP')).toBe(authenticated);
    expect(consentIndex?.init?.credentials).toBe('omit');
    expect(consentIndex?.init?.redirect).toBe('manual');
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
        profileId: '1',
        consentId,
        approvedClasses: ['https://w3id.org/jeswr/sectors/finance#Transaction'],
      },
      EXT_SENDER,
    );
    const result = await request;
    expect((await store.get('2')).classGrants).toEqual([]);
    if (action === 'switch') {
      expect(result.ok).toBe(true);
      expect(storage.get('solid:origin-grants')).toMatchObject([
        { profileId: '1', scope: { classes: [{ origin: APPX.origin }] } },
      ]);
    } else {
      expect(result.error).toMatch(/session changed/);
      expect(profileDb.state.records.every((r) => r.classGrants.length === 0)).toBe(true);
    }
  });

  it.each([
    30_000, 120_000,
  ])('new Person consent preserves Finance effective expiry (%i ms)', async (childLifetime) => {
    const now = Date.now();
    const deadline = now + 60_000;
    await seedSession();
    storage.set('solid:class-grants', [classGrant({ expiresAt: now + childLifetime })]);
    await loadWorker();
    await send(
      { type: 'SOLID_ORIGIN_GRANT_EXPIRY', origin: APPX.origin, expiresAt: deadline },
      EXT_SENDER,
    );
    const person = 'https://schema.org/Person';
    fetchImpl = async (url) =>
      new Response(
        url.includes('/profile/card')
          ? PROFILE
          : `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <#person> solid:forClass <${person}> ;
        solid:instanceContainer <https://alice.pod.example/people/> .`,
      );
    const pending = send(
      {
        type: 'SOLID_REQUEST_ACCESS',
        requestId: 'person',
        classes: [person],
        modes: ['read'],
        duration: 'P1D',
        stampedOrigin: APPX.origin,
        userActivated: true,
      },
      APPX,
    );
    await vi.waitFor(() => expect(createdWindows).toHaveLength(1));
    await send(
      {
        type: 'SOLID_CONSENT_DECISION',
        profileId: '1',
        consentId: new URL(createdWindows[0]).searchParams.get('consentId'),
        approvedClasses: [person],
      },
      EXT_SENDER,
    );
    expect((await pending).ok).toBe(true);
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Math.min(deadline, now + childLifetime) + 1);
    try {
      expect(
        (
          await sendFetch(
            { url: 'https://alice.pod.example/finance/x.ttl', stampedOrigin: APPX.origin },
            APPX,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await sendFetch(
            { url: 'https://alice.pod.example/people/x.ttl', stampedOrigin: APPX.origin },
            APPX,
          )
        ).status,
      ).toBe(200);
    } finally {
      clock.mockRestore();
    }
  });

  it('merges consent with the current parent after a concurrent class revoke', async () => {
    await seedSession();
    storage.set('solid:class-grants', [classGrant({ grantId: 'revoked' })]);
    await loadWorker();
    fetchImpl = routeFetch;
    const pending = send(
      {
        type: 'SOLID_REQUEST_ACCESS',
        requestId: 'consent-race',
        classes: [classGrant().dataClass],
        modes: ['read'],
        duration: 'P1D',
        stampedOrigin: APPX.origin,
        userActivated: true,
      },
      APPX,
    );
    await vi.waitFor(() => expect(createdWindows).toHaveLength(1));
    const consentId = new URL(createdWindows[0]).searchParams.get('consentId');
    const { OriginGrantStore } = await import('../src/background/core/origin-grant');
    const update = OriginGrantStore.prototype.update;
    // Commit the revoke after consent reads the parent, before its queued update runs.
    const queued = vi
      .spyOn(OriginGrantStore.prototype, 'update')
      .mockImplementationOnce(async function (this: InstanceType<typeof OriginGrantStore>, change) {
        expect(
          (
            await send(
              {
                type: 'SOLID_REVOKE_GRANT',
                grantId: 'revoked',
                stampedOrigin: APPX.origin,
              },
              APPX,
            )
          ).ok,
        ).toBe(true);
        return update.call(this, change);
      });
    try {
      await send(
        {
          type: 'SOLID_CONSENT_DECISION',
          profileId: '1',
          consentId,
          approvedClasses: [classGrant().dataClass],
        },
        EXT_SENDER,
      );
      expect((await pending).ok).toBe(true);
      const parents = storage.get('solid:origin-grants') as OriginGrant[];
      expect(parents[0].scope.classes).toHaveLength(1);
      expect(parents[0].scope.classes?.[0].grantId).not.toBe('revoked');
    } finally {
      queued.mockRestore();
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
    await send(
      { type: 'SOLID_CONSENT_DECISION', profileId: '1', consentId, approvedClasses: [] },
      EXT_SENDER,
    );

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
        profileId: '1',
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

describe('EXT-05 explicit origin grant authority (adversarial)', () => {
  function parent(extra: Partial<OriginGrant> = {}): OriginGrant {
    return {
      origin: APPX.origin,
      profileId: '1',
      createdAt: Date.now(),
      scope: { pods: ['https://alice.pod.example'], classes: [classGrant()] },
      ...extra,
    };
  }
  function fetchFinance(extra: Record<string, unknown> = {}) {
    return sendFetch(
      { url: 'https://alice.pod.example/finance/x.ttl', stampedOrigin: APPX.origin, ...extra },
      APPX,
    );
  }
  async function boot(grants: OriginGrant[] = [parent()]) {
    await seedSession();
    storage.set('solid:origin-grants', grants);
    await loadWorker();
  }

  it('follows a gated slash redirect and caches only the final authorized URL', async () => {
    await boot();
    const original = 'https://alice.pod.example/finance/x.ttl';
    const final = `${original}/`;
    fetchImpl = async (url, init) =>
      init?.redirect === 'follow'
        ? redirectProbe(`${final}?view=1`)
        : url === original
          ? opaqueRedirect()
          : new Response('final bytes', {
              headers: { etag: 'final-etag', 'DPoP-Nonce': 'final-nonce' },
            });
    expect((await fetchFinance()).body).toBe('final bytes');
    expect(fetchCalls.map((c) => c.url)).toEqual([original, original, `${final}?view=1`]);
    expect(fetchCalls[1].init).toMatchObject({
      method: 'HEAD',
      credentials: 'omit',
      redirect: 'follow',
      headers: {},
    });
    expect([...idbMeta.values()].map((m) => m.resourceUrl)).toEqual([`${final}?view=1`]);
    expect(idbNonces.get('https://alice.pod.example')).toBe('final-nonce');

    // Scope no longer covers the final resource: neither the alias nor a direct warm
    // cache lookup may return the stored bytes.
    storage.set('solid:origin-grants', [
      parent({
        scope: {
          pods: ['https://alice.pod.example'],
          classes: [
            classGrant({
              targets: [{ url: original, kind: 'instance' }],
            }),
          ],
        },
      }),
    ]);
    fetchCalls.length = 0;
    const denied = await fetchFinance();
    expect(denied.body).toBeUndefined();
    expect(denied.error).toBe('Out of grant scope');
    expect(fetchCalls.map((c) => c.url)).toEqual([original, original]);
    fetchCalls.length = 0;
    expect((await fetchFinance({ url: `${final}?view=1` })).status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it.each([
    ['https://evil.example/steal', /Redirect target denied/],
    ['https://idp.example/token?exchange=1', /Redirect target denied/],
    ['https://idp.example/outside-pods', /Out of grant scope/],
    ['https://alice.pod.example/private/secret', /Out of grant scope/],
    ['http://alice.pod.example/finance/secret', /Forbidden URL/],
    ['file:///etc/passwd', /Forbidden URL/],
  ])('refuses a redirect outside the full gate without target egress (%s)', async (url, error) => {
    await boot();
    fetchImpl = async (_url, init) =>
      init?.redirect === 'follow' ? redirectProbe(url) : opaqueRedirect();
    const denied = await fetchFinance();
    expect(denied.body).toBeUndefined();
    expect(denied.error).toMatch(error);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls.every((call) => call.url === 'https://alice.pod.example/finance/x.ttl')).toBe(
      true,
    );
    expect(cacheStore.size).toBe(0);
  });

  it('refuses the token endpoint as an original URL too', async () => {
    await boot([parent({ scope: { pods: ['https://idp.example'] } })]);
    expect((await fetchFinance({ url: 'https://idp.example/token' })).status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it.each([
    'PUT',
    'POST',
    'PATCH',
    'DELETE',
  ])('fails closed on a %s redirect with no probe or second request', async (method) => {
    await boot([
      parent({
        scope: { pods: ['https://alice.pod.example'], classes: [classGrant({ modes: ['write'] })] },
      }),
    ]);
    fetchImpl = async () => opaqueRedirect();
    const response = await fetchFinance({ method, body: 'payload' });
    expect(response.error).toBe('Redirect rejected');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].init).toMatchObject({ method, body: 'payload', redirect: 'manual' });
  });

  it('checks live grant changes between redirect hops', async () => {
    await boot();
    fetchImpl = async () => {
      storage.set('solid:origin-grants', [
        parent({ scope: { pods: [], classes: [classGrant()] } }),
      ]);
      return opaqueRedirect();
    };
    expect((await fetchFinance()).error).toBe('Out of grant scope');
    expect(fetchCalls).toHaveLength(1);
  });

  it('rejects a profile rebinding during discovery before re-sending', async () => {
    const grant = parent();
    await boot([grant]);
    fetchImpl = async (_url, init) => {
      if (init?.redirect !== 'follow') return opaqueRedirect();
      storage.set('solid:origin-grants', [{ ...grant, profileId: '2' }]);
      return redirectProbe('https://alice.pod.example/finance/final');
    };
    const denied = await fetchFinance();
    expect(denied.error).toBe('Origin not granted access');
    expect(denied.body).toBeUndefined();
    expect(fetchCalls).toHaveLength(2);
    expect(cacheStore.size).toBe(0);
  });

  it('rechecks intermediate resource URLs before committing or relaying final bytes', async () => {
    const grant = parent();
    await boot([grant]);
    const original = 'https://alice.pod.example/finance/x.ttl';
    const middle = 'https://alice.pod.example/finance/middle';
    const final = 'https://alice.pod.example/finance/final';
    fetchImpl = async (url, init) => {
      if (init?.redirect === 'follow') return redirectProbe(url === original ? middle : final);
      if (url !== final) return opaqueRedirect();
      storage.set('solid:origin-grants', [
        {
          ...grant,
          scope: {
            pods: grant.scope.pods,
            classes: [
              classGrant({
                targets: [
                  { url: original, kind: 'instance' },
                  { url: final, kind: 'instance' },
                ],
              }),
            ],
          },
        },
      ]);
      return new Response('final bytes', { headers: { etag: 'final-etag' } });
    };
    const denied = await fetchFinance();
    expect(denied.error).toBe('Out of grant scope');
    expect(denied.body).toBeUndefined();
    expect(fetchCalls.map((call) => call.url)).toEqual([original, original, middle, middle, final]);
    expect(cacheStore.size).toBe(0);
    expect(idbMeta.size).toBe(0);
  });

  it('rechecks the final target before storing or relaying its bytes', async () => {
    await boot();
    fetchImpl = async (url, init) => {
      if (init?.redirect === 'follow')
        return redirectProbe('https://alice.pod.example/finance/next');
      if (url.endsWith('/x.ttl')) return opaqueRedirect();
      storage.set('solid:origin-grants', [
        parent({
          scope: {
            pods: ['https://alice.pod.example'],
            classes: [
              classGrant({
                targets: [{ url: 'https://alice.pod.example/finance/x.ttl', kind: 'instance' }],
              }),
            ],
          },
        }),
      ]);
      return new Response('revoked target bytes');
    };
    const denied = await fetchFinance();
    expect(denied.error).toBe('Out of grant scope');
    expect(denied.body).toBeUndefined();
    expect(cacheStore.size).toBe(0);
  });

  it.each([
    'publicTypeIndex',
    'privateTypeIndex',
  ])('follows a discovery %s slash redirect with the same credential policy', async (type) => {
    await boot([parent({ scope: { pods: ['https://alice.pod.example'] } })]);
    const index = 'https://alice.pod.example/settings/index';
    fetchImpl = async (url, init) =>
      init?.redirect === 'follow'
        ? redirectProbe(`${index}/`)
        : url === WEBID
          ? new Response(`<${WEBID}> <http://www.w3.org/ns/solid/terms#${type}> <${index}> .`)
          : url === index
            ? opaqueRedirect()
            : new Response(`<#r> <http://www.w3.org/ns/solid/terms#forClass> <${classGrant().dataClass}> ;
              <http://www.w3.org/ns/solid/terms#instanceContainer> <finance/> .`);
    const result = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'redirect-discovery',
        classIRI: classGrant().dataClass,
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(result.targets).toEqual([{ url: `${index}/finance/`, kind: 'container' }]);
    expect(fetchCalls.map((c) => c.url)).toEqual([WEBID, index, index, `${index}/`]);
    for (const call of fetchCalls) {
      const probing = call.init?.redirect === 'follow';
      expect(call.init).toMatchObject({
        credentials: 'omit',
        redirect: probing ? 'follow' : 'manual',
      });
      expect(new Headers(call.init?.headers).has('Authorization')).toBe(
        type === 'privateTypeIndex' && call.url !== WEBID && !probing,
      );
      if (probing) expect(call.init).toMatchObject({ method: 'HEAD', headers: {} });
    }
  });

  it('drops relative targets in a public type index redirected to a foreign origin', async () => {
    await boot([parent({ scope: { pods: ['https://alice.pod.example'] } })]);
    const index = 'https://alice.pod.example/settings/index';
    const final = 'https://public.example/settings/index/';
    fetchImpl = async (url, init) =>
      init?.redirect === 'follow'
        ? redirectProbe(final)
        : url === WEBID
          ? new Response(
              `<${WEBID}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${index}> .`,
            )
          : url === index
            ? opaqueRedirect()
            : new Response(`<#r> <http://www.w3.org/ns/solid/terms#forClass> <${classGrant().dataClass}> ;
              <http://www.w3.org/ns/solid/terms#instanceContainer> <finance/> .`);
    const result = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'foreign-index-base',
        classIRI: classGrant().dataClass,
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(result.targets).toEqual([]);
    expect(fetchCalls.map((c) => c.url)).toEqual([WEBID, index, index, final]);
    for (const call of fetchCalls) {
      expect(call.init?.credentials).toBe('omit');
      expect(new Headers(call.init?.headers).has('Authorization')).toBe(false);
      expect(new Headers(call.init?.headers).has('DPoP')).toBe(false);
    }
  });

  it.each([
    ['https://public.example/profile', true],
    ['http://alice.pod.example/profile', false],
    ['https://idp.example/token', false],
    ['data:text/plain,profile', false],
    ['opaque', false],
  ])('applies public discovery URL restrictions at every hop (%s)', async (target, allowed) => {
    await boot([parent({ scope: { pods: ['https://alice.pod.example'] } })]);
    fetchImpl = async (url, init) => {
      if (init?.redirect === 'follow') return redirectProbe(target);
      if (url !== WEBID) return new Response('');
      return target === 'opaque' ? Response.error() : opaqueRedirect();
    };
    const result = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'public-redirect',
        classIRI: classGrant().dataClass,
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(result.targets).toEqual([]);
    expect(fetchCalls.map((c) => c.url)).toEqual(
      allowed ? [WEBID, WEBID, target] : target === 'opaque' ? [WEBID] : [WEBID, WEBID],
    );
    for (const call of fetchCalls) {
      expect(call.init).toMatchObject({ credentials: 'omit' });
      if (call.init?.redirect === 'follow')
        expect(call.init).toMatchObject({ method: 'HEAD', headers: {} });
      else expect(call.init?.redirect).toBe('manual');
      expect(new Headers(call.init?.headers).has('Authorization')).toBe(false);
      expect(new Headers(call.init?.headers).has('DPoP')).toBe(false);
    }
  });

  it('refuses private discovery redirects outside the live parent pod scope', async () => {
    await boot([parent({ scope: { pods: ['https://alice.pod.example'] } })]);
    const index = 'https://alice.pod.example/private/index';
    fetchImpl = async (url, init) =>
      init?.redirect === 'follow'
        ? redirectProbe('https://idp.example/private')
        : url === WEBID
          ? new Response(
              `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${index}> .`,
            )
          : opaqueRedirect();
    const result = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'private-redirect',
        classIRI: classGrant().dataClass,
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(result.targets).toEqual([]);
    expect(fetchCalls.map((c) => c.url)).toEqual([WEBID, index, index]);
  });

  it('ignores standalone class/login grants and client-id declarations without a parent', async () => {
    storage.set('solid:granted-origins', [APPX.origin]);
    storage.set('solid:class-grants', [classGrant()]);
    await boot([]);
    expect(
      (
        await send(
          { type: 'SOLID_SET_CLIENT_ID', origin: APPX.origin, clientId: `${APPX.origin}/clientid` },
          APPX,
        )
      ).ok,
    ).toBe(true);
    expect((await fetchFinance()).status).toBe(403);
    expect(
      (await send({ type: 'SOLID_GET_STATE', stampedOrigin: APPX.origin }, APPX)).webId,
    ).toBeNull();
    expect(
      (
        await send(
          { type: 'SOLID_LIST_GRANTS', requestId: 'list', stampedOrigin: APPX.origin },
          APPX,
        )
      ).grants,
    ).toEqual([]);
    expect(
      (
        await send(
          {
            type: 'SOLID_RESOLVE_CLASS',
            requestId: 'resolve',
            classIRI: 'https://schema.org/Person',
            stampedOrigin: APPX.origin,
          },
          APPX,
        )
      ).error,
    ).toBeTruthy();
    expect(
      (await send({ type: 'SOLID_LOGOUT', stampedOrigin: APPX.origin }, APPX)).error,
    ).toBeTruthy();
    expect(fetchCalls).toHaveLength(0);
    expect(registrations.size).toBe(0);
  });

  it('rejects a spoofed isolated-origin stamp with zero cache or pod access', async () => {
    await boot();
    const result = await sendFetch(
      {
        url: 'https://alice.pod.example/finance/x.ttl',
        stampedOrigin: APPX.origin,
        profileId: '1',
      },
      { origin: 'https://evil.example', url: 'https://evil.example/' },
    );
    expect(result.status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
    expect(cacheStore.size).toBe(0);
  });

  it.each([
    'SOLID_ORIGIN_GRANTS_LIST',
    'SOLID_ORIGIN_GRANT_REVOKE',
    'SOLID_ORIGIN_GRANT_PROFILE',
    'SOLID_ORIGIN_GRANT_EXPIRY',
  ])('refuses page-supplied management %s', async (type) => {
    await boot();
    expect(
      (await send({ type, origin: APPX.origin, expiresAt: Date.now() + 1 }, APPX)).error,
    ).toMatch(/extension context/);
    expect((await fetchFinance()).status).toBe(200);
  });

  it('revokes a warm origin slice, unregisters, and denies a captured patch on its next request', async () => {
    await boot();
    expect(registrations.size).toBe(1);
    expect([...registrations.values()][0].matches).toEqual([`${APPX.origin}:443/*`]);
    expect((await fetchFinance()).status).toBe(200);
    expect(cacheStore.size).toBe(1);
    expect(
      (await send({ type: 'SOLID_ORIGIN_GRANT_REVOKE', origin: APPX.origin }, EXT_SENDER)).ok,
    ).toBe(true);
    expect(registrations.size).toBe(0);
    expect(cacheStore.size).toBe(0);
    fetchCalls.length = 0;
    expect((await fetchFinance()).status).toBe(403);
    expect(await fetchFinance({ autoDivert: true })).toEqual({
      requestId: 'r1',
      passthrough: true,
    });
    expect(fetchCalls).toHaveLength(0);
    expect((await send({ type: 'SOLID_ORIGIN_GRANTS_LIST' }, EXT_SENDER)).grants).toEqual([]);
  });

  it('denies expiry immediately even if the alarm has not fired; alarm removes the persisted registration', async () => {
    const deadline = Date.now() + 60_000;
    await boot([parent({ expiresAt: deadline })]);
    expect(chrome.alarms.create).toHaveBeenCalledWith('solid-origin-expiry', { when: deadline });
    expect((await fetchFinance()).status).toBe(200);
    const now = vi.spyOn(Date, 'now').mockReturnValue(deadline);
    try {
      expect((await fetchFinance()).status).toBe(403);
      alarmListener({ name: 'solid-origin-expiry' });
      await vi.waitFor(() => expect(registrations.size).toBe(0));
      expect(cacheStore.size).toBe(0);
      expect(
        (await send({ type: 'SOLID_GET_STATE', stampedOrigin: APPX.origin }, APPX)).webId,
      ).toBeNull();
    } finally {
      now.mockRestore();
    }
  });

  it.each(
    [
      { gate: 'last egress', method: 'PUT', pruneWrite: 4 },
      { gate: 'final response', method: 'GET', pruneWrite: 6 },
    ].flatMap((stage) => ['parent', 'child'].map((expiry) => ({ ...stage, expiry }))),
  )('denies $expiry expiry during pruning in the $gate gate without an alarm', async ({
    method,
    pruneWrite,
    expiry,
  }) => {
    const deadline = Date.now() + 60_000;
    await boot([
      parent({
        expiresAt: deadline + (expiry === 'parent' ? 0 : 60_000),
        scope: {
          pods: ['https://alice.pod.example'],
          classes: [
            classGrant({
              modes: ['read', 'write'],
              expiresAt: deadline + (expiry === 'child' ? 0 : 60_000),
            }),
          ],
        },
      }),
    ]);
    fetchImpl = async () => new Response('private finance bytes');
    const now = vi.spyOn(Date, 'now').mockReturnValue(deadline - 1);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    const set = chrome.storage.local.set;
    const pruning = vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
      // Gates run at entry, replica entry, egress and signed egress; a GET also gates
      // persistence before its final response. Hold the write at the requested boundary.
      if ('solid:origin-grants' in items && ++writes === pruneWrite) await held;
      return set(items);
    });
    const pending = fetchFinance({ method, body: method === 'PUT' ? 'updated finance' : null });
    try {
      await vi.waitFor(() => expect(writes).toBe(pruneWrite));
      expect(fetchCalls).toHaveLength(method === 'PUT' ? 0 : 1);
      if (method === 'GET')
        expect(new Headers(fetchCalls[0].init?.headers).get('Authorization')).toBe(
          'DPoP access-token-xyz',
        );
      // Cross the real deadline while storage is suspended, leaving the alarm unfired.
      now.mockReturnValue(deadline);
      release();
      const result = await pending;
      expect(fetchCalls).toHaveLength(method === 'PUT' ? 0 : 1);
      expect(result.status).not.toBe(200);
      expect(result.error).toBe(
        expiry === 'parent' ? 'Origin not granted access' : 'No access grant for this data',
      );
      expect(result.body).toBeUndefined();
      expect(registrations.size).toBe(1);
    } finally {
      release();
      await pending;
      pruning.mockRestore();
      now.mockRestore();
    }
  });

  it('checks the bound parent pod scope even when a child grant pins another pod', async () => {
    await boot([parent({ scope: { pods: [], classes: [classGrant()] } })]);
    expect((await fetchFinance()).status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });

  it('rejects invalid/missing profiles and duplicate origin bindings, without falling back to the default', async () => {
    await boot([parent({ profileId: 'missing' }), parent({ profileId: '2' })]);
    expect((await fetchFinance()).status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
    expect(registrations.size).toBe(0);
  });

  it('only shortens expiry through trusted management; malformed and missing origins fail closed', async () => {
    const deadline = Date.now() + 60_000;
    await boot([parent({ expiresAt: deadline })]);
    for (const expiresAt of [NaN, Date.now() - 1, deadline + 1]) {
      expect(
        (
          await send(
            { type: 'SOLID_ORIGIN_GRANT_EXPIRY', origin: APPX.origin, expiresAt },
            EXT_SENDER,
          )
        ).error,
      ).toBeTruthy();
    }
    expect(
      (
        await send(
          { type: 'SOLID_ORIGIN_GRANT_EXPIRY', origin: APPX.origin, expiresAt: deadline - 1000 },
          EXT_SENDER,
        )
      ).ok,
    ).toBe(true);
    expect((storage.get('solid:origin-grants') as OriginGrant[])[0].expiresAt).toBe(
      deadline - 1000,
    );
    expect(
      (await send({ type: 'SOLID_ORIGIN_GRANT_REVOKE', origin: '*://*/*' }, EXT_SENDER)).error,
    ).toBeTruthy();
    expect(
      (
        await send(
          { type: 'SOLID_ORIGIN_GRANT_REVOKE', origin: 'https://absent.example' },
          EXT_SENDER,
        )
      ).ok,
    ).toBe(false);
  });

  it('never lets a concurrent longer expiry overwrite an earlier shortening', async () => {
    const deadline = Date.now() + 60_000;
    await boot([parent({ expiresAt: deadline })]);
    // A replica commit holds the profile queue, so both managers validate against the
    // original expiry and then wait to commit in order.
    let release!: () => void;
    const gateOpen = new Promise<void>((resolve) => {
      release = resolve;
    });
    let committing!: () => void;
    const committed = new Promise<void>((resolve) => {
      committing = resolve;
    });
    const cache = await caches.open('solid-ext-replica-bytes');
    const put = cache.put.bind(cache);
    cache.put = async (request: RequestInfo | URL, response: Response) => {
      committing();
      await gateOpen;
      return put(request as Request, response);
    };
    vi.spyOn(caches, 'open').mockResolvedValue(cache);
    const pending = fetchFinance();
    await committed;
    const managers = Promise.all([
      send(
        { type: 'SOLID_ORIGIN_GRANT_EXPIRY', origin: APPX.origin, expiresAt: deadline - 10_000 },
        EXT_SENDER,
      ),
      send(
        { type: 'SOLID_ORIGIN_GRANT_EXPIRY', origin: APPX.origin, expiresAt: deadline - 1000 },
        EXT_SENDER,
      ),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const [shorter, longer] = await managers;
    await pending;
    expect(shorter.ok).toBe(true);
    expect(longer.error).toMatch(/only be shortened/);
    expect((storage.get('solid:origin-grants') as OriginGrant[])[0].expiresAt).toBe(
      deadline - 10_000,
    );
  });

  it.each([
    'nonexistent',
    'grant-1',
  ])('class revoke %s only cancels its own origin after an actual removal', async (grantId) => {
    const appB = { origin: 'https://appy.example', url: 'https://appy.example/app' };
    await boot([
      parent(),
      parent({
        origin: appB.origin,
        scope: {
          pods: ['https://alice.pod.example'],
          classes: [classGrant({ origin: appB.origin })],
        },
      }),
    ]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchImpl = async () => {
      await held;
      return new Response('private bytes');
    };
    const own = fetchFinance();
    const other = sendFetch(
      { url: 'https://alice.pod.example/finance/other.ttl', stampedOrigin: appB.origin },
      appB,
    );
    await vi.waitFor(() => expect(fetchCalls).toHaveLength(2));
    const result = await send(
      { type: 'SOLID_REVOKE_GRANT', grantId, stampedOrigin: APPX.origin },
      APPX,
    );
    expect(result.ok).toBe(grantId === 'grant-1');
    release();
    expect((await other).status).toBe(200);
    const ownResult = await own;
    if (grantId === 'grant-1') {
      expect(ownResult.body).toBeUndefined();
      expect(ownResult.error).toBeTruthy();
    } else expect(ownResult.status).toBe(200);
  });

  it('aborts a pending response on revoke before serving or persisting any bytes', async () => {
    await boot();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: (response: Response) => void;
    fetchImpl = async () => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const pending = fetchFinance();
    await started;
    await send({ type: 'SOLID_ORIGIN_GRANT_REVOKE', origin: APPX.origin }, EXT_SENDER);
    release(new Response('private fixture bytes'));
    const result = await pending;
    expect(result.body).toBeUndefined();
    expect(result.error).toBeTruthy();
    expect(cacheStore.size).toBe(0);
  });

  it.each(
    ['WebID', 'index'].flatMap((stage) =>
      ['origin revoke', 'profile rebind', 'class revoke', 'expiry'].map((change) => ({
        stage,
        change,
      })),
    ),
  )('stops discovery held at $stage after $change', async ({ stage, change }) => {
    await boot();
    if (change === 'profile rebind') {
      const b = await profileCredentials('bob');
      await new ProfileStore(profileDb, async () => {}).login(b.session, b.keyPair, b.display);
    }
    const indexUrl = 'https://alice.pod.example/settings/private.ttl';
    const profile = `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${indexUrl}> .`;
    const index = `<#r> <http://www.w3.org/ns/solid/terms#forClass> <${classGrant().dataClass}> ;
      <http://www.w3.org/ns/solid/terms#instanceContainer> <https://alice.pod.example/finance/> .`;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    fetchImpl = async (url) => {
      if ((stage === 'WebID' && url.includes('/profile/card')) || url === indexUrl) {
        entered();
        await held;
      }
      return new Response(url === indexUrl ? index : profile);
    };
    const pending = send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'discovery-race',
        classIRI: classGrant().dataClass,
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    await started;
    if (change === 'expiry') {
      const parents = storage.get('solid:origin-grants') as OriginGrant[];
      storage.set('solid:origin-grants', [{ ...parents[0], expiresAt: Date.now() - 1 }]);
    } else if (change === 'class revoke') {
      expect(
        (
          await send(
            { type: 'SOLID_REVOKE_GRANT', grantId: 'grant-1', stampedOrigin: APPX.origin },
            APPX,
          )
        ).ok,
      ).toBe(true);
    } else {
      expect(
        (
          await send(
            {
              type:
                change === 'origin revoke'
                  ? 'SOLID_ORIGIN_GRANT_REVOKE'
                  : 'SOLID_ORIGIN_GRANT_PROFILE',
              origin: APPX.origin,
              profileId: '2',
            },
            EXT_SENDER,
          )
        ).error,
      ).toBeUndefined();
    }
    release();
    const result = await pending;
    expect(result).toMatchObject({ requestId: 'discovery-race', error: expect.any(String) });
    expect(result.targets).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchCalls).toHaveLength(stage === 'WebID' ? 1 : 2);
    if (change !== 'expiry') expect(fetchCalls.at(-1)?.init?.signal?.aborted).toBe(true);
  });

  it.each([
    false,
    true,
  ])('confines discovery requests and targets to parent pods (nested classes: %s)', async (nested) => {
    await boot([
      parent({
        scope: {
          pods: ['https://alice.pod.example'],
          ...(nested ? { classes: [classGrant()] } : {}),
        },
      }),
    ]);
    await new ProfileStore(profileDb, async () => {}).capabilities('1', (record) => {
      record.podOrigins = ['https://other.pod.example'];
    });
    const indexA = 'https://alice.pod.example/settings/private.ttl';
    const indexB = 'https://other.pod.example/settings/private.ttl';
    fetchImpl = async (url) =>
      new Response(
        url.includes('/profile/card')
          ? `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${indexA}>, <${indexB}> .`
          : `<#r> <http://www.w3.org/ns/solid/terms#forClass> <${classGrant().dataClass}> ;
            <http://www.w3.org/ns/solid/terms#instanceContainer>
              <https://alice.pod.example/finance/>, <https://other.pod.example/finance/> .`,
      );
    const result = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'scoped-discovery',
        classIRI: classGrant().dataClass,
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(result.error).toBeUndefined();
    expect(result.targets).toEqual([
      { url: 'https://alice.pod.example/finance/', kind: 'container' },
    ]);
    expect(fetchCalls.map((call) => call.url)).toEqual([WEBID, indexA]);
  });

  it('filters discovery targets against the live pod scope before delivery', async () => {
    await boot();
    const indexUrl = 'https://alice.pod.example/settings/private.ttl';
    fetchImpl = async (url) => {
      if (url.includes('/profile/card'))
        return new Response(
          `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${indexUrl}> .`,
        );
      const parents = storage.get('solid:origin-grants') as OriginGrant[];
      storage.set('solid:origin-grants', [
        { ...parents[0], scope: { ...parents[0].scope, pods: [] } },
      ]);
      return new Response(`<#r> <http://www.w3.org/ns/solid/terms#forClass> <${classGrant().dataClass}> ;
        <http://www.w3.org/ns/solid/terms#instanceContainer> <https://alice.pod.example/finance/> .`);
    };
    const result = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'scope-shrink',
        classIRI: classGrant().dataClass,
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(result.targets).toEqual([]);
    expect(fetchCalls).toHaveLength(2);
  });

  it('does not authenticate a discovery WebID fetch outside the parent pod scope', async () => {
    await boot([parent({ scope: { pods: [] } })]);
    const result = await send(
      {
        type: 'SOLID_RESOLVE_CLASS',
        requestId: 'empty-scope',
        classIRI: classGrant().dataClass,
        stampedOrigin: APPX.origin,
      },
      APPX,
    );
    expect(result.targets).toEqual([]);
    expect(fetchCalls.map((call) => call.url)).toEqual([WEBID]);
    expect(new Headers(fetchCalls[0].init?.headers).has('Authorization')).toBe(false);
    expect(new Headers(fetchCalls[0].init?.headers).has('DPoP')).toBe(false);
    expect(fetchCalls[0].init?.credentials).toBe('omit');
  });

  it('selects profile 2 in consent, swaps the binding, and never transfers profile 1 targets or credentials', async () => {
    await boot();
    expect((await fetchFinance()).status).toBe(200);
    const b = await profileCredentials('bob');
    const store = new ProfileStore(profileDb, async () => {});
    await store.login(b.session, b.keyPair, b.display);
    const cls = 'https://schema.org/Person';
    fetchImpl = async (url) => {
      if (url === b.session.webId)
        return new Response(
          `<${b.session.webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <https://pod.example/bob/index> .`,
        );
      if (url === 'https://pod.example/bob/index')
        return new Response(
          `<#registration> <http://www.w3.org/ns/solid/terms#forClass> <${cls}>; <http://www.w3.org/ns/solid/terms#instanceContainer> <https://pod.example/bob/private/> .`,
        );
      return new Response('fixture resource');
    };
    const request = send(
      {
        type: 'SOLID_REQUEST_ACCESS',
        requestId: 'swap',
        classes: [cls],
        modes: ['read'],
        duration: 'P30D',
        stampedOrigin: APPX.origin,
        userActivated: true,
        profileId: '1',
      },
      APPX,
    );
    await vi.waitFor(() => expect(createdWindows).toHaveLength(1));
    const consentId = new URL(createdWindows[0]).searchParams.get('consentId');
    expect(await send({ type: 'SOLID_GET_PENDING_CONSENT', consentId }, APPX)).toBeNull();
    expect(
      await send(
        { type: 'SOLID_GET_PENDING_CONSENT', consentId, profileId: 'unknown' },
        EXT_SENDER,
      ),
    ).toBeNull();
    const view = await send(
      { type: 'SOLID_GET_PENDING_CONSENT', consentId, profileId: '2' },
      EXT_SENDER,
    );
    expect(view.profileId).toBe('2');
    expect(view.profiles).toMatchObject([{ id: '1' }, { id: '2', label: 'bob' }]);
    expect(view.classes).toMatchObject([
      { targets: [{ url: 'https://pod.example/bob/private/' }] },
    ]);
    await send(
      { type: 'SOLID_CONSENT_DECISION', consentId, profileId: '2', approvedClasses: [cls] },
      EXT_SENDER,
    );
    expect((await request).ok).toBe(true);
    expect(cacheStore.size).toBe(0);
    expect((await fetchFinance()).status).toBe(403);
    expect((await send({ type: 'SOLID_GET_STATE', stampedOrigin: APPX.origin }, APPX)).webId).toBe(
      b.session.webId,
    );
    fetchCalls.length = 0;
    const result = await sendFetch(
      { url: 'https://pod.example/bob/private/item', stampedOrigin: APPX.origin, profileId: '1' },
      APPX,
    );
    expect(result.status).toBe(200);
    expect(new Headers(fetchCalls[0].init?.headers).get('authorization')).toBe(
      `DPoP ${b.session.accessToken}`,
    );
    expect((storage.get('solid:origin-grants') as OriginGrant[])[0]).toMatchObject({
      profileId: '2',
      scope: { classes: [{ webId: b.session.webId }] },
    });
  });
});

it('trusted profile rebinding clears old pod/class scopes and cached data before returning', async () => {
  await seedSession();
  storage.set('solid:origin-grants', [
    {
      origin: APPX.origin,
      profileId: '1',
      createdAt: 0,
      scope: { pods: ['https://alice.pod.example'], classes: [classGrant()] },
    },
  ]);
  await loadWorker();
  const b = await profileCredentials('bob');
  await new ProfileStore(profileDb, async () => {}).login(b.session, b.keyPair, b.display);
  expect(
    (
      await sendFetch(
        { url: 'https://alice.pod.example/finance/a', stampedOrigin: APPX.origin },
        APPX,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await send(
        { type: 'SOLID_ORIGIN_GRANT_PROFILE', origin: APPX.origin, profileId: '2' },
        EXT_SENDER,
      )
    ).ok,
  ).toBe(true);
  expect(cacheStore.size).toBe(0);
  expect(storage.get('solid:origin-grants')).toMatchObject([
    { profileId: '2', scope: { pods: [], classes: [] } },
  ]);
  expect((await send({ type: 'SOLID_GET_STATE', stampedOrigin: APPX.origin }, APPX)).webId).toBe(
    b.session.webId,
  );
  fetchCalls.length = 0;
  expect(
    (await sendFetch({ url: 'https://pod.example/private', stampedOrigin: APPX.origin }, APPX))
      .status,
  ).toBe(403);
  expect(fetchCalls).toHaveLength(0);
});

it('unregisters a revoked origin even when replica stores cannot open', async () => {
  await seedSession();
  storage.set('solid:origin-grants', [
    {
      origin: APPX.origin,
      profileId: '1',
      createdAt: 0,
      scope: { pods: ['https://alice.pod.example'], classes: [classGrant()] },
    },
  ]);
  await loadWorker();
  const open = vi.spyOn(caches, 'open').mockRejectedValue(new Error('fixture replica unavailable'));
  try {
    expect(
      (await send({ type: 'SOLID_ORIGIN_GRANT_REVOKE', origin: APPX.origin }, EXT_SENDER)).ok,
    ).toBe(true);
    expect(registrations.size).toBe(0);
    expect(
      (
        await sendFetch(
          { url: 'https://alice.pod.example/finance/a', stampedOrigin: APPX.origin },
          APPX,
        )
      ).status,
    ).toBe(403);
  } finally {
    open.mockRestore();
  }
});

// AUTHORED-BY Codex GPT-6.1-Sol
// Exercise form-fill through the actual worker router and its credential boundary.
describe('separate form-fill consent wired into the worker', () => {
  const origin = 'https://shop.example';
  const source: CapturedSender = {
    origin,
    url: `${origin}/checkout`,
    frameId: 0,
    tab: { id: 7, url: `${origin}/checkout` },
  };
  const fields = [
    { field: 'name', category: 'contact' },
    { field: 'street-address', category: 'address' },
  ];
  async function prepare() {
    await seedSession();
    await loadWorker();
    chrome.tabs.get = vi.fn(async () => ({
      id: 7,
      url: source.url,
    })) as unknown as typeof chrome.tabs.get;
    chrome.windows.remove = vi.fn(async () => {});
    fetchCalls = [];
    fetchImpl = async (url) =>
      new Response(
        url === WEBID
          ? `
      @prefix v: <http://www.w3.org/2006/vcard/ns#>.
      <${WEBID}> v:fn "Alex"; v:hasAddress <../private/address#home>; v:hasEmail <https://foreign.example/contact>.
    `
          : `<${WEBID}> <http://www.w3.org/2006/vcard/ns#hasAddress> <#home>.
      <#home> <http://www.w3.org/2006/vcard/ns#street-address> "42 Sample Street".`,
        { headers: { 'Content-Type': 'text/turtle' } },
      );
  }
  async function pendingFill() {
    const result = send(
      {
        type: 'SOLID_FORMFILL_REQUEST',
        fields,
        origin: 'https://forged.example',
        stampedOrigin: 'https://forged.example',
      },
      source,
    );
    await vi.waitFor(() =>
      expect(createdWindows.some((url) => url.includes('/formfill/preview.html'))).toBe(true),
    );
    const url = createdWindows.find((u) => u.includes('/formfill/preview.html'))!;
    const requestId = new URL(url).searchParams.get('requestId')!;
    return { result, requestId, previewSender: { ...EXT_SENDER, url, frameId: 0 } };
  }
  it('loads public data without credentials, confines private fetch, and returns only approved values', async () => {
    await prepare();
    const { result, requestId, previewSender } = await pendingFill();
    const preview = await send({ type: 'SOLID_FORMFILL_PREVIEW', requestId }, previewSender);
    expect(preview.origin).toBe(origin);
    expect(preview.values).toEqual([
      { field: 'name', category: 'contact', value: 'Alex' },
      { field: 'street-address', category: 'address', value: '42 Sample Street' },
    ]);
    const publicCall = fetchCalls.find((c) => c.url === WEBID)!;
    expect(publicCall.init).toMatchObject({ credentials: 'omit', redirect: 'manual' });
    expect(new Headers(publicCall.init?.headers).has('Authorization')).toBe(false);
    const privateCall = fetchCalls.find(
      (c) => c.url === 'https://alice.pod.example/private/address',
    )!;
    expect(privateCall.init).toMatchObject({ credentials: 'omit', redirect: 'manual' });
    expect(new Headers(privateCall.init?.headers).get('Authorization')).toBe(
      'DPoP access-token-xyz',
    );
    expect(new Headers(privateCall.init?.headers).get('DPoP')).toBeTruthy();
    expect(fetchCalls).toHaveLength(2);
    await send(
      {
        type: 'SOLID_FORMFILL_DECISION',
        requestId,
        profileId: preview.profileId,
        categories: ['address'],
        remember: true,
      },
      previewSender,
    );
    expect(await result).toEqual({
      origin,
      values: [{ field: 'street-address', category: 'address', value: '42 Sample Street' }],
    });
    expect(storage.get('solid:formfill-grants')).toEqual([
      expect.objectContaining({ origin, profileId: preview.profileId, categories: ['address'] }),
    ]);
    expect(
      (await send({ type: 'SOLID_GET_STATE', stampedOrigin: origin }, source)).webId,
    ).toBeNull();
    expect(storage.get('solid:origin-grants')).toEqual([]);
  });
  it.each([
    'SOLID_LOGOUT',
    'SOLID_PROFILE_REMOVE',
  ])('%s cancels the preview and removes form-fill grants', async (type) => {
    await prepare();
    const state = await send({ type: 'SOLID_PROFILES_LIST' }, EXT_SENDER);
    const id = (state.profiles as Array<{ id: string }>)[0].id;
    storage.set('solid:formfill-grants', [
      { origin, profileId: id, categories: ['contact'], createdAt: 1 },
    ]);
    const { result } = await pendingFill();
    expect((await send({ type, profileId: id }, EXT_SENDER)).error).toBeUndefined();
    expect(await result).toEqual({ values: [] });
    expect(storage.get('solid:formfill-grants')).toEqual([]);
  });
  it('rejects insecure and cross-origin iframe senders before any profile fetch', async () => {
    await prepare();
    for (const sender of [
      {
        ...source,
        origin: 'http://remote.example',
        url: 'http://remote.example',
        tab: { id: 7, url: 'http://remote.example' },
      },
      {
        ...source,
        frameId: 5,
        origin: 'https://embedded.example',
        url: 'https://embedded.example',
      },
    ])
      expect(await send({ type: 'SOLID_FORMFILL_REQUEST', fields }, sender)).toEqual({
        values: [],
      });
    expect(fetchCalls).toHaveLength(0);
    expect(createdWindows).toHaveLength(0);
  });
});
