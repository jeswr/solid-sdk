// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * The MAIN-world injection: defines `window.solid` on every page. This script runs in the
 * page's own JS world (so the page can call it), but it holds NO credential — every
 * privileged operation is a `postMessage` to the ISOLATED content script, which relays to
 * the service worker (the sole token holder). The page only ever sees the WebID + a
 * proxied fetch Response. The credential boundary is enforced in the worker, not here.
 */

import {
  assertBodySize,
  assertTextBodySize,
  base64ToBytes,
  bytesToBase64,
  MAX_BODY_BYTES,
  REQUEST_BODY_LIMIT_ERROR,
  readBodyBounded,
  validateBodyFields,
} from '../shared/body-codec';

const CHANNEL = 'solid-browser-ext';

// The manifest supplies the stub on all pages; granted-origin dynamic scripts request a
// fresh state check. Duplicate execution never replaces a page's permanent window.solid.
declare global {
  interface Window {
    __solidInjected?: boolean;
  }
}

/** A token-free view of a per-data-class grant (the enforceable substance + consent anchors). */
interface SolidGrant {
  readonly grantId: string;
  readonly dataClass: string;
  readonly modes: readonly string[];
  readonly purpose: string | null;
  readonly expiresAt: number;
  readonly targets: ReadonlyArray<{ url: string; kind: 'instance' | 'container' }>;
}

/** The `requestAccess` argument (design §4.2). `duration` is an ISO-8601 duration, e.g. "P30D". */
interface AccessRequestArgs {
  readonly classes: readonly string[];
  readonly modes: readonly string[];
  readonly purpose?: string;
  readonly duration?: string;
}

/** The worker's reply to an access-management call, as relayed to the page. */
interface AccessResponseData {
  readonly webId?: string;
  readonly requestId: string;
  readonly ok?: boolean;
  readonly grants?: SolidGrant[];
  readonly shape?: string | null;
  readonly targets?: Array<{ url: string; kind: 'instance' | 'container' }>;
  readonly error?: string;
}

/**
 * The `window.solid` API surface — Phase-0 core (fetch/login/logout/setClientId) PLUS the
 * Phase-2 per-data-class access-management methods (design §4.2). Every access-management call
 * is a token-free `postMessage` to the service worker (the sole boundary); the page never sees
 * a credential — only a grant handle + a capability to `fetch` within the granted, PINNED,
 * resolved target set.
 */
interface SolidExtension {
  /** The authenticated user's WebID, or null when signed out. */
  readonly webId: string | null;
  /** A DPoP-authenticated fetch, proxied through the extension (origin-gated, fail-closed). */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Declare this origin's Client Identifier Document URL so the pod sees the page's identity. */
  setClientId(clientId: string): void;
  /** Start the interactive login for a WebID (same as the popup). */
  login(webId: string): Promise<void>;
  /** Clear the session (app-local logout). */
  logout(): Promise<void>;

  // --- Per-data-class access management (Phase 2, design §4.2) -----------------------
  /**
   * Request type-level access to one or more data classes. Triggers the extension's
   * unspoofable consent window; on approval the class is resolved to concrete pod targets that
   * are PINNED into the grant, and subsequent `fetch` calls are confined to that pinned set.
   * Resolves with the minted grants (one per approved class); an empty `grants` ⇒ denied.
   */
  requestAccess(request: AccessRequestArgs): Promise<{ ok: boolean; grants: SolidGrant[] }>;
  /** The grants THIS origin currently holds (non-expired), for the active session. */
  listGrants(): Promise<SolidGrant[]>;
  /** Revoke one of THIS origin's grants; effective on the next request. Returns whether removed. */
  revokeGrant(grantId: string): Promise<boolean>;
  /** End THIS origin's binding; true if removed, false if absent. Available even ungranted. */
  disconnect(): Promise<boolean>;
  /** Read-only introspection: resolve a data-class IRI to its pod targets (for the app's UX). */
  resolveClass(classIRI: string): Promise<{
    shape: string | null;
    targets: Array<{ url: string; kind: 'instance' | 'container' }>;
  }>;
}

type Pending<T> = { resolve: (v: T) => void; reject: (e: Error) => void };

/**
 * A pending `solidFetch`, plus the ORIGINAL `input`/`init` it was called with. The original
 * args are retained so that if the SW returns a PASSTHROUGH SENTINEL (round-2 High #1 — the SW
 * declined an autoDivert request and did NO network), the page-side handler can complete the
 * request by calling the page's OWN native fetch (PRISTINE_FETCH) with full CORS / credentials
 * / header fidelity — the SW never fetches cross-origin bytes on a page's behalf.
 */
type PendingFetch = Pending<Response> & {
  readonly input: RequestInfo | URL;
  readonly init?: RequestInit;
};

/** Preserve the worker's final URL metadata through native body cloning. */
function withResponseMetadata(response: Response, url: string, redirected: boolean): Response {
  const clone = response.clone;
  Object.defineProperties(response, {
    url: { value: url },
    redirected: { value: redirected },
    clone: {
      value(this: Response): Response {
        return withResponseMetadata(clone.call(this), this.url, this.redirected);
      },
      writable: true,
      configurable: true,
    },
  });
  return response;
}

// Install exactly once, even if inject.js runs twice (Medium #2). The marker covers a re-run
// after our own install; the `'solid' in window` check covers a prior install from a different
// code path. A double-run is then an inert no-op, NOT a throw on the `configurable:false`
// defineProperty below.
if (!window.__solidInjected && !('solid' in window)) {
  window.__solidInjected = true;
  installSolidInjection();
}

function installSolidInjection(): void {
  // --- Snapshot the PRISTINE fetch FIRST (the @jeswr/solid-elements discipline) -----------
  //
  // Captured up-front, before the global patch below, so a later page script that overwrites
  // `window.fetch` cannot poison it. This is ALSO the function the SW passthrough path falls
  // back to: when the SW returns a passthrough sentinel, the page completes the request with
  // its OWN native fetch in the page's origin context (round-2 High #1) — so the extension is
  // never a cross-origin proxy and native CORS / credentials / header semantics are preserved.
  const nativeFetch = window.fetch;
  const PRISTINE_FETCH = nativeFetch.bind(window);
  // The native Request credentials getter, captured before page scripts run: an own or
  // prototype `credentials` property cannot disguise a Request's real mode (sst-5mya).
  const REQUEST_CREDENTIALS = Object.getOwnPropertyDescriptor(
    Request.prototype,
    'credentials',
  )?.get;

  /**
   * Duck-type a `URL`-like input rather than `instanceof URL`. `instanceof` is CROSS-REALM
   * UNRELIABLE: a `URL` minted in another JS realm (an iframe, or — in tests — a JSDOM window
   * whose `URL` differs from the module's bare-global `URL`) is NOT an instance of the realm-local
   * `URL`, so `input instanceof URL` would wrongly be `false` and we'd mis-classify the input
   * (treating a cross-origin pod URL as same-origin and skipping the gate). A `RequestInfo | URL`
   * that is a non-null object exposing a string `href` is a URL (a `Request` has no `href` — it
   * carries `url` — so this never mis-takes a `Request` for a `URL`). `WHATWG URL` is fully
   * specified by its `href`, so we snapshot/serialise via `href` and never depend on identity.
   */
  function urlLike(input: unknown): input is URL {
    return (
      typeof input === 'object' &&
      input !== null &&
      'href' in input &&
      typeof (input as { href: unknown }).href === 'string'
    );
  }

  const pendingFetches = new Map<string, PendingFetch>();
  const pendingActions = new Map<string, Pending<void>>();
  /** Pending access-management calls, including disconnect on the permanent stub. */
  const pendingAccess = new Map<string, Pending<AccessResponseData>>();

  let currentWebId: string | null = null;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.dir !== 'to-page') return;

    switch (data.type) {
      case 'SOLID_FETCH_RESPONSE': {
        const pending = pendingFetches.get(data.requestId);
        if (!pending) return;
        pendingFetches.delete(data.requestId);
        if (data.passthrough === true) {
          // PASSTHROUGH SENTINEL (round-2 High #1): the SW declined this autoDivert request and
          // did NO network. Complete it with the page's OWN native fetch, in the page's origin
          // context, using the ORIGINAL input/init — so CORS / credentials / headers behave
          // EXACTLY as if the extension were not installed (if CORS blocks, this rejects /
          // returns opaque exactly as native). We NEVER fabricate a Response from SW data on
          // this path: the SW returned no bytes (it cannot be a cross-origin read proxy).
          PRISTINE_FETCH(pending.input as RequestInfo, pending.init).then(
            pending.resolve,
            pending.reject,
          );
        } else if (data.error) {
          pending.reject(new Error(data.error));
        } else {
          try {
            validateBodyFields(data.body, data.bodyBase64);
            const response = new Response(
              data.bodyBase64 !== undefined ? base64ToBytes(data.bodyBase64) : (data.body ?? null),
              {
                status: data.status,
                statusText: data.statusText,
                headers: new Headers(data.headers ?? {}),
              },
            );
            pending.resolve(
              withResponseMetadata(response, data.url ?? '', data.redirected === true),
            );
          } catch (error) {
            pending.reject(error as Error);
          }
        }
        break;
      }
      case 'SOLID_ACTION_RESPONSE': {
        const pending = pendingActions.get(data.actionId);
        if (!pending) return;
        pendingActions.delete(data.actionId);
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve();
        break;
      }
      case 'SOLID_ACCESS_RESPONSE': {
        const pending = pendingAccess.get(data.requestId);
        if (!pending) return;
        pendingAccess.delete(data.requestId);
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve(data as AccessResponseData);
        break;
      }
      case 'SOLID_STATE_UPDATE':
        currentWebId = data.webId ?? null;
        setGranted(currentWebId !== null);
        break;
    }
  });

  /** Send an access-management request and await the worker's correlated reply. */
  function accessRequest(
    type: string,
    extra: Record<string, unknown> = {},
  ): Promise<AccessResponseData> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      pendingAccess.set(requestId, { resolve, reject });
      postToContent({ type, requestId, ...extra });
    });
  }

  function postToContent(message: Record<string, unknown>): void {
    window.postMessage({ channel: CHANNEL, dir: 'to-content', ...message }, window.location.origin);
  }

  /**
   * Read every RequestInit member exactly once into a plain object. Web IDL dictionaries include
   * inherited and non-enumerable members too, so read by name rather than spreading.
   */
  function snapshotInit(init: RequestInit): RequestInit {
    return Object.fromEntries(
      [
        'method',
        'headers',
        'body',
        'mode',
        'credentials',
        'cache',
        'redirect',
        'referrer',
        'referrerPolicy',
        'integrity',
        'keepalive',
        'signal',
        'duplex',
        'priority',
        'window',
      ].map((key) => [key, Reflect.get(init, key)]),
    ) as RequestInit;
  }

  /**
   * Route a fetch through the gated SW path. `autoDivert` marks a request that came from the
   * best-effort global-fetch patch (NOT an explicit `window.solid.fetch` call) so the SW can
   * native-passthrough a non-pod / un-granted request instead of hard-failing the page (High #1).
   */
  async function solidFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
    autoDivert = false,
  ): Promise<Response> {
    const request = typeof input === 'object' && !urlLike(input) ? (input as Request) : null;
    if (
      request &&
      ((init?.mode === undefined && request.mode === 'navigate') || !/^https?:/.test(request.url))
    )
      return PRISTINE_FETCH(input, init);

    // Snapshot mutable fields synchronously, BEFORE Blob/Request body reads yield.
    const snapInit = init ? snapshotInit(init) : undefined;
    if (snapInit?.headers !== undefined) snapInit.headers = new Headers(snapInit.headers);
    // An explicit null signal clears the Request signal; undefined inherits it.
    const signal = snapInit?.signal === undefined ? request?.signal : snapInit.signal;
    signal?.throwIfAborted();
    const source = snapInit?.body;
    let snapInput = urlLike(input) ? input.href : input;
    let method: string;
    const headers = new Headers(snapInit?.headers ?? request?.headers);
    let body: string | undefined;
    let bodyBase64: string | undefined;
    try {
      // Reject this combination even for an oversized body, without copying it first.
      const effectiveMethod =
        snapInit?.method === undefined ? (request?.method ?? 'GET') : String(snapInit.method);
      if ((source != null || request?.body != null) && /^(GET|HEAD)$/i.test(effectiveMethod))
        throw new TypeError('Request with GET/HEAD method cannot have body');

      // Request construction extracts/copies BodyInit. Bound all known sizes FIRST.
      if (typeof source === 'string') assertTextBodySize(source);
      else if (
        ArrayBuffer.isView(source) ||
        Object.prototype.toString.call(source) === '[object ArrayBuffer]'
      )
        assertBodySize((source as ArrayBuffer | ArrayBufferView).byteLength);
      else if (source instanceof Blob) assertBodySize(source.size);
      else if (Object.prototype.toString.call(source) === '[object URLSearchParams]') {
        body = source!.toString();
        assertBodySize(body.length); // Form encoding is ASCII.
      }

      const requestInput = request ?? new URL(snapInput.toString(), window.location.href).href;
      if (source instanceof FormData || source instanceof ReadableStream) {
        if (autoDivert) return PRISTINE_FETCH(snapInput, snapInit);
        // Validate native errors before the explicit API's unsupported-body error.
        // An empty placeholder avoids unbounded multipart encoding. A stream is not
        // read/locked by construction, which also checks duplex and stream usability.
        new Request(
          requestInput,
          source instanceof FormData ? { ...snapInit, body: new Uint8Array(0) } : snapInit,
        );
        throw new Error(
          'window.solid.fetch does not support FormData or ReadableStream request bodies',
        );
      }

      // Use the platform's effective-request validation for every input and override.
      // Clone only inherited bodies: an override can replace a used/locked input body.
      const normalized = new Request(
        request && source == null ? request.clone() : requestInput,
        snapInit,
      );
      if (request) snapInput = normalized;
      method = normalized.method;
      if (source != null) {
        if (typeof source === 'string') {
          validateBodyFields(source, undefined);
          body = source;
        } else if (
          ArrayBuffer.isView(source) ||
          Object.prototype.toString.call(source) === '[object ArrayBuffer]'
        ) {
          const view = ArrayBuffer.isView(source)
            ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
            : new Uint8Array(source as ArrayBuffer);
          assertBodySize(view.byteLength);
          const copy = new Uint8Array(view);
          if (snapInit) snapInit.body = copy;
          bodyBase64 = bytesToBase64(copy);
        } else if (Object.prototype.toString.call(source) === '[object URLSearchParams]') {
          // Already serialized and size-checked before Request construction.
          if (snapInit) snapInit.body = new URLSearchParams(body);
          if (!headers.has('content-type'))
            headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
        } else if (source instanceof Blob) {
          assertBodySize(source.size);
          if (!headers.has('content-type') && source.type) headers.set('content-type', source.type);
          const bytes = new Uint8Array(await source.arrayBuffer());
          signal?.throwIfAborted();
          bodyBase64 = bytesToBase64(bytes);
        } else {
          throw new Error(
            'window.solid.fetch does not support FormData or ReadableStream request bodies',
          );
        }
      } else if (request && normalized.body !== null) {
        const bytes = await readBodyBounded(
          normalized.clone().body,
          MAX_BODY_BYTES,
          REQUEST_BODY_LIMIT_ERROR,
          signal ?? undefined,
        );
        signal?.throwIfAborted();
        bodyBase64 = bytesToBase64(bytes);
      }
    } catch (error) {
      // Cancellation must reject with the caller's reason, including on the native fallback path.
      signal?.throwIfAborted();
      // Serialization is best-effort for the global patch: native fetch retains the
      // unread snapshot even if the bounded bridge read overflows or fails.
      if (autoDivert) return PRISTINE_FETCH(snapInput, snapInit);
      throw error;
    }
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      // Deferred native fallback keeps Request metadata and a separate, unread body.
      pendingFetches.set(requestId, { resolve, reject, input: snapInput, init: snapInit });
      postToContent({
        type: 'SOLID_FETCH_REQUEST',
        requestId,
        url: request?.url ?? snapInput.toString(),
        method,
        headers: Object.fromEntries(headers.entries()),
        ...(body !== undefined ? { body } : {}),
        ...(bodyBase64 !== undefined ? { bodyBase64 } : {}),
        autoDivert,
      });
    });
  }

  function action(type: string, extra: Record<string, unknown> = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const actionId = crypto.randomUUID();
      pendingActions.set(actionId, { resolve, reject });
      postToContent({ type, actionId, ...extra });
    });
  }

  // The client-id declared via setClientId(), carried directly on the login message so a
  // page that calls setClientId() then immediately login() can't race the storage write.
  let currentClientId: string | undefined;

  const solid: SolidExtension = {
    get webId() {
      return currentWebId;
    },
    fetch: solidFetch,
    setClientId(clientId: string) {
      currentClientId = clientId;
      postToContent({ type: 'SOLID_SET_CLIENT_ID', clientId });
    },
    login(webId: string) {
      return action('SOLID_LOGIN', { webId, clientId: currentClientId });
    },
    logout() {
      return action('SOLID_LOGOUT');
    },
    async requestAccess(request: AccessRequestArgs) {
      const res = await accessRequest('SOLID_REQUEST_ACCESS', {
        classes: request?.classes ?? [],
        modes: request?.modes ?? [],
        purpose: request?.purpose,
        duration: request?.duration,
      });
      if (res.ok && res.webId) {
        currentWebId = res.webId;
        setGranted(true);
      }
      return { ok: res.ok === true, grants: res.grants ?? [] };
    },
    async listGrants() {
      const res = await accessRequest('SOLID_LIST_GRANTS');
      return res.grants ?? [];
    },
    async revokeGrant(grantId: string) {
      const res = await accessRequest('SOLID_REVOKE_GRANT', { grantId });
      return res.ok === true;
    },
    async disconnect() {
      const res = await accessRequest('SOLID_DISCONNECT');
      return res.ok === true;
    },
    async resolveClass(classIRI: string) {
      const res = await accessRequest('SOLID_RESOLVE_CLASS', { classIRI });
      return { shape: res.shape ?? null, targets: res.targets ?? [] };
    },
  };

  // The permanent surface is a stub. Privileged properties exist only while granted.
  const stub = {
    login: solid.login,
    requestAccess: solid.requestAccess,
    disconnect: solid.disconnect,
  };
  const privileged = [
    'webId',
    'fetch',
    'setClientId',
    'logout',
    'listGrants',
    'revokeGrant',
    'resolveClass',
  ] as const;
  function setGranted(granted: boolean): void {
    for (const key of privileged) {
      if (granted)
        Object.defineProperty(stub, key, {
          ...Object.getOwnPropertyDescriptor(solid, key),
          configurable: true,
        });
      else Reflect.deleteProperty(stub, key);
    }
    try {
      if (granted) window.fetch = patchedFetch;
      else if (window.fetch === patchedFetch) window.fetch = nativeFetch;
    } catch {
      /* best effort */
    }
  }
  Object.defineProperty(window, 'solid', { value: stub, configurable: false });

  // --- Presence announce (apps de-dupe their own account chrome) --------------------------
  //
  // A page needs a RELIABLE, RACE-FREE way to know the Solid extension is installed so it can
  // hide its OWN profile/logout controls (the extension already shows a pinned account menu —
  // showing both is duplicate chrome). `'solid' in window` is the API, but a page script that
  // runs BEFORE this MAIN-world inject (a race, since inject is document_start) would sniff a
  // bare window and wrongly conclude "no extension". So we announce presence two ways, both
  // credential-free (this only says "an extension is here", never who the user is):
  //   1. a STICKY DOM marker on <html> — readable SYNCHRONOUSLY by app code whenever it runs,
  //      even long after inject (it persists), so there is no ordering dependency; and
  //   2. a one-shot CustomEvent for a listener that was already attached before inject ran.
  // The webId still lives ONLY on `window.solid.webId` (null until auth) — the marker/event
  // carry no identity. Wrapped defensively: an announce failure must never break `window.solid`.
  try {
    window.document.documentElement.setAttribute('data-solid-extension', '1');
    // Use the page realm's own CustomEvent (window.CustomEvent === CustomEvent in a real page)
    // so the event is same-realm with the window it is dispatched on.
    window.dispatchEvent(new window.CustomEvent('solid-extension:ready'));
  } catch {
    // Non-fatal — the `window.solid` API above is the source of truth; the marker is a hint.
  }

  // --- The MAIN-world global-`fetch` patch (design §5.1) ---------------------------------
  //
  // Generalises the `window.solid.fetch` proxy: transparently route a page's PLAIN
  // `fetch(podUrl)` through the extension (→ ISOLATED bridge → SW → DPoP egress) so an
  // unmodified Solid app gets authenticated, replica-backed reads/writes with no code change.
  //
  // SECURITY (load-bearing): this patch is BEST-EFFORT TRANSPARENCY with ZERO security weight
  // (design §5.1). The SW gate remains the SOLE boundary — EVERY routed request still goes
  // through the Phase-0 per-requesting-origin gate as the FIRST check (in the SW). The patch is
  // racy + bypassable by design; a missed/bypassed request is a plain unauthenticated fetch
  // (pod 401, fail-safe for the credential) governed by the server's own WAC. The patch can
  // NEVER widen access — it only forwards to the same gated `solid.fetch` path.
  //
  // Re-assert discipline (the @jeswr/solid-elements `installProactiveAuthFetch` pattern):
  // snapshot the PRISTINE fetch FIRST (done at the TOP of installSolidInjection above, before
  // any page script could overwrite `window.fetch`), install once (idempotent), and never
  // re-read a possibly-patched global. A later page script that overwrites `window.fetch` only
  // affects ITS OWN requests — it gains no credential (the SW gate is the boundary). The same
  // PRISTINE_FETCH also services the SW passthrough sentinel (round-2 High #1).

  /**
   * A CHEAP page-side pre-filter for which requests are even WORTH routing to the SW — NOT the
   * security/compat decision (that is the SW's, see below). We route only http(s) CROSS-origin
   * absolute URLs: a Solid pod is on a different origin than the app, so a same-origin or
   * relative request is the app's own asset/API and stays on the untouched native fetch (no
   * proxy tax). The inject deliberately does NOT know the pod-origin set (it must not, to avoid
   * leaking the pod list / PII to an arbitrary page — design §5.1) — it stays DUMB and lets the
   * SW (the SOLE boundary) decide.
   *
   * HIGH #1 — THE KEY INVARIANT: routing here must NEVER break the page's normal web traffic.
   * Routing a NON-pod cross-origin request (an app's call to a third-party API/CDN) must end in
   * a plain NATIVE UNAUTHENTICATED fetch, not a 403. That is achieved on the SW side: a routed
   * request carries `autoDivert: true`, and when the SW gate does not ALLOW (a non-pod target,
   * or an un-granted requesting origin) the SW performs a native unauthenticated passthrough
   * instead of returning a gate-deny. The credential + replica path is taken ONLY on an explicit
   * gate ALLOW (a known pod origin from a granted requesting origin). Over-routing is therefore
   * harmless: the worst case for any non-pod request is the same plain fetch the page would have
   * done itself. (An EXPLICIT `window.solid.fetch` carries `autoDivert: false` and keeps the 403.)
   */
  function shouldDivert(input: RequestInfo | URL): boolean {
    try {
      const url = new URL(
        typeof input === 'string' ? input : urlLike(input) ? input.href : (input as Request).url,
        window.location.href,
      );
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
      // Same-origin requests are the app's own assets/APIs — leave them on native fetch.
      return url.origin !== window.location.origin;
    } catch {
      return false;
    }
  }

  /** A real Request's own credentials mode, via the native getter; undefined for anything else. */
  function requestCredentials(input: RequestInfo | URL): string | undefined {
    if (typeof input !== 'object' || input === null || !REQUEST_CREDENTIALS) return undefined;
    try {
      return REQUEST_CREDENTIALS.call(input) as string;
    } catch {
      return undefined; // Not a Request: native fetch stringifies it as a URL.
    }
  }

  /**
   * A caller that asks for `credentials: 'omit'` (in `init`, or on a `Request` when `init` does
   * not override it) has opted out of identity, so the patch must never route it into
   * authenticated egress (sst-5mya). Apps use this for public reads, and the extension's account
   * may not be the app's active account.
   *
   * `init` is read exactly once into a plain snapshot whose `credentials` is normalised as Web IDL
   * would (String()), and that snapshot is what either path receives, so a getter or Proxy cannot
   * answer 'omit' to this check and something else to fetch. An invalid mode stays in the
   * snapshot for native fetch to reject; a throwing getter rejects with its first error.
   */
  const patchedFetch: typeof fetch = (input, init) => {
    let snapshot: RequestInit | undefined;
    let omit: boolean;
    try {
      snapshot = init === undefined || init === null ? undefined : snapshotInit(init);
      if (snapshot?.credentials !== undefined) {
        snapshot.credentials = String(snapshot.credentials) as RequestCredentials;
        omit = snapshot.credentials === 'omit';
      } else {
        omit = requestCredentials(input) === 'omit';
      }
    } catch (error) {
      return Promise.reject(error);
    }
    if (!omit && shouldDivert(input)) {
      return solidFetch(input, snapshot, true);
    }
    return PRISTINE_FETCH(input as RequestInfo, snapshot);
  };

  window.addEventListener('solid-extension:grant-patch', () =>
    postToContent({ type: 'SOLID_GET_STATE' }),
  );

  // Ask the worker for the current session state on load (populates window.solid.webId).
  postToContent({ type: 'SOLID_GET_STATE' });
}
