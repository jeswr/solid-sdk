// AUTHORED-BY Claude Opus 4.8
//
// The MAIN-world inject (window.solid + the global-fetch transparency patch). These cover the
// two roborev findings against inject.ts:
//   - HIGH #1: the global-fetch patch routes a cross-origin request but marks it `autoDivert`
//     so the SW can native-passthrough a non-pod/un-granted request (the page-compat invariant
//     is enforced SW-side; here we prove the inject sends the flag + leaves same-origin native).
//   - MEDIUM #2: a DOUBLE injection (manifest + dynamic registration) is INERT — the second run
//     is a no-op, never a throw on the `configurable:false` defineProperty.
//
// Each test gets a FRESH JSDOM window (the inject defines `window.solid` non-configurable, so a
// shared window could not be reset between tests). We rebind the relevant globals to that
// window, then re-import the module (which installs at import) under a reset module registry.

// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, REQUEST_BODY_LIMIT_ERROR } from '../src/shared/body-codec';

let dom: JSDOM;
let posted: Array<Record<string, unknown>>;
let nativeFetch: ReturnType<typeof vi.fn>;
const savedGlobals: Record<string, PropertyDescriptor | undefined> = {};

function setGlobal(name: string, value: unknown): void {
  if (!(name in savedGlobals)) {
    savedGlobals[name] = Object.getOwnPropertyDescriptor(globalThis, name);
  }
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function freshWindow(): void {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://app.example/page.html',
  });
  const win = dom.window as unknown as Window & typeof globalThis;
  posted = [];
  // Capture page→content messages.
  win.postMessage = ((msg: unknown) => {
    posted.push(msg as Record<string, unknown>);
  }) as typeof win.postMessage;
  // jsdom does NOT implement fetch/Response; Node's globals do. Keep Node's Response/Headers/URL
  // (the inject builds Responses with them) and only swap in the jsdom window + a stub fetch.
  nativeFetch = vi.fn(async () => new Response('native', { status: 200 }));
  win.fetch = nativeFetch as unknown as typeof fetch;
  let n = 0;
  const cryptoStub = { randomUUID: () => `uuid-${n++}` };
  // jsdom's window.crypto is a getter-only accessor — redefine it.
  Object.defineProperty(win, 'crypto', { configurable: true, value: cryptoStub });
  // The module references the bare globals `window` + `crypto`; `Response`/`Headers`/`URL` stay
  // Node's (jsdom's are non-functional here), which the inject's `new URL(...)` etc. need.
  setGlobal('window', win);
  setGlobal('crypto', cryptoStub);
}

/** Fresh module each test (the inject installs at import). */
async function importInject(): Promise<void> {
  vi.resetModules();
  await import('../src/inject/inject');
  dom.window.dispatchEvent(
    new dom.window.MessageEvent('message', {
      source: dom.window,
      data: {
        channel: 'solid-browser-ext',
        dir: 'to-page',
        type: 'SOLID_STATE_UPDATE',
        webId: 'https://pod.example/#me',
      },
    }),
  );
}

beforeEach(() => {
  freshWindow();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [name, desc] of Object.entries(savedGlobals)) {
    if (desc) Object.defineProperty(globalThis, name, desc);
    else delete (globalThis as Record<string, unknown>)[name];
    delete savedGlobals[name];
  }
  dom.window.close();
});

describe('inject — installs window.solid + patches fetch', () => {
  it('defines window.solid and patches window.fetch on first run', async () => {
    expect('solid' in dom.window).toBe(false);
    await importInject();
    expect('solid' in dom.window).toBe(true);
    expect(typeof (dom.window as { solid?: { fetch?: unknown } }).solid?.fetch).toBe('function');
    // It asked the worker for state on load.
    expect(posted.some((m) => m.type === 'SOLID_GET_STATE')).toBe(true);
    // The global fetch is no longer the pristine sentinel.
    expect(dom.window.fetch).not.toBe(nativeFetch);
  });

  it('announces presence: a sticky <html data-solid-extension> marker + a solid-extension:ready event', async () => {
    // A page hides its own account chrome when the extension is present; it needs a reliable,
    // race-free presence signal. Assert BOTH announce channels the inject sets up.
    const readyEvents: Event[] = [];
    dom.window.addEventListener('solid-extension:ready', (e) => readyEvents.push(e));
    expect(dom.window.document.documentElement.getAttribute('data-solid-extension')).toBeNull();
    await importInject();
    // 1. the STICKY DOM marker — readable synchronously by app code regardless of load order.
    expect(dom.window.document.documentElement.getAttribute('data-solid-extension')).toBe('1');
    // 2. the one-shot event — for a listener attached before the inject ran.
    expect(readyEvents).toHaveLength(1);
    // The announce carries NO identity: webId stays on window.solid (null until auth).
    expect((dom.window as unknown as { solid: { webId: unknown } }).solid.webId).toBe(
      'https://pod.example/#me',
    );
  });
});

describe('inject — HIGH #1: the global-fetch patch marks routed requests autoDivert', () => {
  it('a CROSS-ORIGIN fetch is routed to the SW with autoDivert=true (so the SW can native-pass)', async () => {
    await importInject();
    posted.length = 0;
    // Fire a cross-origin fetch (a third-party API the app calls). It is routed (not awaited).
    void dom.window.fetch('https://api.thirdparty.example/data');
    const routed = posted.find((m) => m.type === 'SOLID_FETCH_REQUEST');
    expect(routed).toBeDefined();
    expect(routed?.url).toBe('https://api.thirdparty.example/data');
    // The flag that lets the SW native-passthrough instead of hard-failing the page.
    expect(routed?.autoDivert).toBe(true);
    // It did NOT go straight to the native fetch (it was diverted to the bridge).
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('a SAME-ORIGIN fetch stays on the untouched NATIVE fetch (no proxy tax, never routed)', async () => {
    await importInject();
    posted.length = 0;
    await dom.window.fetch('https://app.example/assets/app.js');
    // No routing message — same-origin asset went straight to native.
    expect(posted.some((m) => m.type === 'SOLID_FETCH_REQUEST')).toBe(false);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it('a RELATIVE fetch stays native (resolves to same-origin)', async () => {
    await importInject();
    posted.length = 0;
    await dom.window.fetch('/api/local');
    expect(posted.some((m) => m.type === 'SOLID_FETCH_REQUEST')).toBe(false);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it('a non-http(s) scheme (data:) stays native (never routed)', async () => {
    await importInject();
    posted.length = 0;
    await dom.window.fetch('data:text/plain,hello');
    expect(posted.some((m) => m.type === 'SOLID_FETCH_REQUEST')).toBe(false);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it('an EXPLICIT window.solid.fetch carries autoDivert=false (keeps the SW 403, not passthrough)', async () => {
    await importInject();
    posted.length = 0;
    const solid = (dom.window as unknown as { solid: { fetch: (u: string) => Promise<Response> } })
      .solid;
    void solid.fetch('https://alice.pod.example/private/notes.ttl');
    const routed = posted.find((m) => m.type === 'SOLID_FETCH_REQUEST');
    expect(routed).toBeDefined();
    // The explicit API path is NOT auto-diverted — a deny here is the caller's expected 403.
    expect(routed?.autoDivert).toBe(false);
  });
});

// --- Round-2 High #1: the page-side passthrough sentinel handler ------------------------
//
// When the SW returns `{ passthrough: true }` (it declined an autoDivert request and did NO
// network), the inject MUST complete the pending promise by calling the page's OWN native fetch
// (PRISTINE_FETCH) with the ORIGINAL input/init — never fabricate a Response from SW data.

/** Deliver a `to-page` message into the inject's window 'message' listener. */
function deliverToPage(message: Record<string, unknown>): void {
  const win = dom.window as unknown as Window;
  const event = new dom.window.MessageEvent('message', {
    data: { channel: 'solid-browser-ext', dir: 'to-page', ...message },
    source: win as unknown as MessageEventSource,
  });
  win.dispatchEvent(event);
}

describe('inject — fetch response URL metadata', () => {
  it.each([
    false,
    true,
  ])('preserves the worker URL and redirected=%s on the response and repeated clones', async (redirected) => {
    await importInject();
    posted.length = 0;
    const original = 'https://alice.pod.example/private/notes';
    const final = redirected ? `${original}/?view=1` : original;
    const solid = (dom.window as unknown as { solid: { fetch: typeof fetch } }).solid;
    const promise = solid.fetch(original);
    const routed = posted.find((m) => m.type === 'SOLID_FETCH_REQUEST');
    deliverToPage({
      type: 'SOLID_FETCH_RESPONSE',
      requestId: routed?.requestId,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/turtle' },
      body: '<#it> <relative> <child.ttl> .',
      url: final,
      redirected,
    });

    const response = await promise;
    const clone = response.clone();
    const nextClone = clone.clone();
    expect(clone).not.toBe(response);
    expect(nextClone).not.toBe(clone);
    for (const copy of [response, clone, nextClone]) {
      expect(copy).toBeInstanceOf(Response);
      expect(copy.url).toBe(final);
      expect(copy.redirected).toBe(redirected);
      expect(Reflect.set(copy, 'url', 'https://other.example/')).toBe(false);
      expect(Reflect.set(copy, 'redirected', !redirected)).toBe(false);
      expect(new URL('child.ttl', copy.url).href).toBe(
        redirected
          ? 'https://alice.pod.example/private/notes/child.ttl'
          : 'https://alice.pod.example/private/child.ttl',
      );
      expect(copy.status).toBe(200);
      expect(copy.statusText).toBe('OK');
      expect(copy.headers.get('content-type')).toBe('text/turtle');
      expect(copy.bodyUsed).toBe(false);
      expect(await copy.text()).toBe('<#it> <relative> <child.ttl> .');
      expect(copy.bodyUsed).toBe(true);
      expect(() => copy.clone()).toThrow(TypeError);
    }
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('keeps default metadata when an older worker reply omits it', async () => {
    await importInject();
    posted.length = 0;
    const solid = (dom.window as unknown as { solid: { fetch: typeof fetch } }).solid;
    const promise = solid.fetch('https://alice.pod.example/private/notes');
    const routed = posted.find((m) => m.type === 'SOLID_FETCH_REQUEST');
    deliverToPage({ type: 'SOLID_FETCH_RESPONSE', requestId: routed?.requestId, status: 200 });
    const response = await promise;
    expect(response.url).toBe('');
    expect(response.redirected).toBe(false);
  });
});

describe('inject — Round-2 High #1: a passthrough sentinel is completed by the page native fetch', () => {
  it('resolves a routed fetch by calling PRISTINE_FETCH with the ORIGINAL input + init, NOT a fabricated Response', async () => {
    await importInject();
    posted.length = 0;
    // Make the native fetch return a distinctive body so we can prove the resolved Response came
    // from PRISTINE_FETCH, not from any SW-supplied bytes.
    const nativeResponse = new Response('NATIVE-IN-PAGE-BYTES', { status: 207 });
    Object.defineProperties(nativeResponse, {
      url: { value: 'https://api.thirdparty.example/final' },
      redirected: { value: true },
    });
    nativeFetch.mockResolvedValueOnce(nativeResponse);

    const init: RequestInit = { method: 'POST', headers: { 'X-App': 'v1' }, body: 'payload' };
    const promise = (
      dom.window as unknown as { fetch: (u: string, i?: RequestInit) => Promise<Response> }
    ).fetch('https://api.thirdparty.example/data', init);

    // The request was routed to the SW with autoDivert=true; nativeFetch not called YET.
    const routed = posted.find((m) => m.type === 'SOLID_FETCH_REQUEST');
    expect(routed).toBeDefined();
    expect(routed?.autoDivert).toBe(true);
    expect(nativeFetch).not.toHaveBeenCalled();
    const requestId = routed?.requestId as string;

    // The SW replies with the passthrough SENTINEL (no body/status — it did no network).
    deliverToPage({ type: 'SOLID_FETCH_RESPONSE', requestId, passthrough: true });

    const response = await promise;
    // The promise resolved with the PAGE's native fetch result (the SW gave no bytes).
    expect(response).toBe(nativeResponse);
    expect(response.url).toBe('https://api.thirdparty.example/final');
    expect(response.redirected).toBe(true);
    expect(await response.text()).toBe('NATIVE-IN-PAGE-BYTES');
    expect(response.status).toBe(207);
    // PRISTINE_FETCH was called with the ORIGINAL input + a faithful init SNAPSHOT (round-3
    // Medium: the init is COPIED at call time, so it is value-equal but NOT the same reference).
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    const [calledInput, calledInit] = nativeFetch.mock.calls[0] as [string, RequestInit];
    expect(calledInput).toBe('https://api.thirdparty.example/data');
    expect(calledInit).not.toBe(init); // a snapshot copy, not the caller's object
    expect(calledInit.method).toBe('POST');
    expect(calledInit.body).toBe('payload');
    expect(new Headers(calledInit.headers).get('X-App')).toBe('v1');
  });

  it('round-3 Medium: the passthrough request is SNAPSHOT at call time — a later mutation of init.headers / init.credentials / a URL input cannot change it', async () => {
    await importInject();
    posted.length = 0;
    nativeFetch.mockResolvedValueOnce(new Response('OK', { status: 200 }));

    // A mutable URL object + an init the caller will mutate AFTER the call (as native fetch would
    // have already snapshotted them synchronously).
    const url = new dom.window.URL('https://api.thirdparty.example/data');
    const headers = new dom.window.Headers({ 'X-App': 'v1' });
    const init: RequestInit = {
      method: 'GET',
      headers: headers as unknown as HeadersInit,
      credentials: 'include',
    };
    const promise = (
      dom.window as unknown as { fetch: (u: URL, i?: RequestInit) => Promise<Response> }
    ).fetch(url as unknown as URL, init);

    const routed = posted.find((m) => m.type === 'SOLID_FETCH_REQUEST');
    const requestId = routed?.requestId as string;
    expect(nativeFetch).not.toHaveBeenCalled();

    // MUTATE the caller's objects after the call but BEFORE the sentinel arrives.
    url.pathname = '/HIJACKED';
    headers.set('X-App', 'TAMPERED');
    headers.set('X-Injected', 'yes');
    init.credentials = 'omit';

    deliverToPage({ type: 'SOLID_FETCH_RESPONSE', requestId, passthrough: true });
    await promise;

    // PRISTINE_FETCH saw the values AS THEY WERE AT CALL TIME, not the mutated ones.
    const [calledInput, calledInit] = nativeFetch.mock.calls[0] as [
      string | URL,
      RequestInit | undefined,
    ];
    expect(calledInput.toString()).toBe('https://api.thirdparty.example/data');
    expect(new Headers(calledInit?.headers).get('X-App')).toBe('v1');
    expect(new Headers(calledInit?.headers).has('X-Injected')).toBe(false);
    expect(calledInit?.credentials).toBe('include');
  });

  it('a passthrough sentinel that REJECTS (CORS block) rejects the page promise exactly as native', async () => {
    await importInject();
    posted.length = 0;
    const corsError = new TypeError('Failed to fetch');
    nativeFetch.mockRejectedValueOnce(corsError);

    const promise = (dom.window as unknown as { fetch: (u: string) => Promise<Response> }).fetch(
      'https://blocked.example/data',
    );
    const routed = posted.find((m) => m.type === 'SOLID_FETCH_REQUEST');
    const requestId = routed?.requestId as string;

    deliverToPage({ type: 'SOLID_FETCH_RESPONSE', requestId, passthrough: true });

    await expect(promise).rejects.toBe(corsError);
  });

  it('a NON-passthrough SW response (gated path) still resolves from SW data, never the native fetch', async () => {
    await importInject();
    posted.length = 0;
    const solid = (
      dom.window as unknown as {
        solid: { fetch: (u: string) => Promise<Response> };
      }
    ).solid;
    // Explicit window.solid.fetch → autoDivert=false → never a passthrough sentinel.
    const promise = solid.fetch('https://alice.pod.example/private/notes.ttl');
    const routed = posted.find((m) => m.type === 'SOLID_FETCH_REQUEST');
    expect(routed?.autoDivert).toBe(false);
    const requestId = routed?.requestId as string;

    // The SW returns real (gated, authenticated) bytes — no passthrough flag.
    deliverToPage({
      type: 'SOLID_FETCH_RESPONSE',
      requestId,
      status: 200,
      body: 'GATED-POD-BYTES',
      headers: {},
    });

    const response = await promise;
    expect(await response.text()).toBe('GATED-POD-BYTES');
    expect(response.status).toBe(200);
    // The native fetch was NOT used on the gated path.
    expect(nativeFetch).not.toHaveBeenCalled();
  });
});

describe('inject — MEDIUM #2: a double injection is INERT (no throw on the second run)', () => {
  it('importing/running the inject TWICE does not throw and installs window.solid once', async () => {
    await importInject();
    expect('solid' in dom.window).toBe(true);
    const firstSolid = (dom.window as unknown as { solid: unknown }).solid;

    // A second run (the other injection mechanism / a reload) must be a silent no-op — NOT a
    // throw on Object.defineProperty(window,'solid',{configurable:false}).
    await expect(importInject()).resolves.toBeUndefined();
    // window.solid is unchanged (the configurable:false property was never re-defined).
    expect((dom.window as unknown as { solid: unknown }).solid).toBe(firstSolid);
  });

  it('the guard short-circuits when window.solid already exists (different prior code path)', async () => {
    // Simulate a prior install from another path (window.solid present, marker absent).
    Object.defineProperty(dom.window, 'solid', {
      value: Object.freeze({ sentinel: true }),
      configurable: false,
    });
    delete (dom.window as { __solidInjected?: boolean }).__solidInjected;
    // Must not throw, and must NOT clobber the existing (frozen, non-configurable) property.
    await expect(importInject()).resolves.toBeUndefined();
    expect((dom.window as unknown as { solid: { sentinel?: boolean } }).solid.sentinel).toBe(true);
  });
});

it('keeps an ungranted origin stub-only, preserving native fetch; removes capabilities on revoke', async () => {
  vi.resetModules();
  await import('../src/inject/inject');
  const stub = (dom.window as unknown as { solid: Record<string, unknown> }).solid;
  expect(Object.keys(stub).sort()).toEqual(['disconnect', 'login', 'requestAccess']);
  expect(stub.webId).toBeUndefined();
  expect(stub.fetch).toBeUndefined();
  expect(dom.window.fetch).toBe(nativeFetch);
  const update = (webId: string | null) =>
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        source: dom.window,
        data: { channel: 'solid-browser-ext', dir: 'to-page', type: 'SOLID_STATE_UPDATE', webId },
      }),
    );
  update('https://pod.example/#me');
  expect(typeof stub.fetch).toBe('function');
  expect(dom.window.fetch).not.toBe(nativeFetch);
  update(null);
  expect(Object.keys(stub).sort()).toEqual(['disconnect', 'login', 'requestAccess']);
  expect(dom.window.fetch).toBe(nativeFetch);
});

// Binary transport and Request inputs (sst-bwc.2).
function solidApi(): { fetch: typeof fetch } {
  return (dom.window as unknown as { solid: { fetch: typeof fetch } }).solid;
}

async function fetchMessage(): Promise<Record<string, unknown>> {
  await vi.waitFor(() => expect(posted.some((m) => m.type === 'SOLID_FETCH_REQUEST')).toBe(true));
  return posted.find((m) => m.type === 'SOLID_FETCH_REQUEST')!;
}

function finishFetch(message: Record<string, unknown>): void {
  deliverToPage({ type: 'SOLID_FETCH_RESPONSE', requestId: message.requestId, status: 204 });
}

describe('inject — binary bodies and Request inputs', () => {
  it.each([
    ['string', (): string => 'héllo', { body: 'héllo' }],
    ['ArrayBuffer', () => new Uint8Array([0, 128, 255]).buffer, { bodyBase64: 'AID/' }],
    [
      'Uint8Array slice',
      () => new Uint8Array([9, 0, 128, 255, 9]).subarray(1, 4),
      { bodyBase64: 'AID/' },
    ],
    [
      'DataView slice',
      () => new DataView(new Uint8Array([9, 0, 128, 255, 9]).buffer, 1, 3),
      { bodyBase64: 'AID/' },
    ],
    ['Uint16Array', () => new Uint16Array(new Uint8Array([0, 128]).buffer), { bodyBase64: 'AIA=' }],
    ['empty bytes', () => new Uint8Array(0), { bodyBase64: '' }],
    [
      'Blob',
      () => new Blob([new Uint8Array([0, 128, 255])], { type: 'image/png' }),
      { bodyBase64: 'AID/', contentType: 'image/png' },
    ],
    [
      'File',
      () => new File([new Uint8Array([0, 128, 255])], 'test.pdf', { type: 'application/pdf' }),
      { bodyBase64: 'AID/', contentType: 'application/pdf' },
    ],
    ['untyped Blob', () => new Blob(['abc']), { bodyBase64: 'YWJj' }],
    [
      'URLSearchParams',
      () => new URLSearchParams({ a: 'hello world' }),
      { body: 'a=hello+world', contentType: 'application/x-www-form-urlencoded;charset=UTF-8' },
    ],
  ] as const)('serializes %s with the appropriate wire field and default MIME', async (_name, makeBody, expected) => {
    await importInject();
    posted.length = 0;
    const promise = solidApi().fetch('https://pod.example/data', {
      method: 'PUT',
      body: makeBody(),
    });
    const message = await fetchMessage();
    expect(message.body).toBe('body' in expected ? expected.body : undefined);
    expect(message.bodyBase64).toBe('bodyBase64' in expected ? expected.bodyBase64 : undefined);
    expect(new Headers(message.headers as HeadersInit).get('content-type')).toBe(
      'contentType' in expected ? expected.contentType : null,
    );
    finishFetch(message);
    await promise;
  });

  it.each([
    () => new Blob(['a'], { type: 'image/png' }),
    () => new URLSearchParams('a=b'),
  ])('preserves an explicit Content-Type', async (makeBody) => {
    await importInject();
    posted.length = 0;
    const promise = dom.window.fetch('https://pod.example/data', {
      method: 'PUT',
      body: makeBody(),
      headers: { 'Content-Type': 'application/custom' },
    });
    const message = await fetchMessage();
    expect(message.headers).toEqual({ 'content-type': 'application/custom' });
    finishFetch(message);
    await promise;
  });

  it('snapshots bytes, headers, URL and init before any asynchronous relay or native fallback', async () => {
    await importInject();
    posted.length = 0;
    const bytes = new Uint8Array([9, 0, 128, 255, 9]);
    const headers = new Headers({ 'X-App': 'original' });
    const url = new URL('https://pod.example/data');
    const init: RequestInit = { method: 'PUT', headers, body: bytes.subarray(1, 4) };
    const promise = dom.window.fetch(url, init);
    bytes.fill(42);
    headers.set('X-App', 'mutated');
    url.pathname = '/mutated';
    init.method = 'DELETE';
    const message = await fetchMessage();
    expect(message).toMatchObject({
      url: 'https://pod.example/data',
      method: 'PUT',
      bodyBase64: 'AID/',
      headers: { 'x-app': 'original' },
    });
    deliverToPage({
      type: 'SOLID_FETCH_RESPONSE',
      requestId: message.requestId,
      passthrough: true,
    });
    await promise;
    const [nativeUrl, nativeInit] = nativeFetch.mock.calls[0] as [string, RequestInit];
    expect(nativeUrl).toBe('https://pod.example/data');
    expect(nativeInit.method).toBe('PUT');
    expect(nativeInit.body).toEqual(new Uint8Array([0, 128, 255]));
    expect(new Headers(nativeInit.headers).get('x-app')).toBe('original');
  });

  it.each([
    () => new FormData(),
    () => new ReadableStream(),
  ])('rejects unsupported explicit bodies and keeps autoDivert on pristine native fetch', async (makeBody) => {
    await importInject();
    posted.length = 0;
    const body = makeBody();
    const init = { method: 'POST', body, duplex: 'half' } as RequestInit;
    await expect(solidApi().fetch('https://pod.example/data', init)).rejects.toThrow(
      'does not support FormData or ReadableStream',
    );
    if (body instanceof ReadableStream) expect(body.locked).toBe(false);
    // Replacing the global later cannot poison the captured fallback.
    const patch = dom.window.fetch;
    dom.window.fetch = vi.fn();
    await patch('https://pod.example/data', init);
    expect(nativeFetch).toHaveBeenCalledWith(
      'https://pod.example/data',
      expect.objectContaining({ body }),
    );
    expect(posted).toHaveLength(0);
  });

  it.each([
    false,
    true,
  ])('routes Request fields and byte-exact bodies (patched=%s)', async (patched) => {
    await importInject();
    posted.length = 0;
    const request = new Request('https://pod.example/data', {
      method: 'PUT',
      headers: { 'X-App': 'request' },
      body: new Uint8Array([0, 128, 255]),
    });
    const promise = (patched ? dom.window.fetch : solidApi().fetch)(request);
    const message = await fetchMessage();
    expect(message).toMatchObject({
      url: request.url,
      method: 'PUT',
      headers: { 'x-app': 'request' },
      bodyBase64: 'AID/',
      autoDivert: patched,
    });
    expect(message.body).toBeUndefined();
    expect(request.bodyUsed).toBe(false);
    finishFetch(message);
    await promise;
  });

  it('init replaces Request method, headers and body, snapshotting overrides', async () => {
    await importInject();
    posted.length = 0;
    const request = new Request('https://pod.example/data', {
      method: 'PUT',
      headers: { 'X-Old': 'old' },
      body: 'original',
    });
    const bytes = new Uint8Array([0, 128, 255]);
    const headers = new Headers({ 'X-New': 'new' });
    const promise = solidApi().fetch(request, { method: 'PATCH', headers, body: bytes });
    bytes.fill(42);
    headers.set('X-New', 'mutated');
    const message = await fetchMessage();
    expect(message).toMatchObject({
      method: 'PATCH',
      headers: { 'x-new': 'new' },
      bodyBase64: 'AID/',
    });
    expect(message.body).toBeUndefined();
    finishFetch(message);
    await promise;
  });

  it('inherits the Request body with a null init body, and preserves the native fallback clone', async () => {
    await importInject();
    posted.length = 0;
    const request = new Request('https://pod.example/data', {
      method: 'POST',
      headers: { 'X-App': 'original' },
      body: new Uint8Array([0, 128, 255]),
    });
    const promise = dom.window.fetch(request, { body: null });
    request.headers.set('X-App', 'mutated');
    await request.arrayBuffer();
    const message = await fetchMessage();
    expect(message).toMatchObject({
      method: 'POST',
      bodyBase64: 'AID/',
      headers: { 'x-app': 'original' },
    });
    deliverToPage({
      type: 'SOLID_FETCH_RESPONSE',
      requestId: message.requestId,
      passthrough: true,
    });
    await promise;
    const [copy] = nativeFetch.mock.calls[0] as [Request];
    expect(copy).not.toBe(request);
    expect(copy.headers.get('x-app')).toBe('original');
    expect(new Uint8Array(await copy.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255]));
  });

  it('allows an init body to replace an already consumed Request body, as native fetch does', async () => {
    await importInject();
    posted.length = 0;
    const request = new Request('https://pod.example/data', { method: 'POST', body: 'original' });
    await request.text();
    const promise = solidApi().fetch(request, { body: new Uint8Array([0, 128, 255]) });
    const message = await fetchMessage();
    expect(message).toMatchObject({ method: 'POST', bodyBase64: 'AID/' });
    finishFetch(message);
    await promise;
  });

  it.each(['GET', 'HEAD'])('routes a bodyless %s Request', async (method) => {
    await importInject();
    posted.length = 0;
    const promise = solidApi().fetch(new Request('https://pod.example/data', { method }));
    const message = await fetchMessage();
    expect(message).toMatchObject({ method });
    expect(message).not.toHaveProperty('body');
    expect(message).not.toHaveProperty('bodyBase64');
    finishFetch(message);
    await promise;
  });

  describe.each([false, true])('Request validation (patched=%s)', (patched) => {
    it.each([
      'GET',
      'HEAD',
      'get',
      'head',
    ])('rejects effective %s bodies, including inherited and empty bodies, before posting', async (method) => {
      await importInject();
      posted.length = 0;
      for (const input of [
        'https://pod.example/data',
        new Request('https://pod.example/data', { method: 'POST', body: 'inherited' }),
      ]) {
        for (const body of [undefined, null, '', 'override', new Uint8Array(0)]) {
          if (typeof input === 'string' && body == null) continue;
          const init = { method, body };
          expect(() => new Request(input, init)).toThrow(TypeError);
          const nativeError = new TypeError('Native method/body rejection');
          nativeFetch.mockRejectedValueOnce(nativeError);
          const result = (patched ? dom.window.fetch : solidApi().fetch)(input, init);
          if (patched) await expect(result).rejects.toBe(nativeError);
          else await expect(result).rejects.toBeInstanceOf(TypeError);
        }
      }
      expect(posted).toHaveLength(0);
      expect(nativeFetch).toHaveBeenCalledTimes(patched ? 8 : 0);
    });

    it.each([
      'GET',
      'HEAD',
    ])('rejects an oversized %s override with TypeError before size errors or copies', async (method) => {
      await importInject();
      posted.length = 0;
      const request = new Request('https://pod.example/data', { method: 'POST', body: 'body' });
      const body = new Uint8Array(MAX_BODY_BYTES + 1);
      const nativeError = new TypeError('Native method/body rejection');
      nativeFetch.mockRejectedValueOnce(nativeError);
      const construct = vi.fn();
      setGlobal(
        'Request',
        new Proxy(Request, {
          construct(target, args) {
            construct(...args);
            return Reflect.construct(target, args);
          },
        }),
      );
      const result = (patched ? dom.window.fetch : solidApi().fetch)(request, { method, body });
      if (patched) await expect(result).rejects.toBe(nativeError);
      else await expect(result).rejects.toBeInstanceOf(TypeError);
      expect(construct).not.toHaveBeenCalled();
      expect(nativeFetch).toHaveBeenCalledTimes(patched ? 1 : 0);
      expect(posted).toHaveLength(0);
    });

    it.each([
      { mode: 'navigate' },
      { method: 'CONNECT' },
      { method: 'trace' },
      { method: 'TrAcK' },
      { method: 'BAD METHOD' },
      { method: '' },
      { cache: 'only-if-cached' },
      { method: 'PUT', mode: 'no-cors' },
      { credentials: 'invalid' },
      { redirect: 'invalid' },
      { referrer: 'https://[' },
      { referrerPolicy: 'invalid' },
      { duplex: 'full' },
      { window: {} },
    ])('rejects invalid constructor options %j for URLs and Request inputs', async (options) => {
      await importInject();
      posted.length = 0;
      for (const input of ['https://pod.example/data', new Request('https://pod.example/data')]) {
        const init = options as RequestInit;
        expect(() => new Request(input, init)).toThrow(TypeError);
        const nativeError = new TypeError('Native constructor rejection');
        nativeFetch.mockRejectedValueOnce(nativeError);
        const result = (patched ? dom.window.fetch : solidApi().fetch)(input, init);
        if (patched) await expect(result).rejects.toBe(nativeError);
        else await expect(result).rejects.toBeInstanceOf(TypeError);
      }
      expect(posted).toHaveLength(0);
      expect(nativeFetch).toHaveBeenCalledTimes(patched ? 2 : 0);
    });

    it.each([
      'used',
      'locked',
    ])('rejects an inherited %s Request body without posting or reading it', async (state) => {
      await importInject();
      posted.length = 0;
      const request = new Request('https://pod.example/data', { method: 'POST', body: 'body' });
      const reader = state === 'locked' ? request.body!.getReader() : undefined;
      if (state === 'used') await request.text();
      expect(() => new Request(request)).toThrow(TypeError);
      const nativeError = new TypeError('Native unusable-body rejection');
      nativeFetch.mockRejectedValueOnce(nativeError);
      const result = (patched ? dom.window.fetch : solidApi().fetch)(request);
      if (patched) await expect(result).rejects.toBe(nativeError);
      else await expect(result).rejects.toBeInstanceOf(TypeError);
      expect(nativeFetch).toHaveBeenCalledTimes(patched ? 1 : 0);
      expect(posted).toHaveLength(0);
      reader?.releaseLock();
    });

    it.each([
      'duplex',
      'keepalive',
      'mode',
      'locked',
      'used',
    ])('rejects invalid init streams (%s) with the native error type', async (kind) => {
      await importInject();
      posted.length = 0;
      const body = new ReadableStream<Uint8Array>({ start: (c) => c.close() });
      const reader = kind === 'locked' ? body.getReader() : undefined;
      if (kind === 'used') await new Response(body).text();
      const init = {
        method: 'POST',
        body,
        ...(kind !== 'duplex' ? { duplex: 'half' } : {}),
        ...(kind === 'keepalive' ? { keepalive: true } : {}),
        ...(kind === 'mode' ? { mode: 'no-cors' } : {}),
      } as RequestInit;
      expect(() => new Request('https://pod.example/data', init)).toThrow(TypeError);
      const nativeError = new TypeError('Native stream rejection');
      nativeFetch.mockRejectedValueOnce(nativeError);
      const result = (patched ? dom.window.fetch : solidApi().fetch)(
        'https://pod.example/data',
        init,
      );
      if (patched) await expect(result).rejects.toBe(nativeError);
      else await expect(result).rejects.toBeInstanceOf(TypeError);
      expect(nativeFetch).toHaveBeenCalledTimes(patched ? 1 : 0);
      expect(posted).toHaveLength(0);
      reader?.releaseLock();
    });

    it('rejects a no-cors override on an inherited stream', async () => {
      await importInject();
      posted.length = 0;
      const request = new Request('https://pod.example/data', {
        method: 'POST',
        body: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
        duplex: 'half',
      } as RequestInit);
      const init = { mode: 'no-cors' as const };
      expect(() => new Request(request, init)).toThrow(TypeError);
      const nativeError = new TypeError('Native stream mode rejection');
      nativeFetch.mockRejectedValueOnce(nativeError);
      const result = (patched ? dom.window.fetch : solidApi().fetch)(request, init);
      if (patched) await expect(result).rejects.toBe(nativeError);
      else await expect(result).rejects.toBeInstanceOf(TypeError);
      expect(nativeFetch).toHaveBeenCalledTimes(patched ? 1 : 0);
      expect(posted).toHaveLength(0);
      expect(request.bodyUsed).toBe(false);
    });

    it('rejects credential-bearing URLs before posting', async () => {
      await importInject();
      posted.length = 0;
      const url = 'https://user:password@pod.example/data';
      expect(() => new Request(url)).toThrow(TypeError);
      const nativeError = new TypeError('Native URL rejection');
      nativeFetch.mockRejectedValueOnce(nativeError);
      const result = (patched ? dom.window.fetch : solidApi().fetch)(url);
      if (patched) await expect(result).rejects.toBe(nativeError);
      else await expect(result).rejects.toBeInstanceOf(TypeError);
      expect(nativeFetch).toHaveBeenCalledTimes(patched ? 1 : 0);
      expect(posted).toHaveLength(0);
    });

    it.each([
      'inherited',
      'non-enumerable',
    ])('validates %s init members as Web IDL dictionary members', async (kind) => {
      await importInject();
      posted.length = 0;
      const request = new Request('https://pod.example/data', { method: 'POST', body: 'body' });
      const init: RequestInit =
        kind === 'inherited'
          ? Object.create({ method: 'GET' })
          : Object.defineProperty({}, 'method', { value: 'HEAD' });
      expect(() => new Request(request, init)).toThrow(TypeError);
      const nativeError = new TypeError('Native dictionary rejection');
      nativeFetch.mockRejectedValueOnce(nativeError);
      const result = (patched ? dom.window.fetch : solidApi().fetch)(request, init);
      if (patched) await expect(result).rejects.toBe(nativeError);
      else await expect(result).rejects.toBeInstanceOf(TypeError);
      expect(posted).toHaveLength(0);
      expect(nativeFetch).toHaveBeenCalledTimes(patched ? 1 : 0);
    });
  });

  it.each([
    ['post', 'POST'],
    ['pAtCh', 'pAtCh'],
  ])('uses native method normalization for %s', async (method, expected) => {
    await importInject();
    posted.length = 0;
    const promise = solidApi().fetch('https://pod.example/data', { method, body: 'body' });
    const message = await fetchMessage();
    expect(message.method).toBe(expected);
    finishFetch(message);
    await promise;
  });

  it.each([
    [false, 'GET'],
    [false, 'PUT'],
    [true, 'GET'],
    [true, 'PUT'],
  ] as const)('rejects pre-aborted %s %s Requests before posting, including body overrides', async (patched, method) => {
    await importInject();
    posted.length = 0;
    const controller = new AbortController();
    controller.abort();
    const request = new Request('https://pod.example/data', {
      method,
      signal: controller.signal,
      ...(method === 'PUT' ? { body: 'original' } : {}),
    });
    const promise = (patched ? dom.window.fetch : solidApi().fetch)(
      request,
      method === 'PUT' ? { body: new Uint8Array([0, 128, 255]) } : undefined,
    );
    const rejected = expect(promise).rejects.toBe(controller.signal.reason);
    expect(posted).toHaveLength(0);
    await rejected;
    expect(controller.signal.reason).toBeInstanceOf(DOMException);
    expect(controller.signal.reason.name).toBe('AbortError');
    expect(request.bodyUsed).toBe(false);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])('rejects an aborted init.signal overriding a live Request signal (patched=%s)', async (patched) => {
    await importInject();
    posted.length = 0;
    const controller = new AbortController();
    const reason = new DOMException('Upload cancelled', 'AbortError');
    controller.abort(reason);
    const request = new Request('https://pod.example/data', { method: 'PUT', body: 'original' });
    const promise = (patched ? dom.window.fetch : solidApi().fetch)(request, {
      body: new Uint8Array([0, 128, 255]),
      signal: controller.signal,
    });
    const rejected = expect(promise).rejects.toBe(reason);
    expect(posted).toHaveLength(0);
    await rejected;
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])('rejects an aborted init.signal for a URL with its exact custom reason (patched=%s)', async (patched) => {
    await importInject();
    posted.length = 0;
    const controller = new AbortController();
    const reason = new Error('Caller cancelled');
    controller.abort(reason);
    const promise = (patched ? dom.window.fetch : solidApi().fetch)('https://pod.example/data', {
      signal: controller.signal,
    });
    const rejected = expect(promise).rejects.toBe(reason);
    expect(posted).toHaveLength(0);
    await rejected;
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it.each([
    'live',
    'null',
    'undefined',
  ] as const)('resolves init.signal=%s over an aborted Request signal like native fetch', async (override) => {
    await importInject();
    posted.length = 0;
    const controller = new AbortController();
    controller.abort();
    const request = new Request('https://pod.example/data', {
      method: 'PUT',
      body: new Uint8Array([0, 128, 255]),
      signal: controller.signal,
    });
    const signal =
      override === 'live' ? new AbortController().signal : override === 'null' ? null : undefined;
    const promise = solidApi().fetch(request, { signal });
    if (override === 'undefined') {
      await expect(promise).rejects.toBe(controller.signal.reason);
      expect(posted).toHaveLength(0);
    } else {
      const message = await fetchMessage();
      expect(message.bodyBase64).toBe('AID/');
      finishFetch(message);
      expect((await promise).status).toBe(204);
    }
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])('rejects an abort during Blob serialization before posting or native fallback (patched=%s)', async (patched) => {
    await importInject();
    posted.length = 0;
    const controller = new AbortController();
    const reason = new Error('Cancelled while reading Blob');
    const body = new Blob([new Uint8Array([0, 128, 255])]);
    let finish!: (bytes: ArrayBuffer) => void;
    vi.spyOn(body, 'arrayBuffer').mockImplementation(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
    );
    const promise = (patched ? dom.window.fetch : solidApi().fetch)('https://pod.example/data', {
      method: 'PUT',
      body,
      signal: controller.signal,
    });
    const rejected = expect(promise).rejects.toBe(reason);
    controller.abort(reason);
    finish(new Uint8Array([0, 128, 255]).buffer);
    await rejected;
    expect(posted).toHaveLength(0);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])('rejects an abort during an open Request body read without waiting for EOF (patched=%s)', async (patched) => {
    await importInject();
    posted.length = 0;
    const controller = new AbortController();
    const reason = new DOMException('Cancelled while reading Request', 'AbortError');
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const request = new Request('https://pod.example/data', {
      method: 'PUT',
      body: new ReadableStream<Uint8Array>({
        start(c) {
          stream = c;
        },
      }),
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit);
    const promise = (patched ? dom.window.fetch : solidApi().fetch)(request);
    const rejected = expect(promise).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    expect(posted).toHaveLength(0);
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    stream.close();
  });

  it.each([
    false,
    true,
  ])('keeps the existing response delivery when aborted after posting (patched=%s)', async (patched) => {
    await importInject();
    posted.length = 0;
    const controller = new AbortController();
    const request = new Request('https://pod.example/data', { signal: controller.signal });
    const promise = (patched ? dom.window.fetch : solidApi().fetch)(request);
    const message = await fetchMessage();
    controller.abort();
    finishFetch(message);
    expect((await promise).status).toBe(204);
    expect(posted).toHaveLength(1);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it.each(['navigate', 'data:'])('keeps %s Request input on native fetch', async (kind) => {
    await importInject();
    posted.length = 0;
    const request = new Request(
      kind === 'data:' ? 'data:text/plain,hello' : 'https://pod.example/data',
    );
    if (kind === 'navigate') Object.defineProperty(request, 'mode', { value: 'navigate' });
    await dom.window.fetch(request);
    await solidApi().fetch(request);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    expect(posted).toHaveLength(0);
  });

  it('reconstructs binary response bytes with metadata preserved through cloning', async () => {
    await importInject();
    posted.length = 0;
    const promise = dom.window.fetch('https://pod.example/image');
    const message = await fetchMessage();
    deliverToPage({
      type: 'SOLID_FETCH_RESPONSE',
      requestId: message.requestId,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'image/png' },
      bodyBase64: 'AID/',
      url: 'https://pod.example/final',
      redirected: true,
    });
    const response = await promise;
    for (const copy of [response, response.clone(), response.clone().clone()]) {
      expect(copy.url).toBe('https://pod.example/final');
      expect(copy.redirected).toBe(true);
      expect(copy.status).toBe(200);
      expect(copy.statusText).toBe('OK');
      expect(copy.headers.get('content-type')).toBe('image/png');
      expect(new Uint8Array(await copy.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255]));
    }
  });

  it.each([
    ['bytes', () => new Uint8Array(MAX_BODY_BYTES + 1)],
    ['text', () => 'a'.repeat(MAX_BODY_BYTES + 1)],
    ['Blob', () => new Blob([new Uint8Array(MAX_BODY_BYTES + 1)])],
    ['URLSearchParams', () => new URLSearchParams({ data: 'a'.repeat(MAX_BODY_BYTES) })],
  ] as const)('rejects oversized %s explicitly and keeps autoDivert native before body reads', async (_name, makeBody) => {
    await importInject();
    posted.length = 0;
    const body = makeBody();
    const read = body instanceof Blob ? vi.spyOn(body, 'arrayBuffer') : undefined;
    const init: RequestInit = {
      method: 'PUT',
      body,
      credentials: 'include',
      headers: { 'X-App': 'original' },
    };
    const url = new URL('https://api.thirdparty.example/data');
    await expect(solidApi().fetch(url, init)).rejects.toThrow(REQUEST_BODY_LIMIT_ERROR);
    expect(await (await dom.window.fetch(url, init)).text()).toBe('native');
    expect(nativeFetch).toHaveBeenCalledOnce();
    const [nativeUrl, nativeInit] = nativeFetch.mock.calls[0] as [string, RequestInit];
    expect(nativeUrl).toBe(url.href);
    expect(nativeInit.body).toBe(body);
    expect(nativeInit.method).toBe('PUT');
    expect(nativeInit.credentials).toBe('include');
    expect(new Headers(nativeInit.headers).get('x-app')).toBe('original');
    if (read) expect(read).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });

  it.each([
    ['ASCII', 'a'.repeat(MAX_BODY_BYTES)],
    ['UTF-8', 'é'.repeat(MAX_BODY_BYTES / 2)],
    ['surrogate pairs', '🌍'.repeat(MAX_BODY_BYTES / 4)],
  ])('accepts %s text at the exact byte limit', async (_name, body) => {
    await importInject();
    posted.length = 0;
    const promise = solidApi().fetch('https://pod.example/data', { method: 'POST', body });
    const message = await fetchMessage();
    expect(message.body).toBe(body);
    finishFetch(message);
    await promise;
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['ArrayBuffer', () => new ArrayBuffer(MAX_BODY_BYTES + 1)],
    ['typed array', () => new Uint8Array(MAX_BODY_BYTES + 1)],
    ['DataView', () => new DataView(new ArrayBuffer(MAX_BODY_BYTES + 1))],
    ['Blob', () => new Blob([new Uint8Array(MAX_BODY_BYTES + 1)])],
    ['UTF-8 text', () => '\u0800'.repeat(Math.floor(MAX_BODY_BYTES / 3) + 1)],
    ['unpaired surrogates', () => '\ud800'.repeat(Math.floor(MAX_BODY_BYTES / 3) + 1)],
    ['URLSearchParams', () => new URLSearchParams({ data: 'a'.repeat(MAX_BODY_BYTES) })],
  ] as const)('checks oversized %s overrides BEFORE constructing or copying a Request body', async (_name, makeBody) => {
    await importInject();
    posted.length = 0;
    const body = makeBody();
    const request = new Request('https://pod.example/data', { method: 'POST', body: 'original' });
    const clone = vi.spyOn(request, 'clone');
    const read = body instanceof Blob ? vi.spyOn(body, 'arrayBuffer') : undefined;
    // A bodyless native response keeps the mock's own string encoding out of the spy.
    nativeFetch.mockImplementation(async () => new Response(null, { status: 200 }));
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const construct = vi.fn();
    setGlobal(
      'Request',
      new Proxy(Request, {
        construct(target, args) {
          construct(...args);
          return Reflect.construct(target, args);
        },
      }),
    );
    for (const input of [request, request.url]) {
      const init = { body, method: 'POST' };
      await expect(solidApi().fetch(input, init)).rejects.toThrow(REQUEST_BODY_LIMIT_ERROR);
      await dom.window.fetch(input, init);
      expect(nativeFetch).toHaveBeenLastCalledWith(input, expect.objectContaining({ body }));
    }
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    expect(construct).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
    if (read) expect(read).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(posted).toHaveLength(0);
  });

  it.each([
    false,
    true,
  ])('bounds an open Request stream and preserves native fallback (autoDivert=%s)', async (autoDivert) => {
    await importInject();
    posted.length = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(42);
    let emitted = 0;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      pull(c) {
        if (emitted++ <= MAX_BODY_BYTES / chunk.byteLength) c.enqueue(chunk);
        // Stay open after overflow so serialization must finish before EOF.
      },
    });
    const request = new Request('https://api.thirdparty.example/upload', {
      method: 'PUT',
      body,
      headers: { 'X-App': 'original', 'Content-Length': '1' },
      credentials: 'include',
      mode: 'cors',
      duplex: 'half',
    } as RequestInit);
    // Not 'omit': an omitting request never enters the routed path (sst-5mya).
    const init = {
      headers: new Headers({ 'X-App': 'snapshot' }),
      credentials: 'same-origin' as RequestCredentials,
    };
    const promise = (autoDivert ? dom.window.fetch : solidApi().fetch)(request, init);
    init.headers.set('X-App', 'mutated');
    init.credentials = 'include';
    if (autoDivert) {
      expect(await (await promise).text()).toBe('native');
      expect(nativeFetch).toHaveBeenCalledOnce();
      const [copy, snapInit] = nativeFetch.mock.calls[0] as [Request, RequestInit];
      expect(copy).not.toBe(request);
      expect(copy.bodyUsed).toBe(false);
      expect(copy.url).toBe(request.url);
      expect(copy.method).toBe('PUT');
      expect(copy.mode).toBe('cors');
      expect(snapInit.credentials).toBe('same-origin');
      expect(new Headers(snapInit.headers).get('x-app')).toBe('snapshot');
      controller.close();
      const reader = copy.body!.getReader();
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        expect(value[0]).toBe(42);
        expect(value.at(-1)).toBe(42);
        size += value.byteLength;
      }
      expect(size).toBe(MAX_BODY_BYTES + chunk.byteLength);
      reader.releaseLock();
    } else {
      await expect(promise).rejects.toThrow(REQUEST_BODY_LIMIT_ERROR);
      expect(nativeFetch).not.toHaveBeenCalled();
      controller.close();
    }
    expect(request.bodyUsed).toBe(false);
    expect(posted).toHaveLength(0);
  });

  it('rejects a failed Blob read explicitly and falls back with immutable snapshots on autoDivert', async () => {
    await importInject();
    posted.length = 0;
    const body = new Blob(['upload']);
    vi.spyOn(body, 'arrayBuffer').mockRejectedValue(new Error('serialization failed'));
    const url = new URL('https://api.thirdparty.example/upload');
    const init: RequestInit = {
      method: 'POST',
      body,
      headers: new Headers({ 'X-App': 'original' }),
      credentials: 'include',
    };
    await expect(solidApi().fetch(url, init)).rejects.toThrow('serialization failed');
    const promise = dom.window.fetch(url, init);
    url.pathname = '/mutated';
    (init.headers as Headers).set('X-App', 'mutated');
    init.credentials = 'omit';
    await promise;
    expect(nativeFetch).toHaveBeenCalledWith(
      'https://api.thirdparty.example/upload',
      expect.objectContaining({ body, credentials: 'include' }),
    );
    const [, snapInit] = nativeFetch.mock.calls[0] as [string, RequestInit];
    expect(new Headers(snapInit.headers).get('x-app')).toBe('original');
    expect(posted).toHaveLength(0);
  });
});

it.each([true, false])('disconnect sends only a correlated request and resolves %s', async (ok) => {
  await importInject();
  posted.length = 0;
  const solid = (dom.window as unknown as { solid: { disconnect(): Promise<boolean> } }).solid;
  const result = solid.disconnect();
  const request = posted[0];
  expect(request).toEqual({
    channel: 'solid-browser-ext',
    dir: 'to-content',
    type: 'SOLID_DISCONNECT',
    requestId: expect.any(String),
  });
  dom.window.dispatchEvent(
    new dom.window.MessageEvent('message', {
      source: dom.window,
      data: {
        channel: 'solid-browser-ext',
        dir: 'to-page',
        type: 'SOLID_ACCESS_RESPONSE',
        requestId: request.requestId,
        ok,
      },
    }),
  );
  await expect(result).resolves.toBe(ok);
});

it('disconnect remains callable without a grant and rejects a worker error', async () => {
  vi.resetModules();
  await import('../src/inject/inject');
  const stub = (dom.window as unknown as { solid: { disconnect(): Promise<boolean> } }).solid;
  for (const response of [{ ok: false }, { error: 'Could not verify the requesting origin.' }]) {
    const result = stub.disconnect();
    const expectation =
      'error' in response
        ? expect(result).rejects.toThrow(response.error)
        : expect(result).resolves.toBe(false);
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        source: dom.window,
        data: {
          channel: 'solid-browser-ext',
          dir: 'to-page',
          type: 'SOLID_ACCESS_RESPONSE',
          requestId: posted.at(-1)?.requestId,
          ...response,
        },
      }),
    );
    await expectation;
  }
});

// AUTHORED-BY Claude Opus 5.5
describe("inject — sst-5mya: credentials 'omit' never reaches authenticated egress", () => {
  /** What native fetch would act on: a real Request built from the arguments it received. */
  function nativeView(): Request {
    const [input, init] = nativeFetch.mock.calls[0] as [RequestInfo, RequestInit?];
    return new Request(input, init);
  }

  it.each([
    ['init', () => ['https://pod.example/public', { credentials: 'omit' }]],
    // The suite's publicFetch shape: caller init spread, then credentials forced to omit.
    ['spread init', () => ['https://pod.example/public', { method: 'GET', credentials: 'omit' }]],
    ['Request', () => [new Request('https://pod.example/public', { credentials: 'omit' })]],
    [
      'Request with init that does not override it',
      () => [new Request('https://pod.example/public', { credentials: 'omit' }), { method: 'GET' }],
    ],
    [
      'an object whose String() is omit',
      () => ['https://pod.example/public', { credentials: { toString: (): string => 'omit' } }],
    ],
    [
      'a Request whose credentials property is shadowed',
      () => {
        const request = new Request('https://pod.example/public', { credentials: 'omit' });
        Object.defineProperty(request, 'credentials', { value: 'include' });
        return [request];
      },
    ],
  ] as const)('a cross-origin fetch omitting credentials via %s stays on native fetch', async (_, args) => {
    await importInject();
    posted.length = 0;
    await dom.window.fetch(...(args() as unknown as [RequestInfo, RequestInit?]));
    expect(posted.some((m) => m.type === 'SOLID_FETCH_REQUEST')).toBe(false);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(nativeView().credentials).toBe('omit');
  });

  it('reads a credentials getter once and hands native fetch the value it checked', async () => {
    await importInject();
    posted.length = 0;
    const answers = ['omit', 'include'];
    const get = vi.fn(() => answers.shift());
    const init = Object.defineProperty({}, 'credentials', { get, enumerable: true });
    await dom.window.fetch('https://pod.example/public', init);
    expect(get).toHaveBeenCalledTimes(1);
    expect(posted.some((m) => m.type === 'SOLID_FETCH_REQUEST')).toBe(false);
    expect(nativeView().credentials).toBe('omit');
  });

  it('a getter answering include first is routed on that answer, not re-read', async () => {
    await importInject();
    posted.length = 0;
    const answers = ['include', 'omit'];
    const get = vi.fn(() => answers.shift());
    void dom.window.fetch(
      'https://pod.example/private',
      Object.defineProperty({}, 'credentials', { get }),
    );
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'SOLID_FETCH_REQUEST')).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('a throwing getter rejects with its first error and is not re-run', async () => {
    await importInject();
    posted.length = 0;
    const failure = new Error('getter');
    const get = vi.fn(() => {
      throw failure;
    });
    await expect(
      dom.window.fetch(
        'https://pod.example/public',
        Object.defineProperty({}, 'credentials', { get }),
      ),
    ).rejects.toBe(failure);
    expect(get).toHaveBeenCalledTimes(1);
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(posted.some((m) => m.type === 'SOLID_FETCH_REQUEST')).toBe(false);
  });

  it('an invalid mode is normalised and rejected as native fetch would, never sent to the worker', async () => {
    await importInject();
    posted.length = 0;
    const outcome = await dom.window
      .fetch('https://pod.example/public', {
        credentials: { toString: () => 'bogus' } as unknown as RequestCredentials,
      })
      .then(
        () => 'resolved',
        (error: unknown) => error,
      );
    expect(posted.some((m) => m.type === 'SOLID_FETCH_REQUEST')).toBe(false);
    if (outcome !== 'resolved') expect(outcome).toBeInstanceOf(TypeError);
    else expect(() => nativeView()).toThrow(TypeError);
  });

  it.each([
    ['no credentials option', () => ['https://pod.example/private']],
    ["credentials 'include'", () => ['https://pod.example/private', { credentials: 'include' }]],
    ['a null init', () => ['https://pod.example/private', null]],
    [
      "an init 'include' overriding a Request's 'omit'",
      () => [
        new Request('https://pod.example/private', { credentials: 'omit' }),
        { credentials: 'include' },
      ],
    ],
    // A URL has no credentials mode of its own, even with a property claiming one.
    [
      'a URL object claiming omit',
      () => [Object.assign(new URL('https://pod.example/private'), { credentials: 'omit' })],
    ],
  ] as const)('a cross-origin fetch with %s is still routed', async (_, args) => {
    await importInject();
    posted.length = 0;
    void dom.window.fetch(...(args() as unknown as [RequestInfo, RequestInit?])).catch(() => {});
    await vi.waitFor(() =>
      expect(posted.some((m) => m.type === 'SOLID_FETCH_REQUEST' && m.autoDivert === true)).toBe(
        true,
      ),
    );
    expect(nativeFetch).not.toHaveBeenCalled();
  });
});
