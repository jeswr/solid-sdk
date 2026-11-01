// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6
/**
 * Unit tests for the popup's MessageBridgeLoginController — the chrome.identity-backed
 * LoginController that bridges the panel's SYNCHRONOUS getter contract to the ASYNC
 * service worker over the existing message protocol, WITHOUT ever holding a token.
 *
 * The credential boundary is the load-bearing assertion: the bridge must (a) expose the
 * module-pristine fetch as publicFetch, (b) never carry a token in any own property,
 * (c) never surface a (hypothetical) token field from a GET_STATE reply, and (d) proxy
 * authenticatedFetch via SOLID_FETCH_REQUEST with NO Authorization/DPoP header attached
 * popup-side (the token is SW-side only).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageBridgeLoginController } from '../src/popup/message-bridge-controller';
import {
  base64ToBytes,
  MAX_BODY_BYTES,
  REQUEST_BODY_LIMIT_ERROR,
  validateBodyFields,
} from '../src/shared/body-codec';
import type { FetchRequest, SessionState } from '../src/shared/messages';

/** A mock of `chrome.runtime.sendMessage` (callback form) returning a canned reply. */
type SendImpl = (message: unknown) => unknown;
let sendImpl: SendImpl;
const sentMessages: unknown[] = [];

function installChrome(impl: SendImpl): void {
  sendImpl = impl;
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined as { message?: string } | undefined,
      sendMessage: (message: unknown, callback: (response: unknown) => void) => {
        sentMessages.push(message);
        const request = message as Partial<FetchRequest>;
        if (request.type === 'SOLID_FETCH_REQUEST')
          validateBodyFields(request.body, request.bodyBase64);
        // Resolve asynchronously, like the real callback channel.
        Promise.resolve(sendImpl(message)).then((r) => callback(r));
      },
    },
  });
}

function activeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    webId: 'https://alice.pod.example/profile/card#me',
    isActive: true,
    name: 'Alice',
    photoUrl: 'https://alice.pod.example/avatar.png',
    recentAccounts: [],
    ...overrides,
  };
}

beforeEach(() => {
  sentMessages.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('restore() — silent restore round-trip + fail-closed', () => {
  it('sends SOLID_GET_STATE and resolves restored when isActive && webId', async () => {
    installChrome(() => activeState());
    const c = new MessageBridgeLoginController();
    const outcome = await c.restore();
    expect(sentMessages).toContainEqual({ type: 'SOLID_GET_STATE' });
    expect(outcome).toEqual({
      outcome: 'restored',
      webId: 'https://alice.pod.example/profile/card#me',
    });
  });

  it('resolves login when no active session', async () => {
    installChrome(() => activeState({ webId: null, isActive: false, name: null, photoUrl: null }));
    const c = new MessageBridgeLoginController();
    expect(await c.restore()).toEqual({ outcome: 'login' });
  });

  it('FAIL-CLOSED: resolves login (never throws) when the send rejects', async () => {
    installChrome(() => {
      throw new Error('channel error');
    });
    const c = new MessageBridgeLoginController();
    await expect(c.restore()).resolves.toEqual({ outcome: 'login' });
  });

  it('FAIL-CLOSED: a malformed state shape never leaves a half-set non-null webId', async () => {
    // First a clean active session (sets the mirror), THEN a malformed reply on hydrate.
    let call = 0;
    installChrome(() => {
      call += 1;
      if (call === 1) return activeState(); // restore() → logged in
      // hydrate() → recentAccounts is not an array → toRecentLoginAccount map throws.
      return { webId: 'https://x/#me', isActive: true, recentAccounts: 'not-an-array' };
    });
    const c = new MessageBridgeLoginController();
    await c.restore();
    expect(c.webId).toBe('https://alice.pod.example/profile/card#me');
    // hydrate() swallows the throw — and must NOT have committed the malformed webId.
    await c.hydrate();
    expect(c.webId).toBe('https://alice.pod.example/profile/card#me'); // unchanged, atomic
  });
});

describe('the synchronous seam is satisfied from the async source', () => {
  it('webId + recentAccounts read synchronously after restore()/hydrate()', async () => {
    installChrome(() =>
      activeState({
        recentAccounts: [
          { webId: 'https://bob.pod.example/card#me', name: 'Bob', photoUrl: null },
          { webId: 'https://carol.pod.example/card#me', name: null, photoUrl: 'https://c/p.png' },
        ],
      }),
    );
    const c = new MessageBridgeLoginController();
    await c.restore();

    // Synchronous getters now answer from the mirror.
    expect(c.webId).toBe('https://alice.pod.example/profile/card#me');
    expect(c.recentAccounts()).toEqual([
      { webId: 'https://bob.pod.example/card#me', displayName: 'Bob', avatarUrl: undefined },
      {
        webId: 'https://carol.pod.example/card#me',
        displayName: 'https://carol.pod.example/card#me',
        avatarUrl: 'https://c/p.png',
      },
    ]);
  });
});

describe('login()', () => {
  it('sends SOLID_LOGIN, sets the mirror and resolves on ok', async () => {
    installChrome((m) => {
      if ((m as { type: string }).type === 'SOLID_LOGIN') {
        return { ok: true, webId: 'https://x.example/#me' };
      }
      return activeState();
    });
    const c = new MessageBridgeLoginController();
    const result = await c.login('https://x.example/#me');
    expect(sentMessages).toContainEqual({ type: 'SOLID_LOGIN', webId: 'https://x.example/#me' });
    expect(result).toEqual({ webId: 'https://x.example/#me' });
    expect(c.webId).toBe('https://x.example/#me');
  });

  it('REJECTS with the error message and does NOT mutate #webId on error', async () => {
    installChrome(() => ({ error: 'User cancelled' }));
    const c = new MessageBridgeLoginController();
    await expect(c.login('https://x.example/#me')).rejects.toThrow('User cancelled');
    expect(c.webId).toBeNull();
  });

  it('defaults to the single recent account webId when none is passed', async () => {
    installChrome((m) => {
      if ((m as { type: string }).type === 'SOLID_GET_STATE') {
        return activeState({
          webId: null,
          isActive: false,
          name: null,
          photoUrl: null,
          recentAccounts: [{ webId: 'https://recent.example/#me', name: 'R', photoUrl: null }],
        });
      }
      return { ok: true, webId: 'https://recent.example/#me' };
    });
    const c = new MessageBridgeLoginController();
    await c.hydrate(); // populate the recent-accounts mirror
    await c.login();
    expect(sentMessages).toContainEqual({
      type: 'SOLID_LOGIN',
      webId: 'https://recent.example/#me',
    });
  });
});

describe('logout()', () => {
  it('sends SOLID_LOGOUT and clears #webId on ok', async () => {
    installChrome((m) => {
      if ((m as { type: string }).type === 'SOLID_LOGOUT') return { ok: true };
      return activeState();
    });
    const c = new MessageBridgeLoginController();
    await c.restore(); // sets #webId
    expect(c.webId).not.toBeNull();
    await c.logout();
    expect(sentMessages).toContainEqual({ type: 'SOLID_LOGOUT' });
    expect(c.webId).toBeNull();
  });

  it('on error rejects AND leaves #webId intact (panel keeps signed-in UI)', async () => {
    installChrome((m) => {
      const type = (m as { type: string }).type;
      if (type === 'SOLID_GET_STATE') return activeState();
      if (type === 'SOLID_LOGOUT') return { error: 'Logout failed' };
      return {};
    });
    const c = new MessageBridgeLoginController();
    await c.restore();
    const before = c.webId;
    await expect(c.logout()).rejects.toThrow('Logout failed');
    expect(c.webId).toBe(before);
    expect(c.webId).not.toBeNull();
  });
});

describe('NO-TOKEN-LEAK invariant', () => {
  it('publicFetch is STRICTLY the module-pristine fetch snapshot (not the live global)', async () => {
    installChrome(() => activeState());
    const c = new MessageBridgeLoginController();
    const before = c.publicFetch;

    // Even if some later code patches globalThis.fetch, publicFetch keeps the pristine snapshot.
    const original = globalThis.fetch;
    try {
      const patched = (() => Promise.resolve(new Response('patched'))) as typeof fetch;
      globalThis.fetch = patched;
      expect(c.publicFetch).toBe(before);
      expect(c.publicFetch).not.toBe(patched);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('the controller has NO own property holding a token, even after a session is active', async () => {
    installChrome(() => activeState());
    const c = new MessageBridgeLoginController();
    await c.restore();

    // Private #fields are not enumerable/own-accessible; assert no public surface leaks one.
    const ownKeys = [
      ...Object.getOwnPropertyNames(c),
      ...Object.keys(c as unknown as Record<string, unknown>),
    ];
    const serialised = JSON.stringify(Object.getOwnPropertyDescriptors(c));
    for (const forbidden of ['accessToken', 'refreshToken', 'dpop', 'privateKey', 'idToken']) {
      expect(ownKeys.some((k) => k.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false);
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('a hypothetical accessToken in a GET_STATE reply is NEVER surfaced via any getter', async () => {
    // A hostile/extra field on the wire must not flow into the mirror or its outputs.
    installChrome(() => ({
      ...activeState({
        recentAccounts: [{ webId: 'https://bob/#me', name: 'Bob', photoUrl: null }],
      }),
      accessToken: 'SECRET-TOKEN',
      refreshToken: 'SECRET-REFRESH',
    }));
    const c = new MessageBridgeLoginController();
    await c.restore();

    expect(c.webId).toBe('https://alice.pod.example/profile/card#me');
    const recents = JSON.stringify(c.recentAccounts());
    expect(recents).not.toContain('SECRET-TOKEN');
    expect(recents).not.toContain('SECRET-REFRESH');
    // No recent account carries a token field.
    for (const acct of c.recentAccounts()) {
      expect(Object.keys(acct).sort()).toEqual(['avatarUrl', 'displayName', 'webId']);
    }
  });

  it('authenticatedFetch sends SOLID_FETCH_REQUEST with NO Authorization/DPoP header popup-side', async () => {
    installChrome((m) => {
      if ((m as { type: string }).type === 'SOLID_FETCH_REQUEST') {
        return {
          requestId: (m as { requestId: string }).requestId,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/turtle' },
          body: '<#it> a <#Note>.',
        };
      }
      return activeState();
    });
    const c = new MessageBridgeLoginController();
    await c.restore(); // log in so authenticatedFetch is the proxy (not pristine)
    const res = await c.authenticatedFetch('https://alice.pod.example/private/notes.ttl');

    // It went over SOLID_FETCH_REQUEST, not a direct fetch.
    const fetchReq = sentMessages.find(
      (m) => (m as { type?: string }).type === 'SOLID_FETCH_REQUEST',
    ) as { url: string; method: string; headers: Record<string, string> };
    expect(fetchReq).toBeDefined();
    expect(fetchReq.url).toBe('https://alice.pod.example/private/notes.ttl');
    expect(fetchReq.method).toBe('GET');
    // CRITICAL: no credential attached popup-side — the SW attaches the DPoP token.
    const headerKeys = Object.keys(fetchReq.headers).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain('authorization');
    expect(headerKeys).not.toContain('dpop');

    // The Response is faithfully reconstructed from the FetchResponse.
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/turtle');
    expect(await res.text()).toBe('<#it> a <#Note>.');
  });

  it('authenticatedFetch surfaces a SW error (e.g. the SW session expired mid-popup)', async () => {
    installChrome((m) => {
      if ((m as { type: string }).type === 'SOLID_FETCH_REQUEST') {
        return { requestId: (m as { requestId: string }).requestId, error: 'Not authenticated' };
      }
      return activeState();
    });
    const c = new MessageBridgeLoginController();
    await c.restore(); // log in so authenticatedFetch is the proxy (not pristine)
    await expect(c.authenticatedFetch('https://alice.pod.example/x')).rejects.toThrow(
      'Not authenticated',
    );
  });

  it('BEFORE login, authenticatedFetch is the pristine fetch (contract: no session to bind)', async () => {
    installChrome(() => activeState({ webId: null, isActive: false, name: null, photoUrl: null }));
    const c = new MessageBridgeLoginController();
    await c.restore(); // no active session → #webId stays null
    expect(c.webId).toBeNull();
    // It is the pristine fetch (no proxy) — does NOT round-trip to the SW.
    expect(c.authenticatedFetch).toBe(c.publicFetch);
  });

  it('rebuilds a 204 No Content response (null-body status) without throwing', async () => {
    installChrome((m) => {
      if ((m as { type: string }).type === 'SOLID_FETCH_REQUEST') {
        // Null-body worker replies omit both body fields.
        return {
          requestId: (m as { requestId: string }).requestId,
          status: 204,
          statusText: 'No Content',
          headers: {},
        };
      }
      return activeState();
    });
    const c = new MessageBridgeLoginController();
    await c.restore(); // log in so authenticatedFetch is the proxy
    // A naive `new Response('', { status: 204 })` would THROW — this must not.
    const res = await c.authenticatedFetch('https://alice.pod.example/c/r.ttl', {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(await res.text()).toBe('');
  });

  it('authenticatedFetch normalises a Request input (url/method/headers/body) like fetch', async () => {
    installChrome((m) => {
      if ((m as { type: string }).type === 'SOLID_FETCH_REQUEST') {
        return { requestId: (m as { requestId: string }).requestId, status: 201, body: 'ok' };
      }
      return activeState();
    });
    const c = new MessageBridgeLoginController();
    await c.restore(); // log in so authenticatedFetch is the proxy (not pristine)
    const req = new Request('https://alice.pod.example/c/r.ttl', {
      method: 'PUT',
      headers: { 'content-type': 'text/turtle' },
      body: '<#it> a <#Note>.',
    });
    await c.authenticatedFetch(req);

    const sent = sentMessages.find(
      (m) => (m as { type?: string }).type === 'SOLID_FETCH_REQUEST',
    ) as FetchRequest;
    // NOT "[object Request]" — the Request's fields are read.
    expect(sent.url).toBe('https://alice.pod.example/c/r.ttl');
    expect(sent.method).toBe('PUT');
    expect(sent.headers['content-type']).toBe('text/turtle');
    expect(sent.body).toBeUndefined();
    expect(new TextDecoder().decode(base64ToBytes(sent.bodyBase64!))).toBe('<#it> a <#Note>.');
    // Still no credential popup-side.
    const headerKeys = Object.keys(sent.headers).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain('authorization');
    expect(headerKeys).not.toContain('dpop');
  });

  it.each([
    'overflow',
    'abort',
  ])('bounds popup Request reads before sending to the worker (%s)', async (kind) => {
    installChrome(() => activeState());
    const c = new MessageBridgeLoginController();
    await c.restore();
    sentMessages.length = 0;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
        if (kind === 'overflow') controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1));
        // Leave open: the read must reject without waiting for EOF.
      },
    });
    const request = new Request('https://alice.pod.example/upload', {
      method: 'PUT',
      body,
      headers: { 'content-type': 'text/turtle' },
      duplex: 'half',
    } as RequestInit);
    const controller = new AbortController();
    const promise = c.authenticatedFetch(request, { signal: controller.signal });
    if (kind === 'abort') controller.abort(new Error('popup cancelled'));
    await expect(promise).rejects.toThrow(
      kind === 'overflow' ? REQUEST_BODY_LIMIT_ERROR : 'popup cancelled',
    );
    expect(sentMessages).toHaveLength(0);
    expect(request.bodyUsed).toBe(false);
    stream.close();
  });

  it.each([
    ['binary MIME', 'image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff])],
    ['missing MIME', null, new Uint8Array([0x1f, 0x8b, 0xff, 0xfe, 0xc0])],
    ['empty MIME', '', new Uint8Array([0x1f, 0x8b, 0xff, 0xfe, 0xc0])],
    ['whitespace MIME', '   ', new Uint8Array([0x1f, 0x8b, 0xff, 0xfe, 0xc0])],
    ['text MIME with invalid UTF-8', 'text/plain', new Uint8Array([0xff, 0xc0])],
    ['untyped Turtle', null, new TextEncoder().encode('<#it> <#label> "héllo 🌍" .')],
    ['empty-typed Turtle', '', new TextEncoder().encode('<#it> <#label> "héllo 🌍" .')],
    ['UTF-8 BOM', 'text/plain', new Uint8Array([0xef, 0xbb, 0xbf, 0x41])],
  ] as const)('preserves opaque Request bytes (%s)', async (_label, contentType, bytes) => {
    installChrome((m) => {
      const message = m as FetchRequest;
      return message.type === 'SOLID_FETCH_REQUEST'
        ? { requestId: message.requestId, status: 201 }
        : activeState();
    });
    const c = new MessageBridgeLoginController();
    await c.restore();
    const req = new Request('https://alice.pod.example/upload', { method: 'PUT', body: bytes });
    if (contentType !== null) req.headers.set('content-type', contentType);
    expect((await c.authenticatedFetch(req)).status).toBe(201);
    const sent = sentMessages.find(
      (m) => (m as FetchRequest).type === 'SOLID_FETCH_REQUEST',
    ) as FetchRequest;
    expect(sent).not.toHaveProperty('body');
    expect(base64ToBytes(sent.bodyBase64!)).toEqual(bytes);
    expect(req.bodyUsed).toBe(false);
  });

  it('preserves an already constructed multipart Request byte-exact', async () => {
    installChrome((m) => {
      const message = m as FetchRequest;
      return message.type === 'SOLID_FETCH_REQUEST'
        ? { requestId: message.requestId, status: 201 }
        : activeState();
    });
    const c = new MessageBridgeLoginController();
    await c.restore();
    const form = new FormData();
    form.append('f', new Blob([new Uint8Array([0, 128, 255])]), 'b.bin');
    const req = new Request('https://alice.pod.example/upload', { method: 'POST', body: form });
    const expected = new Uint8Array(await req.clone().arrayBuffer());
    await c.authenticatedFetch(req);
    const sent = sentMessages.find(
      (m) => (m as FetchRequest).type === 'SOLID_FETCH_REQUEST',
    ) as FetchRequest;
    expect(base64ToBytes(sent.bodyBase64!)).toEqual(expected);
    expect(sent.headers['content-type']).toBe(req.headers.get('content-type'));
  });

  it('authenticatedFetch lets an explicit init override a Request (fetch semantics)', async () => {
    installChrome((m) => {
      if ((m as { type: string }).type === 'SOLID_FETCH_REQUEST') {
        return { requestId: (m as { requestId: string }).requestId, status: 200, body: '' };
      }
      return activeState();
    });
    const c = new MessageBridgeLoginController();
    await c.restore(); // log in so authenticatedFetch is the proxy (not pristine)
    const req = new Request('https://alice.pod.example/r', { method: 'GET' });
    await c.authenticatedFetch(req, { method: 'DELETE' });

    const sent = sentMessages.find(
      (m) => (m as { type?: string }).type === 'SOLID_FETCH_REQUEST',
    ) as { method: string };
    expect(sent.method).toBe('DELETE');
  });

  it('STRIPS caller-supplied Authorization/DPoP headers (init AND Request) — worker is the credential authority', async () => {
    installChrome((m) => {
      if ((m as { type: string }).type === 'SOLID_FETCH_REQUEST') {
        return { requestId: (m as { requestId: string }).requestId, status: 200, body: '' };
      }
      return activeState();
    });
    const c = new MessageBridgeLoginController();
    await c.restore(); // log in so authenticatedFetch is the proxy (not pristine)

    // via init.headers
    await c.authenticatedFetch('https://alice.pod.example/r', {
      headers: { Authorization: 'Bearer ATTACKER', DPoP: 'forged-proof', 'x-keep': 'yes' },
    });
    // via a Request object
    const req = new Request('https://alice.pod.example/r2', {
      headers: { authorization: 'Bearer ATTACKER2', dpop: 'forged-proof-2', 'x-keep': 'also' },
    });
    await c.authenticatedFetch(req);

    const reqs = sentMessages.filter(
      (m) => (m as { type?: string }).type === 'SOLID_FETCH_REQUEST',
    ) as Array<{ headers: Record<string, string> }>;
    expect(reqs).toHaveLength(2);
    for (const sent of reqs) {
      const keys = Object.keys(sent.headers).map((k) => k.toLowerCase());
      expect(keys).not.toContain('authorization');
      expect(keys).not.toContain('dpop');
      // Non-credential headers are preserved.
      expect(keys).toContain('x-keep');
    }
    // And no attacker value rode along anywhere.
    const wire = JSON.stringify(reqs);
    expect(wire).not.toContain('ATTACKER');
    expect(wire).not.toContain('forged-proof');
  });
});

describe('bounded text/base64 adapter protocol', () => {
  const url = 'https://alice.pod.example/resource';

  async function connect(reply: Record<string, unknown> = { status: 204 }) {
    installChrome((m) => {
      const message = m as FetchRequest;
      return message.type === 'SOLID_FETCH_REQUEST'
        ? { requestId: message.requestId, ...reply }
        : activeState();
    });
    const controller = new MessageBridgeLoginController();
    await controller.restore();
    sentMessages.length = 0;
    return controller;
  }

  it.each([undefined, null])('omits both body fields for absent init.body=%s', async (body) => {
    const controller = await connect();
    await controller.authenticatedFetch(url, { body });
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).not.toHaveProperty('body');
    expect(sentMessages[0]).not.toHaveProperty('bodyBase64');
  });

  it.each([
    ['string', (): string => 'héllo 🌍', { body: 'héllo 🌍' }],
    ['empty string', (): string => '', { body: '' }],
    ['ArrayBuffer', () => new Uint8Array([0, 128, 255]).buffer, { bodyBase64: 'AID/' }],
    [
      'typed-array subview',
      () => new Uint8Array([7, 0, 128, 255, 8]).subarray(1, 4),
      { bodyBase64: 'AID/' },
    ],
    [
      'DataView',
      () => new DataView(new Uint8Array([7, 0, 128, 255, 8]).buffer, 1, 3),
      { bodyBase64: 'AID/' },
    ],
    ['empty binary', () => new Uint8Array(0), { bodyBase64: '' }],
    [
      'Blob',
      () => new Blob([new Uint8Array([0, 128, 255])], { type: 'image/png' }),
      { bodyBase64: 'AID/', contentType: 'image/png' },
    ],
    [
      'File',
      () => new File([new Uint8Array([0, 128, 255])], 'x.pdf', { type: 'application/pdf' }),
      { bodyBase64: 'AID/', contentType: 'application/pdf' },
    ],
    [
      'URLSearchParams',
      () => new URLSearchParams({ label: 'héllo 🌍' }),
      {
        body: 'label=h%C3%A9llo+%F0%9F%8C%8D',
        contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
      },
    ],
  ] as const)('uses the page bridge encoding for %s', async (_label, makeBody, expected) => {
    const controller = await connect();
    await controller.authenticatedFetch(url, { method: 'POST', body: makeBody() });
    const sent = sentMessages[0] as FetchRequest;
    expect(sent.body).toBe('body' in expected ? expected.body : undefined);
    expect(sent.bodyBase64).toBe('bodyBase64' in expected ? expected.bodyBase64 : undefined);
    if ('body' in expected) expect(sent).not.toHaveProperty('bodyBase64');
    else expect(sent).not.toHaveProperty('body');
    if ('contentType' in expected) expect(sent.headers['content-type']).toBe(expected.contentType);
  });

  it.each([
    { bodyBase64: 'AID/', expected: [0, 128, 255] },
    { bodyBase64: '', expected: [] },
  ])('decodes binary replies, including an empty binary body (case %#)', async ({
    bodyBase64,
    expected,
  }) => {
    const controller = await connect({ status: 200, bodyBase64 });
    const response = await controller.authenticatedFetch(url);
    expect(new Uint8Array(await response.clone().arrayBuffer())).toEqual(new Uint8Array(expected));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(expected));
  });

  it.each([
    { body: 'text', bodyBase64: 'AA==' },
    { body: null },
    { body: 42 },
    { bodyBase64: null },
    { bodyBase64: 42 },
    { bodyBase64: 'AA A' },
    { bodyBase64: 'AB==' },
  ])('rejects malformed worker body fields before decoding (case %#)', async (fields) => {
    const controller = await connect({ status: 200, ...fields });
    const decode = vi.spyOn(globalThis, 'atob');
    await expect(controller.authenticatedFetch(url)).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([
    'base64',
    'padding overflow',
    'text',
    'multibyte text',
  ])('rejects an oversized %s reply before binary decoding', async (kind) => {
    const fields =
      kind === 'base64'
        ? { bodyBase64: 'A'.repeat(Math.ceil(MAX_BODY_BYTES / 3) * 4 + 4) }
        : kind === 'padding overflow'
          ? { bodyBase64: `${'A'.repeat(Math.ceil(MAX_BODY_BYTES / 3) * 4 - 1)}=` }
          : {
              body:
                kind === 'text'
                  ? 'a'.repeat(MAX_BODY_BYTES + 1)
                  : 'é'.repeat(MAX_BODY_BYTES / 2 + 1),
            };
    const controller = await connect({ status: 200, ...fields });
    const decode = vi.spyOn(globalThis, 'atob');
    await expect(controller.authenticatedFetch(url)).rejects.toThrow(REQUEST_BODY_LIMIT_ERROR);
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([
    ['text', () => 'a'.repeat(MAX_BODY_BYTES + 1)],
    ['multibyte text', () => 'é'.repeat(MAX_BODY_BYTES / 2 + 1)],
    ['bytes', () => new Uint8Array(MAX_BODY_BYTES + 1)],
    ['Blob', () => new Blob([new Uint8Array(MAX_BODY_BYTES + 1)])],
  ] as const)('bounds known %s request sizes before native Request construction', async (_label, makeBody) => {
    const controller = await connect();
    const body = makeBody();
    const construct = vi.fn();
    vi.stubGlobal(
      'Request',
      new Proxy(Request, {
        construct(target, args) {
          construct();
          return Reflect.construct(target, args);
        },
      }),
    );
    await expect(controller.authenticatedFetch(url, { method: 'PUT', body })).rejects.toThrow(
      REQUEST_BODY_LIMIT_ERROR,
    );
    expect(construct).not.toHaveBeenCalled();
    expect(sentMessages).toHaveLength(0);
  });

  it.each([
    () => new FormData(),
    () => new ReadableStream(),
  ])('rejects unsupported direct request bodies before sending (case %#)', async (makeBody) => {
    const controller = await connect();
    await expect(
      controller.authenticatedFetch(url, { method: 'POST', body: makeBody() }),
    ).rejects.toThrow('does not support FormData or ReadableStream');
    expect(sentMessages).toHaveLength(0);
  });

  it('snapshots mutable request bytes and headers before yielding', async () => {
    const controller = await connect();
    const bytes = new Uint8Array([0, 128, 255]);
    const headers = new Headers({ 'content-type': 'image/png' });
    const init = { method: 'PUT', body: bytes, headers };
    const result = controller.authenticatedFetch(url, init);
    bytes.fill(42);
    headers.set('content-type', 'text/plain');
    init.method = 'POST';
    await result;
    expect(sentMessages[0]).toMatchObject({
      method: 'PUT',
      bodyBase64: 'AID/',
      headers: { 'content-type': 'image/png' },
    });
  });

  it('inherits a Request body when init.body is null and preserves its bytes', async () => {
    const controller = await connect();
    const req = new Request(url, { method: 'PUT', body: new Uint8Array([0, 128, 255]) });
    await controller.authenticatedFetch(req, { body: null });
    expect(sentMessages[0]).toMatchObject({ bodyBase64: 'AID/' });
    expect(req.bodyUsed).toBe(false);
  });

  it('lets a body override replace a consumed Request body', async () => {
    const controller = await connect();
    const req = new Request(url, { method: 'PUT', body: 'consumed' });
    await req.text();
    await controller.authenticatedFetch(req, { body: new Uint8Array([0, 128, 255]) });
    expect(sentMessages[0]).toMatchObject({ bodyBase64: 'AID/' });
  });

  it('rejects pre-aborted requests without sending to the worker', async () => {
    const controller = await connect();
    const signal = AbortSignal.abort(new Error('already cancelled'));
    await expect(controller.authenticatedFetch(url, { signal })).rejects.toThrow(
      'already cancelled',
    );
    expect(sentMessages).toHaveLength(0);
  });

  it('rejects a GET body before sending to the worker', async () => {
    const controller = await connect();
    await expect(controller.authenticatedFetch(url, { body: new Uint8Array([0]) })).rejects.toThrow(
      'GET/HEAD',
    );
    expect(sentMessages).toHaveLength(0);
  });
});
