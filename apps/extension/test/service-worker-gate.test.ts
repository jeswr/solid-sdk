// AUTHORED-BY Claude Opus 4.8
//
// INTEGRATION tests for the Phase-0 per-requesting-origin gate AS WIRED INTO the service
// worker. These drive the REAL `chrome.runtime.onMessage` listener the worker registers,
// with an in-memory `chrome.storage.local` and a captured `fetch`, proving the wiring — not
// just the pure gate logic (covered in requesting-origin.test.ts):
//
//   - a forged/mismatched sender.origin vs the page stamp → DENY, NO pod egress
//   - an un-granted origin attempting a whole-pod read → DENY, NO egress
//   - app-A requesting app-B-only data (A un-granted) → DENY
//   - opaque/null origin → DENY (fail-safe)
//   - a boot/SW-restart race (grant store not yet populated) → fail-CLOSED
//   - the legitimate single-user owner path (granted origin) → SUCCEEDS with egress
//   - login from an app origin GRANTS that origin (the opt-in), unlocking subsequent fetches
//   - SOLID_GET_STATE withholds the WebID (PII) from a non-granted page, exposes to granted

import * as jose from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDpopKeyPair } from '../src/background/core/dpop';
import type { StoredDpopKeyRecord } from '../src/background/core/dpop-key-db';
import { ProfileStore } from '../src/background/core/profile-store';
import type { ReplicaMetadata } from '../src/background/core/replica-db';
import type { StoredSession } from '../src/background/session-store';
import { fixtureGrant, MemoryProfileDb, profileCredentials } from './profile-fixtures';

let profileDb: MemoryProfileDb;
vi.mock('../src/background/profile-db', () => ({
  ProfileDb: { open: async () => profileDb },
}));

// --- An in-memory DpopKeyDb double (Phase-2 security hardening) -----------------------
// The DPoP private key is no longer carried inline on `StoredSession` — it lives as a
// non-extractable `CryptoKeyPair` in its own IndexedDB store (`core/dpop-key-db.ts`). Fake it
// the same way as the replica DB below: a module-level single-record store so a simulated SW
// "restart" (fresh module import) re-opens the SAME durable key.
let idbDpopKey: StoredDpopKeyRecord | undefined;
/** Set to simulate a TRANSIENT failure (IndexedDB open error, a bug) on EVERY `get()` until
 *  explicitly cleared (not one-shot — a real cold-wake failure would keep failing `get()`
 *  calls until the underlying condition clears, not just the first one). */
let idbDpopKeyGetError: Error | null = null;
class FakeDpopKeyDb {
  static async open() {
    return new FakeDpopKeyDb();
  }
  async get() {
    if (idbDpopKeyGetError) throw idbDpopKeyGetError;
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

/** Persist a keypair into the fake DPoP key store, as `mintAndPersistDpopKeyPair` would. */
async function seedDpopKeyPair(keyPair: CryptoKeyPair): Promise<void> {
  idbDpopKey = {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicJwk: (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey,
  };
}

// --- In-memory replica stores (Phase 1) -----------------------------------------------
// The fetch path now routes through the shared replica, which opens IndexedDB (metadata +
// nonce) and the Cache API. Stub both so the Phase-0 gate assertions below run unchanged:
// a DENY must still produce NO egress, an ALLOW must still reach the pod with the token.
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

// --- An in-memory chrome.* stub + a captured fetch ------------------------------------

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
    identity: { launchWebAuthFlow: async () => '' },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;

  // A captured global fetch: default deny-with-401 so an UNGATED egress is observable.
  fetchImpl = async () => new Response('ok', { status: 200 });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    },
  ) as unknown as typeof fetch;
}

/** Drive the worker's registered SOLID_FETCH_REQUEST listener and await its response. */
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
          body: null,
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
    expiresAt: Date.now() + 60 * 60 * 1000, // far in the future: no refresh needed
    ...overrides,
  };
  storage.set('solid:session', session);
}

/**
 * Fresh module + chrome per test (the worker registers listeners + state at import). Drop
 * any PRIOR module instance's registered listener first — this matters when a single test
 * calls `loadWorker()` more than once to model an SW restart mid-test (e.g. the transient
 * DPoP-key-store-failure test below): without clearing it, the stale listener stays in
 * `messageListeners` alongside the new one, and `sendMessage`/`sendFetch` would dispatch to
 * whichever handles first — silently serving the OLD (already-cached-key) instance's
 * response instead of exercising the new one.
 */
async function loadWorker(): Promise<void> {
  messageListeners.length = 0;
  vi.resetModules();
  await import('../src/background/service-worker');
  // Let the import-time ensureSession()/icon promise settle.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.doUnmock('../src/background/auth-flow');
  profileDb = new MemoryProfileDb();
  installChrome();
  installCaches();
  cacheStore.clear();
  idbMeta.clear();
  idbNonces.clear();
  idbDpopKey = undefined;
  idbDpopKeyGetError = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Exercise the real asynchronous icon renderer without a browser canvas. */
function installIconCanvas(): void {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        private readonly width: number,
        private readonly height: number,
      ) {}
      getContext() {
        return {
          beginPath() {},
          roundRect() {},
          fill() {},
          fillText() {},
          save() {},
          arc() {},
          clip() {},
          drawImage() {},
          restore() {},
          getImageData: () => ({
            width: this.width,
            height: this.height,
            data: new Uint8ClampedArray(4),
          }),
        };
      }
    },
  );
  vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
}

describe('service-worker per-requesting-origin gate (wired)', () => {
  it('the legitimate owner path: a GRANTED app reads its pod → SUCCEEDS with egress', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://alice.pod.example/private/notes.ttl', stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/app.html' },
    );

    expect(res.status).toBe(200);
    // The token-bearing egress to the pod actually happened.
    const podCall = fetchCalls.find((c) => c.url.startsWith('https://alice.pod.example'));
    expect(podCall).toBeDefined();
    const headers = podCall?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('DPoP access-token-xyz');
  });

  it('a TRANSIENT DPoP-key-store failure fails ONE request soft — no destructive teardown', async () => {
    // roborev round-1 (b64367d) Medium: ensureSession() must not conflate an unexpected
    // IndexedDB/crypto failure with a genuinely broken session (DpopKeyUnavailableError) —
    // the former must fail this one request without clearing the stored session/tokens, so
    // a later, working request still succeeds without a fresh login.
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker(); // normal cold wake: caches the keypair once

    // A fresh SW "restart" (new module instance, empty in-memory caches) that happens to hit
    // a transient DB-open failure on its cold-wake key load — set BEFORE the restart so it
    // also covers the import-time `ensureSession()` call `loadWorker()` triggers.
    profileDb.error = new Error('simulated IndexedDB open failure');
    await loadWorker();
    const failed = await sendFetch(
      { url: 'https://alice.pod.example/private/notes.ttl', stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/app.html' },
    );
    expect(failed.status).not.toBe(200);
    // No pod egress happened for the failed attempt.
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(false);
    // Crucially: the session was NOT torn down — it is still in storage, untouched.
    expect(profileDb.state.records[0].session).not.toBeNull();

    // The transient condition clears (no restart needed — `cachedKeyPair` was never
    // populated by the failed attempts, so the very next call retries the DB read).
    profileDb.error = null;
    const ok = await sendFetch(
      { url: 'https://alice.pod.example/private/notes.ttl', stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/app.html' },
    );
    expect(ok.status).toBe(200);
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(true);
  });

  it('a credential-origin app (served FROM the pod) reads without a separate grant', async () => {
    await seedSession();
    // no explicit grants — the pod origin is auto-granted as a requester.
    await loadWorker();
    const res = await sendFetch(
      { url: 'https://alice.pod.example/x.ttl', stampedOrigin: 'https://alice.pod.example' },
      { origin: 'https://alice.pod.example', url: 'https://alice.pod.example/app' },
    );
    expect(res.status).toBe(200);
  });

  it('DENIES a FORGED sender.origin (renderer spoofs a granted origin) — NO egress', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();

    const res = await sendFetch(
      // The page stamps the granted origin, but the browser attests the attacker's.
      { url: 'https://alice.pod.example/private/notes.ttl', stampedOrigin: 'https://pm.example' },
      { origin: 'https://attacker.example', url: 'https://attacker.example/x' },
    );

    expect(res.status).toBe(403);
    expect(res.error).toBe('Forbidden origin');
    // CRITICAL: no request to the pod was ever made.
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(false);
  });

  it('DENIES an UN-GRANTED origin attempting a whole-pod read — NO egress', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://alice.pod.example/', stampedOrigin: 'https://evil.example' },
      { origin: 'https://evil.example', url: 'https://evil.example/x' },
    );

    expect(res.status).toBe(403);
    expect(res.error).toBe('Origin not granted access');
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(false);
  });

  it('DENIES app-A reading app-B-only data when A is not granted — NO egress', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://appB.example']); // only B
    await loadWorker();

    const res = await sendFetch(
      {
        url: 'https://alice.pod.example/appB-data/secret.ttl',
        stampedOrigin: 'https://appA.example',
      },
      { origin: 'https://appA.example', url: 'https://appA.example/x' },
    );

    expect(res.status).toBe(403);
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(false);
  });

  it('DENIES an opaque/null requesting origin (fail-safe) — NO egress', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://alice.pod.example/x', stampedOrigin: 'null' },
      { origin: 'null', url: 'about:blank' },
    );

    expect(res.status).toBe(403);
    expect(res.error).toBe('Forbidden origin');
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(false);
  });

  it('FAIL-CLOSED on a boot/SW-restart race: a request that arrives before the grant store is populated is DENIED', async () => {
    // Session exists, but the granted-origins store is EMPTY (e.g. a cold wake before the
    // owner has opted any web app in). pm.example is NOT a credential origin, so default-deny.
    await seedSession();
    // No 'solid:granted-origins' key set at all.
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://alice.pod.example/private/notes.ttl', stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/x' },
    );

    expect(res.status).toBe(403);
    expect(res.error).toBe('Origin not granted access');
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(false);
  });

  it('DENIES a granted app proxying to an unrelated FOREIGN third party — NO egress to it', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://tracker.example/collect', stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/x' },
    );

    expect(res.status).toBe(403);
    expect(res.error).toBe('Cross-origin fetch denied');
    expect(fetchCalls.some((c) => c.url.startsWith('https://tracker.example'))).toBe(false);
  });

  it('DENIES a PRESENT-but-OPAQUE sender.origin ("null") with a normal https sender.url — NO egress (High #1)', async () => {
    // The High #1 exploit wired through the SW: an opaque/sandboxed frame whose sender.origin is
    // the string "null" but whose sender.url is a normal https URL that matches the stamp. The
    // old fail-open would have laundered it into the granted origin and served credentials.
    await seedSession();
    storage.set('solid:granted-origins', ['https://app.example']);
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://alice.pod.example/private/notes.ttl', stampedOrigin: 'https://app.example' },
      { origin: 'null', url: 'https://app.example/page.html' },
    );

    expect(res.status).toBe(403);
    expect(res.error).toBe('Forbidden origin');
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(false);
  });

  it('STILL allows a sender with ABSENT origin but a valid https url + matching stamp (legit fallback)', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://app.example']);
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://alice.pod.example/private/notes.ttl', stampedOrigin: 'https://app.example' },
      { url: 'https://app.example/page.html' }, // no origin field → ABSENT → derive from url
    );

    expect(res.status).toBe(200);
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(true);
  });

  it('returns "Not authenticated" with NO gate egress when there is no session', async () => {
    // No session seeded.
    await loadWorker();
    const res = await sendFetch(
      { url: 'https://alice.pod.example/x', stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/x' },
    );
    expect(res.error).toBe('Not authenticated');
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(false);
  });
});

describe('login GRANTS the requesting origin ONLY on success (privilege-escalation guard)', () => {
  // High #2: the grant must be persisted ONLY AFTER a successful, owner-approved login — never
  // before initiateLogin. In these tests the real OIDC flow has no IdP, so initiateLogin THROWS;
  // therefore a SOLID_LOGIN here represents a CANCELLED/FAILED login and must leave the grant
  // store UNCHANGED. The success path is covered separately by mocking initiateLogin.

  it('does NOT grant the requesting origin when initiateLogin fails/cancels', async () => {
    await loadWorker();
    const res = await sendMessage(
      {
        type: 'SOLID_LOGIN',
        webId: 'https://alice.pod.example/card#me',
        origin: 'https://newapp.example',
      },
      { origin: 'https://newapp.example', url: 'https://newapp.example/x' },
    );
    // The login failed (no IdP) ...
    expect(res.error).toBeDefined();
    // ... so NO grant was persisted (the privilege-escalation fix).
    const grants = (profileDb.state.records[0]?.grantedOrigins as string[]) ?? [];
    expect(grants).not.toContain('https://newapp.example');
  });

  it('a FAILED/CANCELLED login leaves the grant store UNCHANGED and a later fetch from that origin is DENIED even when a session EXISTS', async () => {
    // The attack High #2 closes: a session already exists for the user; a hostile page sends
    // SOLID_LOGIN (which it cancels/fails), then tries SOLID_FETCH_REQUEST to ride the existing
    // credentials. The cancelled login must NOT have granted the page.
    await seedSession(); // a live session already exists
    // No grant for the hostile origin.
    await loadWorker();

    // Step 1: the hostile page drives a login that fails (no IdP).
    const loginRes = await sendMessage(
      {
        type: 'SOLID_LOGIN',
        webId: 'https://alice.pod.example/card#me',
        origin: 'https://hostile.example',
      },
      { origin: 'https://hostile.example', url: 'https://hostile.example/x' },
    );
    expect(loginRes.error).toBeDefined();
    const grants = (profileDb.state.records[0]?.grantedOrigins as string[]) ?? [];
    expect(grants).not.toContain('https://hostile.example');

    // The failing OIDC flow itself may make network calls (discovery/profile) on the raw fetch;
    // those are NOT the gated egress we're asserting about. Reset the captured calls so the next
    // assertion concerns ONLY the credential-attaching SOLID_FETCH_REQUEST egress.
    fetchCalls.length = 0;

    // Step 2: the hostile page now tries to read the existing session's pod. DENIED — no grant,
    // so NO credential-attaching egress to the pod from the gated fetch path.
    const fetchRes = await sendFetch(
      {
        url: 'https://alice.pod.example/private/notes.ttl',
        stampedOrigin: 'https://hostile.example',
      },
      { origin: 'https://hostile.example', url: 'https://hostile.example/x' },
    );
    expect(fetchRes.status).toBe(403);
    expect(fetchRes.error).toBe('Origin not granted access');
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(false);
  });

  it('a SUCCESSFUL login GRANTS the verified origin and a subsequent fetch SUCCEEDS', async () => {
    // Mock initiateLogin to succeed, returning a fresh session, so we exercise the success path
    // where the grant SHOULD now be persisted. The real `completeLogin` would also have called
    // `mintAndPersistDpopKeyPair` — seed the fake DPoP key store the same way.
    const keyPair = await generateDpopKeyPair();
    await seedDpopKeyPair(keyPair);
    const session: StoredSession = {
      webId: 'https://alice.pod.example/profile/card#me',
      accessToken: 'access-token-xyz',
      refreshToken: 'refresh-xyz',
      issuer: 'https://idp.example/',
      tokenEndpoint: 'https://idp.example/token',
      clientId: 'https://newapp.example/clientid.jsonld',
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
    vi.doMock('../src/background/auth-flow', () => ({
      initiateLogin: vi.fn(async () => ({ session, keyPair, name: 'Alice', photoUrl: null })),
      refreshSession: vi.fn(async (s: StoredSession) => s),
    }));
    await loadWorker();

    const loginRes = await sendMessage(
      {
        type: 'SOLID_LOGIN',
        webId: 'https://alice.pod.example/card#me',
        origin: 'https://newapp.example',
      },
      { origin: 'https://newapp.example', url: 'https://newapp.example/x' },
    );
    expect(loginRes.ok).toBe(true);
    const grants = (profileDb.state.records[0]?.grantedOrigins as string[]) ?? [];
    expect(grants).toContain('https://newapp.example');

    // The now-granted origin can read its pod.
    const fetchRes = await sendFetch(
      {
        url: 'https://alice.pod.example/private/notes.ttl',
        stampedOrigin: 'https://newapp.example',
      },
      { origin: 'https://newapp.example', url: 'https://newapp.example/app.html' },
    );
    expect(fetchRes.status).toBe(200);
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(true);
    vi.doUnmock('../src/background/auth-flow');
  });

  it('does NOT grant a FORGED login origin even on success (sender ≠ stamp)', async () => {
    const keyPair = await generateDpopKeyPair();
    await seedDpopKeyPair(keyPair);
    const session: StoredSession = {
      webId: 'https://alice.pod.example/profile/card#me',
      accessToken: 'access-token-xyz',
      refreshToken: 'refresh-xyz',
      issuer: 'https://idp.example/',
      tokenEndpoint: 'https://idp.example/token',
      clientId: 'https://newapp.example/clientid.jsonld',
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
    vi.doMock('../src/background/auth-flow', () => ({
      initiateLogin: vi.fn(async () => ({ session, keyPair, name: 'Alice', photoUrl: null })),
      refreshSession: vi.fn(async (s: StoredSession) => s),
    }));
    await loadWorker();

    await sendMessage(
      {
        type: 'SOLID_LOGIN',
        webId: 'https://alice.pod.example/card#me',
        origin: 'https://victim.example', // stamp claims the victim
      },
      { origin: 'https://attacker.example', url: 'https://attacker.example/x' }, // real sender
    );
    const grants = (profileDb.state.records[0]?.grantedOrigins as string[]) ?? [];
    // The forged origin resolves to null → no grant for victim OR attacker, even on success.
    expect(grants).not.toContain('https://victim.example');
    expect(grants).not.toContain('https://attacker.example');
    vi.doUnmock('../src/background/auth-flow');
  });
});

describe('SOLID_GET_STATE scopes the WebID (PII) to granted origins', () => {
  it('WITHHOLDS the WebID from a non-granted web page', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();

    const res = await sendMessage(
      { type: 'SOLID_GET_STATE', stampedOrigin: 'https://random.example' },
      { origin: 'https://random.example', url: 'https://random.example/x' },
    );
    expect(res.webId).toBeNull();
    expect(res.isActive).toBe(false);
    expect(res.recentAccounts).toEqual([]);
  });

  it('EXPOSES the WebID to a granted web page', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();

    const res = await sendMessage(
      { type: 'SOLID_GET_STATE', stampedOrigin: 'https://pm.example' },
      { origin: 'https://pm.example', url: 'https://pm.example/x' },
    );
    expect(res.webId).toBe('https://alice.pod.example/profile/card#me');
    expect(res.isActive).toBe(true);
  });

  it('gives the EXTENSION popup (own context) the full state incl. recent accounts', async () => {
    await seedSession();
    storage.set('solid:recent-accounts', [
      { webId: 'https://alice.pod.example/card#me', name: 'Alice', photoUrl: null },
    ]);
    await loadWorker();

    const res = await sendMessage(
      { type: 'SOLID_GET_STATE' }, // popup sends no stampedOrigin
      {
        origin: `chrome-extension://${EXTENSION_ID}`,
        url: `chrome-extension://${EXTENSION_ID}/popup/popup.html`,
      },
    );
    expect(res.webId).toBe('https://alice.pod.example/profile/card#me');
    expect((res.recentAccounts as unknown[]).length).toBe(1);
  });

  it('WITHHOLDS the WebID from a FORGED state request (sender ≠ stamp)', async () => {
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();

    const res = await sendMessage(
      { type: 'SOLID_GET_STATE', stampedOrigin: 'https://pm.example' }, // claims granted
      { origin: 'https://attacker.example', url: 'https://attacker.example/x' }, // real sender
    );
    expect(res.webId).toBeNull();
  });
});

describe('Round-2 HIGH #1: autoDivert returns a PASSTHROUGH SENTINEL — the SW does ZERO network (no cross-origin proxy)', () => {
  it('an autoDivert fetch to a NON-POD third party → sentinel { passthrough:true }, NO SW fetch (NOT a 403, NO bytes)', async () => {
    // The round-2 fix: an app calls a third-party API/CDN. The global-fetch patch routes it
    // (autoDivert=true). The SW gate denies (foreign target). The SW must NOT fetch it itself
    // (that would make the extension a cross-origin read proxy via its <all_urls> perms) — it
    // returns a passthrough SENTINEL with no body/status, and the page completes it natively.
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    fetchImpl = async () => new Response('third-party-json', { status: 200 });
    await loadWorker();

    const res = await sendFetch(
      {
        url: 'https://api.thirdparty.example/data',
        stampedOrigin: 'https://pm.example',
        autoDivert: true,
      },
      { origin: 'https://pm.example', url: 'https://pm.example/app.html' },
    );

    // The SW returned ONLY the sentinel — no body, no status, no fetched bytes.
    expect(res.passthrough).toBe(true);
    expect(res.body).toBeUndefined();
    expect(res.status).toBeUndefined();
    expect(res.error).toBeUndefined();
    // CRITICAL (cross-origin-proxy hole closed): the SW performed NO fetch to the third party.
    expect(fetchCalls.some((c) => c.url.startsWith('https://api.thirdparty.example'))).toBe(false);
  });

  it('SECURITY: a page CANNOT use the extension as a cross-origin read proxy — no autoDivert deny ever triggers an SW fetch', async () => {
    // The exact round-2 exploit: a hostile page postMessages an autoDivert request for a
    // cross-origin resource CORS would block. The SW must never fetch it and return its bytes.
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    // If the SW were to (wrongly) fetch, this is the secret cross-origin body it would leak.
    fetchImpl = async () => new Response('SECRET-CROSS-ORIGIN-BYTES', { status: 200 });
    await loadWorker();

    const res = await sendFetch(
      {
        url: 'https://victim-bank.example/account/balance',
        stampedOrigin: 'https://attacker.example',
        autoDivert: true,
      },
      { origin: 'https://attacker.example', url: 'https://attacker.example/x' },
    );

    // The SW returns a sentinel ONLY — never the cross-origin bytes.
    expect(res.passthrough).toBe(true);
    expect(res.body).toBeUndefined();
    expect(res.status).toBeUndefined();
    // The SW made ZERO network calls to the victim origin — the proxy hole is closed.
    expect(fetchCalls.some((c) => c.url.startsWith('https://victim-bank.example'))).toBe(false);
    // And the secret bytes were never returned to the page anywhere in the response.
    expect(JSON.stringify(res)).not.toContain('SECRET-CROSS-ORIGIN-BYTES');
  });

  it('the SAME non-pod request WITHOUT autoDivert (explicit window.solid.fetch) DOES return 403 (no sentinel)', async () => {
    // Contrast: an explicit window.solid.fetch deliberately asked for the gated path, so a
    // foreign-target deny is the correct, expected 403 — only autoDivert gets a sentinel.
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://api.thirdparty.example/data', stampedOrigin: 'https://pm.example' }, // no autoDivert
      { origin: 'https://pm.example', url: 'https://pm.example/app.html' },
    );

    expect(res.status).toBe(403);
    expect(res.error).toBe('Cross-origin fetch denied');
    expect(res.passthrough).toBeUndefined();
    expect(fetchCalls.some((c) => c.url.startsWith('https://api.thirdparty.example'))).toBe(false);
  });

  it('an autoDivert POD read from an UN-GRANTED origin → sentinel, NOT a 403 and NOT an SW fetch', async () => {
    // A non-granted app's global fetch hits the pod. Per the invariant it must not hard-fail; the
    // SW returns a sentinel (NO network, NO credential) and the page does the plain native fetch
    // (the pod returns its own 401/WAC). The SW must NOT itself fetch the pod here.
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']); // ungranted.example is NOT granted
    fetchImpl = async () => new Response('pod-public-or-401', { status: 401 });
    await loadWorker();

    const res = await sendFetch(
      {
        url: 'https://alice.pod.example/private/notes.ttl',
        stampedOrigin: 'https://ungranted.example',
        autoDivert: true,
      },
      { origin: 'https://ungranted.example', url: 'https://ungranted.example/x' },
    );

    // Not a gate-403 — a passthrough sentinel, and NO SW egress to the pod.
    expect(res.passthrough).toBe(true);
    expect(res.status).toBeUndefined();
    expect(res.error).toBeUndefined();
    expect(fetchCalls.some((c) => c.url.startsWith('https://alice.pod.example'))).toBe(false);
  });

  it('a GRANTED pod read still gets the AUTHENTICATED replica path even with autoDivert set (no sentinel)', async () => {
    // autoDivert must NOT downgrade a legitimate granted pod read — that is still gated+authed.
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    fetchImpl = async () =>
      new Response('private-pod-bytes', { status: 200, headers: { etag: 'W/"v1"' } });
    await loadWorker();

    const res = await sendFetch(
      {
        url: 'https://alice.pod.example/private/notes.ttl',
        stampedOrigin: 'https://pm.example',
        autoDivert: true,
      },
      { origin: 'https://pm.example', url: 'https://pm.example/app.html' },
    );

    expect(res.passthrough).toBeUndefined();
    expect(res.status).toBe(200);
    expect(res.body).toBe('private-pod-bytes');
    const podCall = fetchCalls.find((c) => c.url.startsWith('https://alice.pod.example'));
    const headers = (podCall?.init?.headers as Record<string, string>) ?? {};
    // The DPoP-bound credential WAS attached (the authenticated path, not passthrough).
    expect(headers.Authorization).toBe('DPoP access-token-xyz');
    expect(headers.DPoP).toBeDefined();
  });

  it('an autoDivert request to an OPAQUE/forged origin → sentinel with NO SW fetch (never hard-fails, never proxies)', async () => {
    // Even a dual-origin mismatch (which would DENY the gated path) becomes a sentinel under
    // autoDivert — normal web traffic is never broken, but the SW still does NO network: the
    // page completes it natively in its own origin context.
    await seedSession();
    storage.set('solid:granted-origins', ['https://pm.example']);
    fetchImpl = async () => new Response('cdn-asset', { status: 200 });
    await loadWorker();

    const res = await sendFetch(
      { url: 'https://cdn.example/lib.js', stampedOrigin: 'https://pm.example', autoDivert: true },
      { origin: 'https://attacker.example', url: 'https://attacker.example/x' }, // sender ≠ stamp
    );

    expect(res.passthrough).toBe(true);
    expect(res.body).toBeUndefined();
    // The SW did NOT fetch the CDN — the page will, natively.
    expect(fetchCalls.some((c) => c.url.startsWith('https://cdn.example'))).toBe(false);
  });

  it('an autoDivert fetch with NO session → sentinel, NO SW fetch (explicit path says Not authenticated)', async () => {
    // No session seeded. The explicit window.solid.fetch returns "Not authenticated"; an
    // autoDivert request gets a sentinel so the page does the plain native fetch (no creds exist),
    // and the SW performs no network.
    fetchImpl = async () => new Response('public-resource', { status: 200 });
    await loadWorker();

    const res = await sendFetch(
      {
        url: 'https://api.thirdparty.example/data',
        stampedOrigin: 'https://pm.example',
        autoDivert: true,
      },
      { origin: 'https://pm.example', url: 'https://pm.example/app.html' },
    );
    expect(res.passthrough).toBe(true);
    expect(res.status).toBeUndefined();
    expect(res.error).toBeUndefined();
    expect(fetchCalls.some((c) => c.url.startsWith('https://api.thirdparty.example'))).toBe(false);
  });
});

const PROFILE_OWNER = {
  origin: `chrome-extension://${EXTENSION_ID}`,
  url: `chrome-extension://${EXTENSION_ID}/popup/popup.html`,
};
const PROFILE_APP_A = { origin: 'https://appa.example', url: 'https://appa.example/app' };
const PROFILE_APP_B = { origin: 'https://appb.example', url: 'https://appb.example/app' };

async function twoProfiles() {
  profileDb.state.migrated = true;
  const store = new ProfileStore(profileDb, async () => {});
  const a = await profileCredentials();
  const b = await profileCredentials('bob');
  await store.login(a.session, a.keyPair, { ...a.display, photoUrl: null });
  await store.login(b.session, b.keyPair, { ...b.display, photoUrl: null });
  await store.capabilities('1', (r) => {
    r.grantedOrigins = [PROFILE_APP_A.origin];
    r.podOrigins = ['https://alice-only.example'];
    r.classGrants = [fixtureGrant(a.session.webId)];
  });
  await store.capabilities('2', (r) => {
    r.grantedOrigins = [PROFILE_APP_B.origin];
    r.classGrants = [fixtureGrant(b.session.webId)];
  });
  return { store, a, b };
}

function profileFetch(sender = PROFILE_APP_A, extra: Record<string, unknown> = {}) {
  return sendFetch(
    { url: 'https://pod.example/private/notes', stampedOrigin: sender.origin, ...extra },
    sender,
  );
}

function profileMessage(type: string, extra: Record<string, unknown> = {}) {
  return sendMessage({ type, ...extra }, PROFILE_OWNER);
}

describe('ProfileStore runtime API and adversarial isolation', () => {
  const actions = [
    { type: 'SOLID_PROFILES_LIST' },
    { type: 'SOLID_PROFILE_ADD', webId: 'https://hostile.example/#me' },
    { type: 'SOLID_PROFILE_RENAME', profileId: '1', label: 'Hijacked' },
    { type: 'SOLID_PROFILE_REMOVE', profileId: '1' },
    { type: 'SOLID_PROFILE_SET_DEFAULT', profileId: '2' },
  ];

  it.each(
    actions,
  )('rejects untrusted $type messages before any state or network change', async (action) => {
    await twoProfiles();
    await loadWorker();
    const before = structuredClone(profileDb.state);
    const callsBefore = fetchCalls.length;
    for (const sender of [
      PROFILE_APP_A,
      {},
      { origin: 'null' },
      { origin: PROFILE_APP_A.origin, url: PROFILE_OWNER.url },
      { origin: PROFILE_OWNER.origin, url: PROFILE_APP_A.url },
      { url: `${PROFILE_OWNER.origin}.evil/popup.html` },
    ]) {
      const result = await sendMessage(action, sender);
      expect(result.error).toMatch(/extension context/);
      expect(result.profiles).toBeUndefined();
    }
    expect(profileDb.state).toEqual(before);
    expect(fetchCalls).toHaveLength(callsBefore);
  });

  it('lists, renames and switches with token-free metadata, persisting the default across wake', async () => {
    await twoProfiles();
    await loadWorker();
    const list = await profileMessage('SOLID_PROFILES_LIST');
    expect(list.defaultProfileId).toBe('1');
    expect(list.profiles).toHaveLength(2);
    const serialized = JSON.stringify(list);
    for (const forbidden of [
      'accessToken',
      'refreshToken',
      'privateKey',
      'fixture-access',
      'fixture-refresh',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(
      (await profileMessage('SOLID_PROFILE_RENAME', { profileId: '2', label: 'Work' })).ok,
    ).toBe(true);
    const switched = await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    expect(switched.defaultProfileId).toBe('2');
    await loadWorker();
    const view = await sendMessage({ type: 'SOLID_GET_STATE' }, PROFILE_OWNER);
    expect(view).toMatchObject({
      webId: 'https://pod.example/bob/profile#me',
      name: 'Work',
      isActive: true,
    });
    expect(
      (await profileMessage('SOLID_PROFILE_RENAME', { profileId: '2', label: '' })).error,
    ).toMatch(/label/);
    for (const type of [
      'SOLID_PROFILE_RENAME',
      'SOLID_PROFILE_REMOVE',
      'SOLID_PROFILE_SET_DEFAULT',
    ]) {
      expect((await profileMessage(type, { profileId: 'absent', label: 'X' })).error).toMatch(
        /Unknown profile/,
      );
    }
    // Chrome also supplies a URL-only sender on some extension surfaces.
    expect(
      (await sendMessage({ type: 'SOLID_PROFILES_LIST' }, { url: PROFILE_OWNER.url })).ok,
    ).toBe(true);
  });

  it('adds profiles through login, retaining the old default and refusing a ninth before opening auth', async () => {
    const credentials = await profileCredentials('first');
    let next = credentials;
    const initiateLogin = vi.fn(async () => ({
      ...next,
      name: next.display.name,
      photoUrl: next.display.photoUrl,
    }));
    vi.doMock('../src/background/auth-flow', () => ({ initiateLogin, refreshSession: vi.fn() }));
    await loadWorker();
    expect(
      (await profileMessage('SOLID_PROFILE_ADD', { webId: credentials.session.webId }))
        .defaultProfileId,
    ).toBe('1');
    for (let i = 2; i <= 8; i++) {
      next = await profileCredentials(String(i));
      const result = await profileMessage('SOLID_PROFILE_ADD', { webId: next.session.webId });
      expect(result.ok).toBe(true);
      expect(result.defaultProfileId).toBe('1');
    }
    expect(profileDb.state.records).toHaveLength(8);
    expect(profileDb.state.records[1].grantedOrigins).toEqual([]);
    const rejected = await profileMessage('SOLID_PROFILE_ADD', {
      webId: 'https://ninth.example/#me',
    });
    expect(rejected.error).toMatch(/8 profiles/);
    expect(initiateLogin).toHaveBeenCalledTimes(8);
    next = credentials;
    expect((await profileMessage('SOLID_PROFILE_ADD', { webId: next.session.webId })).ok).toBe(
      true,
    );
    expect(profileDb.state.records).toHaveLength(8);
    initiateLogin.mockRejectedValueOnce(new Error('fixture cancelled'));
    expect((await profileMessage('SOLID_PROFILE_ADD', { webId: next.session.webId })).error).toBe(
      'fixture cancelled',
    );
    expect(storage.has('solid:session')).toBe(false);
    expect(idbDpopKey).toBeUndefined();
  });

  it('broadcasts each identity only to its own granted tabs', async () => {
    const { a, b } = await twoProfiles();
    const tabs = [
      { id: 1, url: PROFILE_APP_A.url },
      { id: 2, url: PROFILE_APP_B.url },
      { id: 3, url: 'https://ungranted.example/' },
    ];
    chrome.tabs.query = vi.fn().mockResolvedValue(tabs);
    const send = vi.spyOn(chrome.tabs, 'sendMessage');
    await loadWorker();
    expect(send.mock.calls).toEqual([
      [1, { type: 'SOLID_STATE_CHANGED', webId: a.session.webId }],
      [2, { type: 'SOLID_STATE_CHANGED', webId: null }],
      [3, { type: 'SOLID_STATE_CHANGED', webId: null }],
    ]);
    send.mockClear();
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    expect(send.mock.calls).toEqual([
      [1, { type: 'SOLID_STATE_CHANGED', webId: null }],
      [2, { type: 'SOLID_STATE_CHANGED', webId: b.session.webId }],
      [3, { type: 'SOLID_STATE_CHANGED', webId: null }],
    ]);
  });

  it('never authorizes an earlier identity with a newly selected profile grant', async () => {
    const { b } = await twoProfiles();
    await loadWorker();
    chrome.tabs.query = vi.fn().mockResolvedValue([{ id: 2, url: PROFILE_APP_B.url }]);
    const send = vi.spyOn(chrome.tabs, 'sendMessage');
    const { ProfileStore: WorkerStore } = await import('../src/background/core/profile-store');
    const selected = structuredClone(profileDb.state.records[0]);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(WorkerStore.prototype, 'getDefault').mockImplementationOnce(async () => {
      entered();
      await held;
      return selected;
    });
    const old = profileMessage('SOLID_PROFILE_RENAME', { profileId: '1', label: 'Personal' });
    await started;
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    release();
    await old;
    expect(send.mock.calls).toEqual([[2, { type: 'SOLID_STATE_CHANGED', webId: b.session.webId }]]);
  });

  it('discards a broadcast held across a default change, including the runtime copy', async () => {
    const { b } = await twoProfiles();
    await loadWorker();
    let release!: (tabs: Array<{ id: number; url: string }>) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<Array<{ id: number; url: string }>>((resolve) => {
      release = resolve;
    });
    const tabs = [{ id: 2, url: PROFILE_APP_B.url }];
    chrome.tabs.query = vi
      .fn()
      .mockImplementationOnce(() => {
        entered();
        return held;
      })
      .mockResolvedValue(tabs);
    const send = vi.spyOn(chrome.tabs, 'sendMessage');
    const runtime = vi.spyOn(chrome.runtime, 'sendMessage');
    const old = profileMessage('SOLID_PROFILE_RENAME', { profileId: '1', label: 'Personal' });
    await started;
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    release(tabs);
    await old;
    expect(send.mock.calls).toEqual([[2, { type: 'SOLID_STATE_CHANGED', webId: b.session.webId }]]);
    expect(runtime.mock.calls).toEqual([[{ type: 'SOLID_STATE_CHANGED', webId: b.session.webId }]]);
  });

  it.each([
    { next: 'profile', photoOk: true },
    { next: 'profile', photoOk: false },
    { next: 'logout', photoOk: true },
  ])('discards delayed avatar mutations after $next (photo success: $photoOk)', async ({
    next,
    photoOk,
  }) => {
    await twoProfiles();
    await loadWorker();
    installIconCanvas();
    const avatar = 'https://pod.example/alice.png';
    profileDb.state.records[0].profile = { ...profileDb.state.records[0].profile, avatar };
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchImpl = async (url) => {
      expect(url).toBe(avatar);
      entered();
      await held;
      return new Response('fixture photo', { status: photoOk ? 200 : 404 });
    };
    const icon = vi.spyOn(chrome.action, 'setIcon');
    const badge = vi.spyOn(chrome.action, 'setBadgeText');
    const background = vi.spyOn(chrome.action, 'setBadgeBackgroundColor');
    const title = vi.spyOn(chrome.action, 'setTitle');
    const old = profileMessage('SOLID_PROFILE_RENAME', { profileId: '1', label: 'Personal' });
    await started;
    if (next === 'profile') await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    else await profileMessage('SOLID_LOGOUT');
    const latest = {
      icon: [...icon.mock.calls],
      badge: [...badge.mock.calls],
      background: [...background.mock.calls],
      title: [...title.mock.calls],
    };
    expect(title).toHaveBeenLastCalledWith({
      title: next === 'profile' ? 'Signed in as bob' : 'Sign in to Solid',
    });
    expect(badge).toHaveBeenLastCalledWith({ text: next === 'profile' ? ' ' : '' });
    release();
    expect((await old).ok).toBe(true);
    expect(icon.mock.calls).toEqual(latest.icon);
    expect(badge.mock.calls).toEqual(latest.badge);
    expect(background.mock.calls).toEqual(latest.background);
    expect(title.mock.calls).toEqual(latest.title);
  });

  it.each([
    'active',
    'signed-out',
  ])('stops an obsolete %s toolbar update after an awaited mutation', async (state) => {
    await twoProfiles();
    await loadWorker();
    installIconCanvas();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(chrome.action, 'setIcon').mockImplementationOnce(async () => {
      entered();
      await held;
    });
    const badge = vi.spyOn(chrome.action, 'setBadgeText');
    const title = vi.spyOn(chrome.action, 'setTitle');
    const old =
      state === 'active'
        ? profileMessage('SOLID_PROFILE_RENAME', { profileId: '1', label: 'Personal' })
        : profileMessage('SOLID_LOGOUT');
    await started;
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    const latestBadge = [...badge.mock.calls];
    const latestTitle = [...title.mock.calls];
    release();
    expect((await old).ok).toBe(true);
    expect(badge.mock.calls).toEqual(latestBadge);
    expect(title.mock.calls).toEqual(latestTitle);
    expect(title).toHaveBeenLastCalledWith({ title: 'Signed in as bob' });
  });

  it('never uses P1 grants, tokens, keys or pod settings for P2, even on a shared pod origin', async () => {
    const { a, b } = await twoProfiles();
    await loadWorker();
    expect((await profileFetch()).status).toBe(200);
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    const before = fetchCalls.length;
    expect((await profileFetch(PROFILE_APP_A, { profileId: '1' })).status).toBe(403);
    expect(fetchCalls).toHaveLength(before);
    const hidden = await sendMessage(
      { type: 'SOLID_GET_STATE', stampedOrigin: PROFILE_APP_A.origin },
      PROFILE_APP_A,
    );
    expect(hidden.webId).toBeNull();
    expect((await profileFetch(PROFILE_APP_B, { profileId: '1' })).status).toBe(200);
    const podCalls = fetchCalls.filter((c) => c.url === 'https://pod.example/private/notes');
    expect(podCalls).toHaveLength(2);
    for (const [call, credentials] of [
      [podCalls[0], a],
      [podCalls[1], b],
    ] as const) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get('authorization')).toBe(`DPoP ${credentials.session.accessToken}`);
      const proof = headers.get('dpop')!;
      const publicJwk = await crypto.subtle.exportKey('jwk', credentials.keyPair.publicKey);
      expect(jose.decodeProtectedHeader(proof).jwk).toMatchObject({
        x: publicJwk.x,
        y: publicJwk.y,
      });
      await expect(jose.jwtVerify(proof, credentials.keyPair.publicKey)).resolves.toBeDefined();
    }
    expect(
      (await profileFetch(PROFILE_APP_B, { url: 'https://alice-only.example/private' })).status,
    ).toBe(403);
  });

  it('keeps an in-flight P1 request bound to P1 when the default changes to P2', async () => {
    const { a } = await twoProfiles();
    await loadWorker();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    fetchImpl = async () => {
      entered();
      await held;
      return new Response('P1-only');
    };
    const pending = profileFetch();
    await started;
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    release();
    expect((await pending).body).toBe('P1-only');
    expect(new Headers(fetchCalls.at(-1)?.init?.headers).get('authorization')).toBe(
      `DPoP ${a.session.accessToken}`,
    );
    expect(profileDb.state.defaultProfileId).toBe('2');
  });

  it('cancels in-flight reads and purges only the removed profile', async () => {
    const { a, b } = await twoProfiles();
    await loadWorker();
    fetchImpl = async () => new Response('fixture bytes', { headers: { etag: 'fixture-etag' } });
    await profileFetch();
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    await profileFetch(PROFILE_APP_B);
    expect(idbMeta.size).toBe(2);
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '1' });
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    fetchImpl = async () => {
      entered();
      await held;
      return new Response('late P1 bytes');
    };
    const read = profileFetch();
    await started;
    const signal = fetchCalls.at(-1)?.init?.signal;
    const removal = await profileMessage('SOLID_PROFILE_REMOVE', { profileId: '1' });
    expect(removal.defaultProfileId).toBe('2');
    expect(await read).toEqual({ requestId: 'r1', error: 'Fetch cancelled' });
    expect(signal?.aborted).toBe(true);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(profileDb.state.records.map((r) => r.profile.id)).toEqual(['2']);
    expect([...idbMeta.values()].every((m) => m.webId === b.session.webId)).toBe(true);
    expect([...idbMeta.values()].some((m) => m.webId === a.session.webId)).toBe(false);
    expect(cacheStore.size).toBe(1);
    expect(profileDb.state.records[0].session).toEqual(b.session);
    expect(profileDb.state.records[0].classGrants).toHaveLength(1);
    await loadWorker();
    expect((await profileFetch(PROFILE_APP_B)).status).toBe(200);
    expect(
      (await profileMessage('SOLID_PROFILE_REMOVE', { profileId: '2' })).defaultProfileId,
    ).toBeNull();
    expect(cacheStore.size).toBe(0);
  });

  it('serves concurrent reads and passthrough decisions while another request is stalled', async () => {
    await twoProfiles();
    await loadWorker();
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    fetchImpl = async (url) => {
      if (url.endsWith('/slow')) {
        entered();
        await held;
      }
      return new Response('fixture bytes');
    };
    const slow = profileFetch(PROFILE_APP_A, { url: 'https://pod.example/slow' });
    await started;
    const openCache = vi.spyOn(caches, 'open');
    expect(
      await profileFetch(PROFILE_APP_A, {
        url: 'https://thirdparty.example/api',
        autoDivert: true,
        requestId: 'passthrough',
      }),
    ).toEqual({ requestId: 'passthrough', passthrough: true });
    expect(openCache).not.toHaveBeenCalled();
    expect((await profileFetch(PROFILE_APP_A, { url: 'https://pod.example/fast' })).status).toBe(
      200,
    );
    expect(fetchCalls).toHaveLength(2);
    release();
    expect((await slow).status).toBe(200);
  });

  it.each([
    { lifecycle: 'SOLID_LOGOUT', method: 'GET' },
    { lifecycle: 'SOLID_PROFILE_REMOVE', method: 'GET' },
    { lifecycle: 'SOLID_LOGOUT', method: 'PUT' },
    { lifecycle: 'SOLID_PROFILE_REMOVE', method: 'PUT' },
  ])('cancels a stalled $method response body during $lifecycle without late persistence', async ({
    lifecycle,
    method,
  }) => {
    const { a, b } = await twoProfiles();
    await loadWorker();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    fetchImpl = async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
        },
        pull() {
          entered();
        },
      });
      return new Response(body, { headers: { etag: 'fixture-etag', 'dpop-nonce': 'late-nonce' } });
    };
    const pending = profileFetch(PROFILE_APP_A, {
      method,
      body: method === 'PUT' ? 'fixture write' : null,
    });
    await started;
    expect((await profileMessage(lifecycle, { profileId: '1' })).ok).toBe(true);
    expect(await pending).toEqual({ requestId: 'r1', error: 'Fetch cancelled' });
    expect(fetchCalls[0].init?.signal?.aborted).toBe(true);
    stream.enqueue(new TextEncoder().encode('late private bytes'));
    stream.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cacheStore.size).toBe(0);
    expect([...idbMeta.values()].some((record) => record.webId === a.session.webId)).toBe(false);
    expect(idbNonces.size).toBe(0);
    expect(profileDb.state.records.find((record) => record.profile.id === '2')?.session).toEqual(
      b.session,
    );
  });

  it.each([
    'SOLID_LOGOUT',
    'SOLID_PROFILE_REMOVE',
  ])('does not wait for a refresh flight during %s or restore its late tokens', async (lifecycle) => {
    const { a, b } = await twoProfiles();
    await loadWorker();
    profileDb.state.records[0].session = { ...a.session, expiresAt: 0 };
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchImpl = async (url) => {
      expect(url).toBe(a.session.tokenEndpoint);
      entered();
      await held;
      return Response.json({
        access_token: 'late-access',
        refresh_token: 'late-refresh',
        expires_in: 3600,
      });
    };
    const pending = profileFetch();
    await started;
    expect((await profileMessage(lifecycle, { profileId: '1' })).ok).toBe(true);
    expect(await pending).toEqual({ requestId: 'r1', error: 'Not authenticated' });
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      profileDb.state.records.find((record) => record.profile.id === '1')?.session ?? null,
    ).toBeNull();
    expect(profileDb.state.records.find((record) => record.profile.id === '2')?.session).toEqual(
      b.session,
    );
    expect(fetchCalls).toHaveLength(1);
    expect(cacheStore.size).toBe(0);
    expect(idbMeta.size).toBe(0);
  });

  it.each([
    { lifecycle: 'SOLID_LOGOUT', phase: 'headers' },
    { lifecycle: 'SOLID_PROFILE_REMOVE', phase: 'headers' },
    { lifecycle: 'SOLID_LOGIN', phase: 'headers' },
    { lifecycle: 'SOLID_LOGOUT', phase: 'body' },
    { lifecycle: 'SOLID_PROFILE_REMOVE', phase: 'body' },
    { lifecycle: 'SOLID_LOGIN', phase: 'body' },
  ])('never replays an automatic POST cancelled during $phase by $lifecycle', async ({
    lifecycle,
    phase,
  }) => {
    const { a } = await twoProfiles();
    const replacement = await profileCredentials();
    vi.doMock('../src/background/auth-flow', () => ({
      initiateLogin: vi.fn(async () => ({ ...replacement, name: 'alice', photoUrl: null })),
      refreshSession: vi.fn(),
    }));
    await loadWorker();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchImpl = async (url) => {
      if (url !== 'https://pod.example/private/notes') return new Response('');
      if (phase === 'headers') {
        entered();
        await held;
        return new Response('created', { status: 201 });
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            entered();
            await held;
            controller.enqueue(new TextEncoder().encode('created'));
            controller.close();
          },
        }),
        { status: 201 },
      );
    };
    const pending = profileFetch(PROFILE_APP_A, {
      method: 'POST',
      body: 'fixture mutation',
      autoDivert: true,
      requestId: 'cancelled-diversion',
    });
    await started;
    const signal = fetchCalls[0].init?.signal;
    expect((await profileMessage(lifecycle, { profileId: '1', webId: a.session.webId })).ok).toBe(
      true,
    );
    expect(await pending).toEqual({ requestId: 'cancelled-diversion', error: 'Fetch cancelled' });
    expect(signal?.aborted).toBe(true);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      fetchCalls.filter((call) => call.url === 'https://pod.example/private/notes'),
    ).toHaveLength(1);
    expect(cacheStore.size).toBe(0);
    expect(idbMeta.size).toBe(0);
  });

  it('returns passthrough when logout cancels an automatic POST before egress', async () => {
    await twoProfiles();
    await loadWorker();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(FakeReplicaDb.prototype, 'getNonce').mockImplementationOnce(async () => {
      entered();
      await held;
      return undefined;
    });
    const pending = profileFetch(PROFILE_APP_A, {
      method: 'POST',
      body: 'fixture mutation',
      autoDivert: true,
      requestId: 'unsent-diversion',
    });
    await started;
    expect((await profileMessage('SOLID_LOGOUT')).ok).toBe(true);
    expect(await pending).toEqual({ requestId: 'unsent-diversion', passthrough: true });
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchCalls).toHaveLength(0);
    expect(cacheStore.size).toBe(0);
    expect(idbMeta.size).toBe(0);
  });

  it('finishes an atomic local replica commit before purging its bytes and metadata', async () => {
    await twoProfiles();
    await loadWorker();
    const cache = await caches.open('solid-ext-replica-bytes');
    const put = cache.put.bind(cache);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(cache, 'put').mockImplementation(async (request, response) => {
      await put(request, response);
      entered();
      await held;
    });
    vi.spyOn(caches, 'open').mockResolvedValue(cache);
    const pending = profileFetch();
    await started;
    expect(cacheStore.size).toBe(1);
    expect(idbMeta.size).toBe(0);
    const removal = profileMessage('SOLID_PROFILE_REMOVE', { profileId: '1' });
    release();
    expect((await removal).ok).toBe(true);
    expect(await pending).toEqual({ requestId: 'r1', error: 'Fetch cancelled' });
    expect(cacheStore.size).toBe(0);
    expect(idbMeta.size).toBe(0);
  });

  it('keeps failed removal retryable until replica bytes are deleted on wake', async () => {
    const { a, b } = await twoProfiles();
    await loadWorker();
    expect((await profileFetch()).status).toBe(200);
    expect(
      (await profileFetch(PROFILE_APP_A, { url: 'https://pod.example/private/second' })).status,
    ).toBe(200);
    const failedKey = [...cacheStore.keys()][1];
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    expect((await profileFetch(PROFILE_APP_B)).status).toBe(200);
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '1' });
    const cache = await caches.open('solid-ext-replica-bytes');
    const remove = cache.delete.bind(cache);
    let fail = true;
    vi.spyOn(cache, 'delete').mockImplementation(async (request, options) => {
      if ((request as Request).url === failedKey && fail)
        throw new Error('fixture cache deletion failed');
      return remove(request, options);
    });
    vi.spyOn(caches, 'open').mockResolvedValue(cache);

    const broadcast = vi.spyOn(chrome.runtime, 'sendMessage');
    const result = await profileMessage('SOLID_PROFILE_REMOVE', { profileId: '1' });
    expect(result.error).toBe('fixture cache deletion failed');
    expect(broadcast).toHaveBeenLastCalledWith({ type: 'SOLID_STATE_CHANGED', webId: null });
    expect(profileDb.state.defaultProfileId).toBe('1');
    expect(profileDb.state.records[0]).toMatchObject({
      profile: { sessionState: 'removing' },
      session: null,
      keyPair: null,
      grantedOrigins: [],
      classGrants: [],
    });
    expect(profileDb.state.records[1].session).toEqual(b.session);
    expect([...idbMeta.values()].filter((row) => row.webId === a.session.webId)).toHaveLength(2);
    expect(cacheStore.has(failedKey)).toBe(true);
    expect(cacheStore.size).toBe(2);
    expect((await profileFetch()).error).toBe('Not authenticated');

    await loadWorker();
    expect((await profileMessage('SOLID_PROFILES_LIST')).error).toBe(
      'fixture cache deletion failed',
    );
    expect(profileDb.state.records[0].profile.sessionState).toBe('removing');
    expect(cacheStore.has(failedKey)).toBe(true);

    fail = false;
    await loadWorker();
    expect(await profileMessage('SOLID_PROFILES_LIST')).toMatchObject({
      ok: true,
      defaultProfileId: '2',
      profiles: [{ id: '2', webId: b.session.webId, sessionState: 'active' }],
    });
    expect([...idbMeta.values()].every((row) => row.webId === b.session.webId)).toBe(true);
    expect(cacheStore.has(failedKey)).toBe(false);
    expect(cacheStore.size).toBe(1);
    expect((await profileFetch(PROFILE_APP_B)).status).toBe(200);
  });

  it('signs out only the default profile and never substitutes an active survivor', async () => {
    const { a, b } = await twoProfiles();
    await loadWorker();
    expect((await profileMessage('SOLID_LOGOUT')).ok).toBe(true);
    expect(profileDb.state.records[0]).toMatchObject({
      session: null,
      keyPair: null,
      grantedOrigins: [],
      classGrants: [],
    });
    expect(profileDb.state.records[0].profile.sessionState).toBe('signed-out');
    expect(profileDb.state.records[1].session).toEqual(b.session);
    expect((await profileFetch()).error).toBe('Not authenticated');
    expect(fetchCalls).toHaveLength(0);
    expect(profileDb.state.records[0].profile.webId).toBe(a.session.webId);
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    expect((await profileFetch(PROFILE_APP_B)).status).toBe(200);
  });

  it('refreshes each profile with its own key and atomically retains rotated tokens across wake', async () => {
    const { a, b } = await twoProfiles();
    for (const record of profileDb.state.records)
      record.session = { ...record.session!, expiresAt: 0 };
    let failA = false;
    fetchImpl = async (url, init) => {
      if (url === a.session.tokenEndpoint) {
        const body = init?.body as URLSearchParams;
        const isA = body.get('refresh_token') === a.session.refreshToken;
        const credentials = isA ? a : b;
        const proof = new Headers(init?.headers).get('dpop')!;
        await expect(jose.jwtVerify(proof, credentials.keyPair.publicKey)).resolves.toBeDefined();
        if (isA && failA) return new Response('fixture refresh denied', { status: 401 });
        return Response.json({
          access_token: `rotated-${isA ? 'alice' : 'bob'}`,
          refresh_token: `refresh-${isA ? 'alice' : 'bob'}`,
          expires_in: 3600,
        });
      }
      return new Response('pod fixture');
    };
    await loadWorker();
    await Promise.all([profileFetch(), sendMessage({ type: 'SOLID_GET_STATE' }, PROFILE_OWNER)]);
    expect(fetchCalls.filter((c) => c.url === a.session.tokenEndpoint)).toHaveLength(1);
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    await profileFetch(PROFILE_APP_B);
    expect(profileDb.state.records[0].session?.accessToken).toBe('rotated-alice');
    expect(profileDb.state.records[1].session?.accessToken).toBe('rotated-bob');
    await loadWorker();
    expect(profileDb.state.records[0].session?.refreshToken).toBe('refresh-alice');
    // A genuine failure tears down only its own profile.
    profileDb.state.records[0].session = { ...a.session, expiresAt: 0 };
    failA = true;
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '1' });
    expect(profileDb.state.records[0].session).toBeNull();
    expect(profileDb.state.records[1].session?.accessToken).toBe('rotated-bob');
  });

  it.each([
    'state',
    'fetch',
  ])('resets the signed-in toolbar after a %s refresh failure', async (request) => {
    const { a, b } = await twoProfiles();
    installIconCanvas();
    const icon = vi.spyOn(chrome.action, 'setIcon');
    const badge = vi.spyOn(chrome.action, 'setBadgeText');
    const background = vi.spyOn(chrome.action, 'setBadgeBackgroundColor');
    const title = vi.spyOn(chrome.action, 'setTitle');
    await loadWorker();
    expect(icon.mock.lastCall?.[0]).toHaveProperty('imageData');
    expect(background).toHaveBeenLastCalledWith({ color: '#2e9e57' });
    expect(badge).toHaveBeenLastCalledWith({ text: ' ' });
    expect(title).toHaveBeenLastCalledWith({ title: 'Signed in as alice' });
    icon.mockClear();
    badge.mockClear();
    title.mockClear();
    const broadcast = vi.spyOn(chrome.runtime, 'sendMessage');
    profileDb.state.records[0].session = { ...a.session, expiresAt: 0 };
    fetchImpl = async () => new Response('fixture refresh denied', { status: 401 });

    if (request === 'state') {
      expect(await profileMessage('SOLID_GET_STATE')).toMatchObject({
        webId: null,
        isActive: false,
      });
    } else {
      expect(await profileFetch()).toMatchObject({ requestId: 'r1', error: 'Not authenticated' });
    }
    await vi.waitFor(() => {
      expect(icon).toHaveBeenLastCalledWith({
        path: {
          16: 'icons/icon16.png',
          32: 'icons/icon32.png',
          48: 'icons/icon48.png',
          128: 'icons/icon128.png',
        },
      });
      expect(badge).toHaveBeenLastCalledWith({ text: '' });
      expect(title).toHaveBeenLastCalledWith({ title: 'Sign in to Solid' });
      expect(broadcast).toHaveBeenLastCalledWith({ type: 'SOLID_STATE_CHANGED', webId: null });
    });
    expect(profileDb.state.records[0]).toMatchObject({
      profile: { sessionState: 'signed-out' },
      session: null,
      keyPair: null,
    });
    expect(profileDb.state.records[1].session).toEqual(b.session);
    expect(fetchCalls.map((call) => call.url)).toEqual([a.session.tokenEndpoint]);
  });

  it.each([
    'state',
    'fetch',
  ])('publishes a %s refresh sign-out when replica cleanup fails and retries on wake', async (request) => {
    const { a, b } = await twoProfiles();
    installIconCanvas();
    const icon = vi.spyOn(chrome.action, 'setIcon');
    const badge = vi.spyOn(chrome.action, 'setBadgeText');
    const title = vi.spyOn(chrome.action, 'setTitle');
    await loadWorker();
    expect((await profileFetch()).status).toBe(200);
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    expect((await profileFetch(PROFILE_APP_B)).status).toBe(200);
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '1' });
    expect(icon.mock.lastCall?.[0]).toHaveProperty('imageData');
    expect(badge).toHaveBeenLastCalledWith({ text: ' ' });
    expect(title).toHaveBeenLastCalledWith({ title: 'Signed in as alice' });
    const metadata = [...idbMeta.values()];
    const bytes = [...cacheStore.keys()];
    const survivor = structuredClone(profileDb.state.records[1]);
    const cache = await caches.open('solid-ext-replica-bytes');
    const remove = cache.delete.bind(cache);
    let fail = true;
    vi.spyOn(cache, 'delete').mockImplementation(async (entry, options) => {
      if (fail) throw new Error('fixture cache deletion failed');
      return remove(entry, options);
    });
    vi.spyOn(caches, 'open').mockResolvedValue(cache);
    chrome.tabs.query = vi.fn().mockResolvedValue([
      { id: 1, url: PROFILE_APP_A.url },
      { id: 2, url: PROFILE_APP_B.url },
    ]);
    const tabBroadcast = vi.spyOn(chrome.tabs, 'sendMessage');
    const broadcast = vi.spyOn(chrome.runtime, 'sendMessage');
    profileDb.state.records[0].session = { ...a.session, expiresAt: 0 };
    fetchImpl = async () => new Response('fixture refresh denied', { status: 401 });

    const result =
      request === 'state' ? await profileMessage('SOLID_GET_STATE') : await profileFetch();
    expect(result).toEqual(
      request === 'state'
        ? { error: 'Profile storage unavailable.' }
        : { requestId: 'r1', error: 'Not authenticated' },
    );
    await vi.waitFor(() => {
      expect(icon).toHaveBeenLastCalledWith({
        path: {
          16: 'icons/icon16.png',
          32: 'icons/icon32.png',
          48: 'icons/icon48.png',
          128: 'icons/icon128.png',
        },
      });
      expect(badge).toHaveBeenLastCalledWith({ text: '' });
      expect(title).toHaveBeenLastCalledWith({ title: 'Sign in to Solid' });
      expect(broadcast).toHaveBeenLastCalledWith({ type: 'SOLID_STATE_CHANGED', webId: null });
      for (const tabId of [1, 2])
        expect(tabBroadcast).toHaveBeenCalledWith(tabId, {
          type: 'SOLID_STATE_CHANGED',
          webId: null,
        });
    });
    expect(profileDb.state.records[0]).toMatchObject({
      profile: { sessionState: 'signed-out' },
      session: null,
      keyPair: null,
      grantedOrigins: [],
      classGrants: [],
    });
    expect(profileDb.state.records[1]).toEqual(survivor);
    expect([...idbMeta.values()]).toEqual(metadata);
    expect([...cacheStore.keys()]).toEqual(bytes);
    expect((await profileFetch()).error).toBe('Not authenticated');

    fail = false;
    await loadWorker();
    expect(await profileMessage('SOLID_GET_STATE')).toMatchObject({
      webId: null,
      isActive: false,
    });
    expect([...idbMeta.values()]).toEqual(metadata.filter((row) => row.webId === b.session.webId));
    expect(cacheStore.size).toBe(1);
    expect(profileDb.state.records[1]).toEqual(survivor);
    await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' });
    expect((await profileMessage('SOLID_GET_STATE')).webId).toBe(b.session.webId);
  });

  it.each([
    'profile',
    'login',
  ])('discards a refresh-failure toolbar reset superseded by %s', async (next) => {
    const { a } = await twoProfiles();
    vi.doMock('../src/background/auth-flow', () => ({
      initiateLogin: vi.fn(async () => ({ ...a, name: 'alice', photoUrl: null })),
      refreshSession: vi.fn().mockRejectedValue(new Error('fixture refresh denied')),
    }));
    installIconCanvas();
    await loadWorker();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const icon = vi.spyOn(chrome.action, 'setIcon').mockImplementationOnce(async () => {
      expect(profileDb.state.records[0].profile.sessionState).toBe('signed-out');
      entered();
      await held;
    });
    const badge = vi.spyOn(chrome.action, 'setBadgeText');
    const background = vi.spyOn(chrome.action, 'setBadgeBackgroundColor');
    const title = vi.spyOn(chrome.action, 'setTitle');
    const broadcast = vi.spyOn(chrome.runtime, 'sendMessage');
    profileDb.state.records[0].session = { ...a.session, expiresAt: 0 };
    const pending = profileMessage('SOLID_GET_STATE');
    await started;
    // Scheduling the repaint must not block the state request on toolbar I/O.
    expect((await pending).isActive).toBe(false);
    expect(
      next === 'profile'
        ? (await profileMessage('SOLID_PROFILE_SET_DEFAULT', { profileId: '2' })).ok
        : (await profileMessage('SOLID_LOGIN', { webId: a.session.webId })).ok,
    ).toBe(true);
    const latest = {
      icon: [...icon.mock.calls],
      badge: [...badge.mock.calls],
      background: [...background.mock.calls],
      title: [...title.mock.calls],
      broadcast: [...broadcast.mock.calls],
    };
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(icon.mock.calls).toEqual(latest.icon);
    expect(badge.mock.calls).toEqual(latest.badge);
    expect(background.mock.calls).toEqual(latest.background);
    expect(title.mock.calls).toEqual(latest.title);
    expect(broadcast.mock.calls).toEqual(latest.broadcast);
    expect(title).toHaveBeenLastCalledWith({
      title: `Signed in as ${next === 'profile' ? 'bob' : 'alice'}`,
    });
    expect(badge).toHaveBeenLastCalledWith({ text: ' ' });
  });

  it('checks refresh failure credentials after a queued re-login commits', async () => {
    const { a, b } = await twoProfiles();
    const replacement = await profileCredentials();
    const grants = structuredClone(profileDb.state.records[0].classGrants);
    let refreshEntered!: () => void;
    let rejectRefresh!: (error: Error) => void;
    const refreshing = new Promise<void>((resolve) => {
      refreshEntered = resolve;
    });
    const refresh = new Promise<StoredSession>((_resolve, reject) => {
      rejectRefresh = reject;
    });
    vi.doMock('../src/background/auth-flow', () => ({
      initiateLogin: vi.fn(async () => ({ ...replacement, name: 'alice', photoUrl: null })),
      refreshSession: vi.fn(() => {
        refreshEntered();
        return refresh;
      }),
    }));
    await loadWorker();
    profileDb.state.records[0].session = { ...a.session, expiresAt: 0 };
    const pending = sendMessage({ type: 'SOLID_GET_STATE' }, PROFILE_OWNER);
    await refreshing;

    const { ProfileStore: WorkerStore } = await import('../src/background/core/profile-store');
    const login = WorkerStore.prototype.login;
    let loginEntered!: () => void;
    let releaseLogin!: () => void;
    const committing = new Promise<void>((resolve) => {
      loginEntered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    vi.spyOn(WorkerStore.prototype, 'login').mockImplementationOnce(async function (
      this: ProfileStore,
      ...args
    ) {
      loginEntered();
      await held;
      return login.apply(this, args);
    });
    const relogin = sendMessage(
      { type: 'SOLID_LOGIN', webId: a.session.webId, origin: 'https://relogin.example' },
      { origin: 'https://relogin.example', url: 'https://relogin.example/app' },
    );
    await committing;
    // The lifecycle queue is held, but its login has not replaced the old tokens yet.
    // A refresh failure must queue its credential read behind this login too.
    rejectRefresh(new Error('fixture old refresh denied'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseLogin();
    expect((await relogin).ok).toBe(true);
    expect((await pending).isActive).toBe(true);
    expect(profileDb.state.records[0].session).toEqual(replacement.session);
    expect(profileDb.state.records[0].profile.sessionState).toBe('active');
    expect(profileDb.state.records[0].grantedOrigins).toContain('https://relogin.example');
    expect(profileDb.state.records[0].classGrants).toEqual(grants);
    expect(profileDb.state.records[1].session).toEqual(b.session);
  });

  it.each([
    'key',
    'refresh token',
  ])('ignores an old refresh failure after re-login changes the %s', async (generation) => {
    const { a } = await twoProfiles();
    const replacement =
      generation === 'key'
        ? await profileCredentials()
        : {
            ...a,
            session: { ...a.session, refreshToken: 'fixture-relogin-refresh' },
          };
    let entered!: () => void;
    let rejectRefresh!: (error: Error) => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const refresh = new Promise<StoredSession>((_resolve, reject) => {
      rejectRefresh = reject;
    });
    vi.doMock('../src/background/auth-flow', () => ({
      initiateLogin: vi.fn(async () => ({ ...replacement, name: 'alice', photoUrl: null })),
      refreshSession: vi.fn(() => {
        entered();
        return refresh;
      }),
    }));
    await loadWorker();
    profileDb.state.records[0].session = { ...a.session, expiresAt: 0 };
    const pending = sendMessage({ type: 'SOLID_GET_STATE' }, PROFILE_OWNER);
    await started;
    expect((await profileMessage('SOLID_LOGIN', { webId: a.session.webId })).ok).toBe(true);
    const committed = structuredClone(profileDb.state.records[0]);
    rejectRefresh(new Error('fixture old refresh denied'));
    expect((await pending).isActive).toBe(true);
    expect(profileDb.state.records[0]).toEqual(committed);
    expect((await profileFetch()).status).toBe(200);
  });

  it('rechecks credentials when an expired snapshot outlives a completed refresh flight', async () => {
    const { a } = await twoProfiles();
    await loadWorker();
    profileDb.state.records[0].session = { ...a.session, expiresAt: 0 };
    const { ProfileStore: WorkerStore } = await import('../src/background/core/profile-store');
    const session = WorkerStore.prototype.session;
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(WorkerStore.prototype, 'session').mockImplementationOnce(async function (
      this: ProfileStore,
      id,
    ) {
      const stale = await session.call(this, id);
      entered();
      await held;
      return stale;
    });
    fetchImpl = async (url, init) => {
      if (url === a.session.tokenEndpoint) {
        expect((init?.body as URLSearchParams).get('refresh_token')).toBe(a.session.refreshToken);
        return Response.json({
          access_token: 'fixture-rotated',
          refresh_token: 'fixture-rotated-refresh',
          expires_in: 3600,
        });
      }
      return new Response('pod fixture');
    };
    const delayed = sendMessage({ type: 'SOLID_GET_STATE' }, PROFILE_OWNER);
    await started;
    expect((await sendMessage({ type: 'SOLID_GET_STATE' }, PROFILE_OWNER)).isActive).toBe(true);
    release();
    expect((await delayed).isActive).toBe(true);
    expect(fetchCalls.filter((call) => call.url === a.session.tokenEndpoint)).toHaveLength(1);
    expect(profileDb.state.records[0].session?.refreshToken).toBe('fixture-rotated-refresh');
    expect((await profileFetch()).status).toBe(200);
    expect(new Headers(fetchCalls.at(-1)?.init?.headers).get('authorization')).toBe(
      'DPoP fixture-rotated',
    );
  });

  it('returns a correlated unauthenticated response when the captured profile is deleted', async () => {
    await twoProfiles();
    await loadWorker();
    const { ProfileStore: WorkerStore } = await import('../src/background/core/profile-store');
    const selected = structuredClone(profileDb.state.records[0]);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(WorkerStore.prototype, 'getDefault').mockImplementationOnce(async () => {
      entered();
      await held;
      return selected;
    });
    const delayed = profileFetch(PROFILE_APP_A, { requestId: 'deleted-profile-fetch' });
    await started;
    expect((await profileMessage('SOLID_PROFILE_REMOVE', { profileId: '1' })).ok).toBe(true);
    release();
    expect(await delayed).toEqual({
      requestId: 'deleted-profile-fetch',
      error: 'Not authenticated',
    });
    expect(fetchCalls).toHaveLength(0);
  });

  it('preserves the fetch request ID on asynchronous storage failures', async () => {
    await twoProfiles();
    await loadWorker();
    profileDb.error = new Error('fixture storage unavailable');
    expect(await profileFetch(PROFILE_APP_A, { requestId: 'storage-error-fetch' })).toEqual({
      requestId: 'storage-error-fetch',
      error: 'Profile storage unavailable.',
    });
    expect(fetchCalls).toHaveLength(0);
  });

  it('migrates legacy session 1 once and clears legacy credentials only after commit', async () => {
    await seedSession();
    storage.set('solid:profile', {
      webId: 'https://alice.pod.example/profile/card#me',
      name: 'Alice',
      photoUrl: null,
    });
    storage.set('solid:granted-origins', [PROFILE_APP_A.origin]);
    storage.set('solid:pod-origins', ['https://extra.example']);
    await loadWorker();
    const migrated = profileDb.state.records[0];
    expect(migrated.profile).toMatchObject({
      id: '1',
      label: 'Alice',
      sessionState: 'active',
      dpopKeyRef: '1',
    });
    expect(migrated.keyPair?.privateKey.extractable).toBe(false);
    expect(migrated.session?.dpopJkt).toBeTruthy();
    expect(migrated.grantedOrigins).toEqual([PROFILE_APP_A.origin]);
    expect(migrated.podOrigins).toEqual(['https://extra.example']);
    expect(idbDpopKey).toBeUndefined();
    for (const key of ['session', 'profile', 'pod-origins', 'granted-origins', 'class-grants'])
      expect(storage.has(`solid:${key}`)).toBe(false);
    await loadWorker();
    expect(profileDb.state.records).toEqual([migrated]);
    expect((await profileMessage('SOLID_PROFILES_LIST')).defaultProfileId).toBe('1');
  });

  it('preserves a missing-key legacy profile for re-login without serving or refreshing its tokens', async () => {
    await seedSession();
    idbDpopKey = undefined;
    await loadWorker();
    expect(profileDb.state.records[0].profile.sessionState).toBe('signed-out');
    expect(profileDb.state.records[0].session).toBeNull();
    expect((await profileFetch()).error).toBe('Not authenticated');
    expect(fetchCalls).toHaveLength(0);
  });

  it('retries interrupted legacy cleanup without importing a second copy', async () => {
    await seedSession();
    const remove = chrome.storage.local.remove;
    let fail = true;
    chrome.storage.local.remove = vi.fn(async (key: string | string[]) => {
      if (fail) throw new Error('fixture interrupted cleanup');
      await remove(key);
    });
    await loadWorker();
    expect(profileDb.state.migrated).toBe(true);
    expect(profileDb.state.records).toHaveLength(1);
    expect((await profileFetch()).error).toBeDefined();
    fail = false;
    await loadWorker();
    expect(profileDb.state.records).toHaveLength(1);
    expect(storage.has('solid:session')).toBe(false);
  });
});
