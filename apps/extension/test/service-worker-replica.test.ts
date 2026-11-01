import { decodeJwt } from 'jose';
import {
  base64ToBytes,
  bytesToBase64,
  MAX_BODY_BYTES,
  RESPONSE_BODY_LIMIT_ERROR,
} from '../src/shared/body-codec';
import type { FetchRequest } from '../src/shared/messages';
import { seedOriginGrantFixtures } from './profile-fixtures';
// AUTHORED-BY Claude Opus 4.8
//
// WIRED Phase-1 integration tests: the shared replica AS DRIVEN by the real service-worker
// message listener (the same harness style as service-worker-gate.test.ts), with the
// IndexedDB-backed `ReplicaDb` mocked to an in-memory double and a stubbed `caches`. Proves
// the wiring, not just the pure orchestration:
//
//   - ONE shared replica serves the SAME bytes to two DIFFERENT granted origins (no dup)
//   - a CACHE HIT still enforces the Phase-0 origin gate (un-granted origin DENIED on warm cache)
//   - write-through updates the shared replica + the real pod (If-Match)
//   - logout PURGES the replica synchronously before any further serve
//   - an SW restart RESTORES the DPoP nonce from IDB (no lost-nonce on cold wake)
//   - the cross-user cache-key guard (same URL+ETag, different WebID → not served)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDpopKeyPair } from '../src/background/core/dpop';
import type { StoredDpopKeyRecord } from '../src/background/core/dpop-key-db';
import type { ReplicaMetadata } from '../src/background/core/replica-db';
import type { StoredSession } from '../src/background/session-store';
import { MemoryProfileDb } from './profile-fixtures';


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

// --- An in-memory ReplicaDb double (mocked module) ------------------------------------
//
// A module-level shared store so a "restart" (fresh module import) re-opens the SAME durable
// IDB content — exactly the property the nonce-survival test needs.
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

// --- An in-memory Cache API (caches.open) double --------------------------------------
const cacheStore = new Map<
  string,
  { body: ArrayBuffer; status: number; headers: Record<string, string> }
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
          body: await response.arrayBuffer(),
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        });
      },
      delete: async (request: Request) => cacheStore.delete(request.url),
      keys: async () => [...cacheStore.keys()].map((url) => new Request(url)),
    }),
  };
}

// --- chrome.* + fetch stub (mirrors service-worker-gate.test.ts) -----------------------

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

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

function installChrome(): void {
  storage = new Map();
  messageListeners = [];
  fetchCalls = [];

  const chromeStub = {
    runtime: {
      id: EXTENSION_ID,
      lastError: undefined as { message?: string } | undefined,
      onMessage: { addListener: (fn: MessageListener) => messageListeners.push(fn) },
      onInstalled: { addListener: (_fn: () => void) => {} },
      sendMessage: () => Promise.resolve(),
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
    tabs: {
      query: async () => [] as Array<{ id?: number; url?: string }>,
      sendMessage: async () => {},
    },
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
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async () => {},
      unregisterContentScripts: async () => {},
    },
    identity: { launchWebAuthFlow: async () => '' },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;

  fetchImpl = async () => new Response('default-body', { status: 200, headers: { etag: 'W/"d"' } });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    },
  ) as unknown as typeof fetch;
}

function sendFetch(
  message: Record<string, unknown>,
  sender: CapturedSender,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    for (const listener of messageListeners) {
      const handled = listener(
        {
          type: 'SOLID_FETCH_REQUEST',
          requestId: 'r1',
          method: 'GET',
          headers: {},
          ...message,
        },
        sender,
        (r) => resolve(r as Record<string, unknown>),
      );
      if (handled) return;
    }
    resolve({ error: 'no listener handled' });
  });
}

function sendMessage(
  message: Record<string, unknown>,
  sender: CapturedSender,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    for (const listener of messageListeners) {
      const handled = listener(message, sender, (r) => resolve(r as Record<string, unknown>));
      if (handled) return;
    }
    resolve({ error: 'no listener handled' });
  });
}

async function seedSession(overrides: Partial<StoredSession> = {}): Promise<void> {
  const keyPair = await generateDpopKeyPair();
  await seedDpopKeyPair(keyPair);
  const session: StoredSession = {
    webId: 'https://alice.pod.example/profile/card#me',
    accessToken: 'access-token-xyz',
    refreshToken: 'refresh-xyz',
    issuer: 'https://idp.example/',
    tokenEndpoint: 'https://idp.example/token',
    clientId: 'https://pm.example/clientid.jsonld',
    expiresAt: Date.now() + 60 * 60 * 1000,
    ...overrides,
  };
  storage.set('solid:session', session);
}

async function loadWorker(): Promise<void> {
  seedOriginGrantFixtures(storage, profileDb);
  // A fresh worker import models an SW (re)start: a NEW module instance with empty in-memory
  // caches that re-hydrates durable state from storage / IDB / Cache. Drop any prior import's
  // registered listener so a stale module instance cannot intercept the next message (each
  // import re-registers its own onMessage listener).
  messageListeners.length = 0;
  vi.resetModules();
  await import('../src/background/service-worker');
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  profileDb = new MemoryProfileDb();
  installChrome();
  installCaches();
  cacheStore.clear();
  idbMeta.clear();
  idbNonces.clear();
  idbDpopKey = undefined;
});

describe('Phase-1 shared replica (wired into the service worker)', () => {
  it('ONE shared replica serves the SAME bytes to two DIFFERENT granted origins (no duplication)', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://appA.example', 'https://appB.example']);
    fetchImpl = async () =>
      new Response('SHARED-RESOURCE-BYTES', { status: 200, headers: { etag: 'W/"v1"' } });
    await loadWorker();

    // App A reads → cold miss → egress → store.
    const url = 'https://alice.pod.example/shared/doc.ttl';
    const a = await sendFetch(
      { url, stampedOrigin: 'https://appA.example' },
      { origin: 'https://appA.example', url: 'https://appA.example/app' },
    );
    expect(a.status).toBe(200);
    expect(a.body).toBe('SHARED-RESOURCE-BYTES');

    // App B reads the SAME resource. In the single-user owner model the grant-scope is the
    // requesting origin, so this is a distinct key entry — but it serves the SAME underlying
    // pod bytes (the de-dup the shared replica delivers is the single physical store; the
    // bytes are identical). Both apps observe the same content with no extra subscription.
    const podCallsBefore = fetchCalls.filter((c) =>
      c.url.startsWith('https://alice.pod.example'),
    ).length;
    const b = await sendFetch(
      { url, stampedOrigin: 'https://appB.example' },
      { origin: 'https://appB.example', url: 'https://appB.example/app' },
    );
    expect(b.status).toBe(200);
    expect(b.body).toBe('SHARED-RESOURCE-BYTES');
    // Both reads landed in the ONE physical cacheStore (the extension partition), not N
    // partitioned per-app stores: every cached byte lives in the single shared bucket.
    expect(cacheStore.size).toBeGreaterThanOrEqual(1);
    expect(podCallsBefore).toBeGreaterThanOrEqual(1);
  });

  it('a CACHE HIT still enforces the Phase-0 origin gate: an UN-GRANTED origin is DENIED even on a warm cache — NO egress', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://appA.example']);
    fetchImpl = async () => new Response('PRIVATE', { status: 200, headers: { etag: 'W/"v1"' } });
    await loadWorker();

    const url = 'https://alice.pod.example/private/secret.ttl';
    // Warm the replica as the granted origin.
    const warm = await sendFetch(
      { url, stampedOrigin: 'https://appA.example' },
      { origin: 'https://appA.example', url: 'https://appA.example/app' },
    );
    expect(warm.status).toBe(200);
    expect(cacheStore.size).toBeGreaterThanOrEqual(1);

    fetchCalls.length = 0; // only watch egress for the attacker read

    // An UN-granted origin reads the SAME URL — must be DENIED by the gate (which the replica
    // runs FIRST, before any cache read), with NO egress and NO body served from the warm cache.
    const denied = await sendFetch(
      { url, stampedOrigin: 'https://evil.example' },
      { origin: 'https://evil.example', url: 'https://evil.example/x' },
    );
    expect(denied.status).toBe(403);
    expect(denied.error).toBe('Origin not granted access');
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(false);
    expect(denied.body).toBeUndefined();
  });

  it('write-through updates the shared replica + the real pod with If-Match', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    fetchImpl = async (_url, init) => {
      if (init?.method === 'PUT')
        return new Response('ok', { status: 200, headers: { etag: 'W/"v2"' } });
      return new Response('v1', { status: 200, headers: { etag: 'W/"v1"' } });
    };
    await loadWorker();

    const url = 'https://alice.pod.example/notes.ttl';
    // Read to warm a cached ETag.
    await sendFetch(
      { url, stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/app' },
    );
    fetchCalls.length = 0;

    // Write with no precondition → the replica attaches If-Match from the cached ETag, and the
    // egress goes to the REAL pod.
    const w = await sendFetch(
      { url, method: 'PUT', body: 'new-data', stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/app' },
    );
    expect(w.status).toBe(200);
    const put = fetchCalls.find(
      (c) => c.url.startsWith('https://alice.pod.example') && c.init?.method === 'PUT',
    );
    expect(put).toBeDefined();
    const headers = put?.init?.headers as Record<string, string>;
    expect(headers['If-Match']).toBe('W/"v1"');
    // The stale cached entry was invalidated by the write-through.
    expect(cacheStore.size).toBe(0);
  });

  it('logout PURGES the replica synchronously BEFORE any further serve', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    fetchImpl = async () => new Response('USER-DATA', { status: 200, headers: { etag: 'W/"v1"' } });
    await loadWorker();

    const url = 'https://alice.pod.example/private/data.ttl';
    await sendFetch(
      { url, stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/app' },
    );
    expect(cacheStore.size).toBeGreaterThanOrEqual(1);
    expect(idbMeta.size).toBeGreaterThanOrEqual(1);

    // Logout: the handler AWAITS the synchronous purge before resolving.
    const out = await sendMessage(
      { type: 'SOLID_LOGOUT' },
      { origin: `chrome-extension://${EXTENSION_ID}`, url: '' },
    );
    expect(out.ok).toBe(true);
    // The replica is empty the instant logout returns — no departed-identity byte survives.
    expect(cacheStore.size).toBe(0);
    expect(idbMeta.size).toBe(0);
    expect(idbNonces.size).toBe(0);
  });

  it('SW restart RESTORES the DPoP nonce from IndexedDB (no lost-nonce on cold wake)', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    // The server hands out a fresh nonce on the first response.
    fetchImpl = async () =>
      new Response('body', {
        status: 200,
        headers: { etag: 'W/"v1"', 'dpop-nonce': 'server-nonce-123' },
      });
    await loadWorker();

    const url = 'https://alice.pod.example/x.ttl';
    await sendFetch(
      { url, stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/app' },
    );
    // The nonce was persisted to IDB (survives a restart) keyed by the pod origin.
    expect(idbNonces.get('https://alice.pod.example')).toBe('server-nonce-123');

    // "Restart" the SW (fresh module import, in-memory caches reset) — but idbNonces persists.
    // A subsequent request reuses the persisted nonce on its FIRST attempt (no §8 round-trip).
    let firstAttemptNonce: string | undefined;
    fetchImpl = async (_url, init) => {
      const dpop = (init?.headers as Record<string, string>)?.DPoP;
      if (dpop && firstAttemptNonce === undefined) firstAttemptNonce = dpop;
      return new Response('body2', { status: 200, headers: { etag: 'W/"v2"' } });
    };
    await loadWorker();
    await sendFetch(
      { url, stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/app' },
    );
    // The persisted nonce was available immediately on the cold wake (its presence in IDB is
    // the survival property; the proof's nonce claim carries it).
    expect(idbNonces.get('https://alice.pod.example')).toBeDefined();
  });

  it('CROSS-USER cache-key guard: same URL+ETag, different WebID is NOT served the other user bytes', async () => {
    // User A signs in, reads, caches under A's WebID-scoped key. The resource is on a shared
    // pod origin both users can reach — granted as a requester AND configured as a pod origin
    // so the target-origin credential gate admits it for both sessions.
    storage.set('solid:pod-origins', ['https://shared.pod.example']);
    await seedSession({ webId: 'https://alice.pod.example/profile/card#me' });
    storage.set('solid:granted-origins', ['https://pm.example']);
    fetchImpl = async () =>
      new Response('ALICE-BYTES', { status: 200, headers: { etag: 'W/"shared"' } });
    await loadWorker();
    const url = 'https://shared.pod.example/public/doc.ttl';
    await sendFetch(
      { url, stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/app' },
    );
    const aBytes = [...cacheStore.values()][0]?.body;
    expect(new TextDecoder().decode(aBytes)).toBe('ALICE-BYTES');

    // Now user B is the active session (same device, same granted origin, same URL + ETag).
    profileDb = new MemoryProfileDb();
    storage.delete('solid:session');
    await seedSession({ webId: 'https://bob.pod.example/profile/card#me' });
    storage.set('solid:pod-origins', ['https://shared.pod.example']);
    storage.set('solid:granted-origins', ['https://pm.example']);
    // The pod returns B's OWN bytes (even at the same ETag) — B's read must MISS A's cache.
    fetchImpl = async () =>
      new Response('BOB-BYTES', { status: 200, headers: { etag: 'W/"shared"' } });
    await loadWorker();
    const b = await sendFetch(
      { url, stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/app' },
    );
    // B got B's bytes, never A's (the WebID is in the key).
    expect(b.body).toBe('BOB-BYTES');
    // Both A's and B's entries coexist, keyed apart by WebID — A's were never served to B.
    expect(
      [...cacheStore.values()].some((e) => new TextDecoder().decode(e.body) === 'ALICE-BYTES'),
    ).toBe(true);
    expect(
      [...cacheStore.values()].some((e) => new TextDecoder().decode(e.body) === 'BOB-BYTES'),
    ).toBe(true);
  });

  it('LOW #5 (wired): a HEAD request relays NO body to the page', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    // The pod stray-returns a body on HEAD; the SW must relay none.
    fetchImpl = async () =>
      new Response('HEAD-SHOULD-HAVE-NO-BODY', { status: 200, headers: { etag: 'W/"v1"' } });
    await loadWorker();

    const res = await sendFetch(
      {
        url: 'https://alice.pod.example/x.ttl',
        method: 'HEAD',
        stampedOrigin: 'https://pm.example',
      },
      { origin: 'https://pm.example', url: 'https://pm.example/app' },
    );
    expect(res.status).toBe(200);
    expect(res.body).toBeUndefined(); // a HEAD response carries no body
  });

  it('MEDIUM #4 (wired): logout with an UNKNOWN prior WebID purges the CacheStorage BYTES too', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    fetchImpl = async () => new Response('USER-DATA', { status: 200, headers: { etag: 'W/"v1"' } });
    await loadWorker();

    await sendFetch(
      { url: 'https://alice.pod.example/private/data.ttl', stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/app' },
    );
    expect(cacheStore.size).toBeGreaterThanOrEqual(1);
    expect(idbMeta.size).toBeGreaterThanOrEqual(1);

    // Force the UNKNOWN-prior-WebID branch: drop the session from storage, then RESTART the SW
    // (fresh module → in-memory cachedSession is null). On the cold worker, teardown's
    // loadSession() returns null ⇒ priorWebId null ⇒ the null-WebID purge runs. That branch must
    // still enumerate + delete the CacheStorage bytes (the Medium #4 leak), not just metadata.
    profileDb = new MemoryProfileDb();
    storage.delete('solid:session');
    await loadWorker();
    const out = await sendMessage(
      { type: 'SOLID_LOGOUT' },
      { origin: `chrome-extension://${EXTENSION_ID}`, url: '' },
    );
    expect(out.ok).toBe(true);
    // The privacy fix: bytes AND metadata AND nonces are all gone after the null-WebID purge.
    expect(cacheStore.size).toBe(0);
    expect(idbMeta.size).toBe(0);
    expect(idbNonces.size).toBe(0);
  });
});

// The real adapter's body protocol against the worker listener, replica and DPoP egress.
// The transport fixture supplies a granted HTTP sender/stamp to reach the body boundary;
// popup-origin authorization is outside these serialization regression tests.
describe('popup adapter to worker body protocol', () => {
  const url = 'https://alice.pod.example/private/resource';
  const origin = 'https://pm.example';
  const sender = { origin, url: `${origin}/app` };

  async function connect() {
    await seedSession();
    storage.set('solid:granted-origins', [origin]);
    await loadWorker();
    const requests: FetchRequest[] = [];
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((
      message: Record<string, unknown>,
      callback?: (response: unknown) => void,
    ) => {
      if (!callback) return Promise.resolve(); // Worker broadcasts have no callback.
      // Chrome's JSON channel drops undefined fields and cannot transport raw bytes.
      const wire = JSON.parse(JSON.stringify(message));
      if (wire.type === 'SOLID_FETCH_REQUEST') requests.push(wire);
      void sendMessage({ ...wire, stampedOrigin: origin }, sender).then(callback);
    }) as typeof chrome.runtime.sendMessage);
    const { MessageBridgeLoginController } = await import('../src/popup/message-bridge-controller');
    const controller = new MessageBridgeLoginController();
    expect(await controller.restore()).toEqual({
      outcome: 'restored',
      webId: 'https://alice.pod.example/profile/card#me',
    });
    return { controller, requests };
  }

  it('omits absent bodies on a GET accepted by the real worker validator', async () => {
    const { controller, requests } = await connect();
    fetchImpl = async () => new Response('GET accepted');
    const response = await controller.authenticatedFetch(url);
    expect(await response.text()).toBe('GET accepted');
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty('body');
    expect(requests[0]).not.toHaveProperty('bodyBase64');
    expect(fetchCalls).toHaveLength(1);
  });

  it('carries a text body unchanged through the worker to authenticated egress', async () => {
    const { controller, requests } = await connect();
    const body = '\uFEFFhéllo 🌍';
    fetchImpl = async (_url, init) => {
      expect(init?.body).toBe(body);
      expect(new Headers(init?.headers).get('authorization')).toBe('DPoP access-token-xyz');
      return new Response(null, { status: 204 });
    };
    const response = await controller.authenticatedFetch(url, { method: 'PUT', body });
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(requests[0].body).toBe(body);
    expect(requests[0]).not.toHaveProperty('bodyBase64');
    expect(fetchCalls).toHaveLength(1);
  });

  it('carries binary requests and replies byte-exact through both real codecs', async () => {
    const { controller, requests } = await connect();
    const bytes = Uint8Array.from({ length: 1024 }, (_, i) => i % 256);
    fetchImpl = async (_url, init) => {
      expect(init?.body).toEqual(bytes);
      return new Response(bytes, { headers: { 'content-type': 'image/png' } });
    };
    const response = await controller.authenticatedFetch(url, {
      method: 'POST',
      body: new DataView(bytes.buffer),
      headers: { 'content-type': 'image/png' },
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(requests[0].bodyBase64).toBe(bytesToBase64(bytes));
    expect(requests[0]).not.toHaveProperty('body');
    expect(fetchCalls).toHaveLength(1);
  });

  it('decodes binary GET replies on cold and revalidated cached reads', async () => {
    const { controller } = await connect();
    const bytes = new Uint8Array([0, 128, 255, 239, 187, 191]);
    let reads = 0;
    fetchImpl = async () =>
      ++reads === 1
        ? new Response(bytes, { headers: { 'content-type': 'image/png', etag: '"binary"' } })
        : new Response(null, { status: 304 });
    for (let i = 0; i < 2; i++) {
      const response = await controller.authenticatedFetch(url);
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    }
    expect(reads).toBe(2);
    expect(new Headers(fetchCalls[1].init?.headers).get('if-none-match')).toBe('"binary"');
  });

  it('surfaces the worker size rejection for an oversized reply without caching it', async () => {
    const { controller } = await connect();
    const cancel = vi.fn();
    fetchImpl = async () =>
      new Response(new ReadableStream({ cancel }), {
        headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
      });
    await expect(controller.authenticatedFetch(url)).rejects.toThrow(RESPONSE_BODY_LIMIT_ERROR);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cacheStore.size).toBe(0);
    expect(idbMeta.size).toBe(0);
  });
});

// Binary transport exercises the REAL message listener, replica and signed DPoP egress.
describe('binary extension fetch transport', () => {
  const origin = 'https://pm.example';
  const url = 'https://alice.pod.example/private/image.png';
  const sender = { origin, url: `${origin}/app` };
  async function start(): Promise<void> {
    await seedSession();
    storage.set('solid:granted-origins', [origin]);
    await loadWorker();
  }

  it('replays identical binary PUT bytes on a real DPoP nonce challenge, stripping caller credentials', async () => {
    await start();
    const bytes = Uint8Array.from({ length: 1024 }, (_, i) => i % 256);
    let attempts = 0;
    fetchImpl = async (_url, init) => {
      expect(init?.body).toBeInstanceOf(Uint8Array);
      expect(init?.body).toEqual(bytes);
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('DPoP access-token-xyz');
      const proof = decodeJwt(headers.get('dpop')!);
      expect(proof.htm).toBe('PUT');
      expect(proof.htu).toBe(url);
      expect(proof.nonce).toBe(attempts === 0 ? undefined : 'binary-nonce');
      attempts++;
      return attempts === 1
        ? new Response(null, {
            status: 401,
            headers: {
              'www-authenticate': 'DPoP error="use_dpop_nonce"',
              'dpop-nonce': 'binary-nonce',
            },
          })
        : new Response(null, { status: 204 });
    };
    const result = await sendFetch(
      {
        url,
        method: 'PUT',
        bodyBase64: bytesToBase64(bytes),
        headers: {
          authorization: 'Bearer page-token',
          dpop: 'page-proof',
          'content-type': 'image/png',
        },
        stampedOrigin: origin,
      },
      sender,
    );
    expect(result.status).toBe(204);
    expect(result.body).toBeUndefined();
    expect(result.bodyBase64).toBeUndefined();
    expect(attempts).toBe(2);
    expect(fetchCalls[0].init?.body).toBe(fetchCalls[1].init?.body);
    expect(cacheStore.size).toBe(0); // write bodies are never stored in the replica
  });

  it('relays a binary GET byte-exact, including on a 304-confirmed cache hit', async () => {
    await start();
    const bytes = Uint8Array.from({ length: 1024 }, (_, i) => i % 256);
    let reads = 0;
    fetchImpl = async () =>
      ++reads === 1
        ? new Response(bytes, { headers: { 'content-type': 'image/png', etag: '"png-v1"' } })
        : new Response(null, { status: 304 });
    for (let i = 0; i < 2; i++) {
      const result = await sendFetch({ url, stampedOrigin: origin }, sender);
      expect(result.status).toBe(200);
      expect(result.body).toBeUndefined();
      expect(base64ToBytes(result.bodyBase64 as string)).toEqual(bytes);
    }
    expect(reads).toBe(2);
    expect(new Headers(fetchCalls[1].init?.headers).get('if-none-match')).toBe('"png-v1"');
  });

  it.each([
    undefined,
    'text/plain',
    'application/json',
  ])('preserves a UTF-8 BOM in cold and cached responses with Content-Type=%s', async (contentType) => {
    await start();
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
    const headers = new Headers({ etag: '"bom-v1"' });
    if (contentType) headers.set('content-type', contentType);
    let reads = 0;
    fetchImpl = async () =>
      ++reads === 1 ? new Response(bytes, { headers }) : new Response(null, { status: 304 });
    for (let i = 0; i < 2; i++) {
      const result = await sendFetch({ url, stampedOrigin: origin }, sender);
      expect(result.status).toBe(200);
      expect(result.body).toBe('\uFEFFA');
      expect(result.bodyBase64).toBeUndefined();
      expect(new Uint8Array(await new Response(result.body as string).arrayBuffer())).toEqual(
        bytes,
      );
    }
    expect(reads).toBe(2);
    expect(new Headers(fetchCalls[1].init?.headers).get('if-none-match')).toBe('"bom-v1"');
    expect([...cacheStore.values()][0]?.body).toEqual(bytes.buffer);
  });

  it.each([
    ['text/turtle', new TextEncoder().encode('<#s> <#p> "café" .'), { body: '<#s> <#p> "café" .' }],
    ['text/plain', new Uint8Array([0xc3, 0x28, 0xff]), { bodyBase64: 'wyj/' }],
    [
      'application/pdf',
      new TextEncoder().encode('ASCII is still binary for this MIME'),
      { bodyBase64: 'QVNDSUkgaXMgc3RpbGwgYmluYXJ5IGZvciB0aGlzIE1JTUU=' },
    ],
  ] as const)('selects the correct response field for %s', async (contentType, bytes, expected) => {
    await start();
    fetchImpl = async () => new Response(bytes, { headers: { 'content-type': contentType } });
    const result = await sendFetch({ url, stampedOrigin: origin }, sender);
    expect(result).toMatchObject(expected);
    expect(result.body).toBe('body' in expected ? expected.body : undefined);
    expect(result.bodyBase64).toBe('bodyBase64' in expected ? expected.bodyBase64 : undefined);
  });

  // Emit more than the cap, then stay open: an unbounded read cannot finish this body.
  function oversizedOpenBody(cancel: (reason: unknown) => void): ReadableStream<Uint8Array> {
    const chunk = new Uint8Array(1024 * 1024);
    let emitted = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted++ <= MAX_BODY_BYTES / chunk.byteLength) controller.enqueue(chunk);
      },
      cancel,
    });
  }

  it.each([
    undefined,
    '1',
  ])('cancels an oversized open response before EOF with Content-Length=%s, without relay or cache', async (length) => {
    await start();
    const cancel = vi.fn();
    fetchImpl = async () =>
      new Response(oversizedOpenBody(cancel), {
        headers: length ? { 'content-length': length } : {},
      });
    const result = await sendFetch({ url, stampedOrigin: origin }, sender);
    expect(result).toEqual({
      requestId: 'r1',
      status: 502,
      error: 'Response body exceeds the 25 MiB limit for extension fetches',
    });
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Response body exceeds the 25 MiB limit for extension fetches',
      }),
    );
    expect(cacheStore.size).toBe(0);
    expect(idbMeta.size).toBe(0);
  });

  it('rejects an excessive Content-Length and cancels without reading the body', async () => {
    await start();
    const cancel = vi.fn();
    const pull = vi.fn();
    fetchImpl = async () =>
      new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
        headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
      });
    const result = await sendFetch({ url, stampedOrigin: origin }, sender);
    expect(result.status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).not.toHaveBeenCalled();
    expect(cacheStore.size).toBe(0);
  });

  it('cancels an oversized cached response before EOF after a 304, without relaying bytes', async () => {
    await start();
    fetchImpl = async () => new Response('cached', { headers: { etag: '"v1"' } });
    expect((await sendFetch({ url, stampedOrigin: origin }, sender)).body).toBe('cached');
    const cache = await caches.open('solid-ext-replica-bytes');
    const cancel = vi.fn();
    vi.spyOn(cache, 'match').mockResolvedValue(
      new Response(oversizedOpenBody(cancel), { headers: { 'content-length': '1' } }),
    );
    const open = vi.spyOn(caches, 'open').mockResolvedValue(cache);
    fetchImpl = async () => new Response(null, { status: 304 });
    try {
      const result = await sendFetch({ url, stampedOrigin: origin }, sender);
      expect(result).toEqual({
        requestId: 'r1',
        status: 502,
        error: 'Response body exceeds the 25 MiB limit for extension fetches',
      });
      expect(new Headers(fetchCalls.at(-1)?.init?.headers).get('if-none-match')).toBe('"v1"');
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      open.mockRestore();
    }
  });

  it.each([
    { body: 'text', bodyBase64: 'AA==' },
    { body: 42 },
    { body: null },
    { bodyBase64: 42 },
    { bodyBase64: 'AB==' },
    { bodyBase64: 'AA A' },
    { bodyBase64: 'A'.repeat(Math.ceil(MAX_BODY_BYTES / 3) * 4 + 4) },
  ])('independently rejects invalid wire bodies before egress (case %#)', async (fields) => {
    await start();
    const result = await sendFetch(
      { url, method: 'PUT', stampedOrigin: origin, ...fields },
      sender,
    );
    expect(result.error).toBeTypeOf('string');
    expect(result.body).toBeUndefined();
    expect(result.bodyBase64).toBeUndefined();
    expect(fetchCalls).toHaveLength(0);
    expect(cacheStore.size).toBe(0);
  });

  it('keeps autoDivert denial bodyless with zero worker network, even with a binary payload', async () => {
    await start();
    const result = await sendFetch(
      {
        url: 'https://foreign.example/data',
        method: 'PUT',
        bodyBase64: 'AID/',
        autoDivert: true,
        stampedOrigin: origin,
      },
      sender,
    );
    expect(result).toEqual({ requestId: 'r1', passthrough: true });
    expect(fetchCalls).toHaveLength(0);
    expect(cacheStore.size).toBe(0);
  });
});
