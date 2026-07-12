/**
 * Pure cache-policy decisions for §2 of the offline-first architecture.
 *
 * Nothing here touches IndexedDB, the Cache API, or the network — it is all
 * deterministic functions over Request/Response-shaped inputs, so it is fully
 * unit-testable headlessly (no browser, no SW lifecycle).
 */

/** Canonical Accept used to normalize RDF reads to a single cache variant. */
export const CANONICAL_RDF_ACCEPT = 'text/turtle';

/** Short TTL (ms) for the negative cache of 403/404 (crawl pruning + no-leak parity). */
export const NEGATIVE_CACHE_TTL_MS = 30_000;

/** RDF media types we normalize to {@link CANONICAL_RDF_ACCEPT} for keying. */
const RDF_ACCEPT_HINTS = [
  'text/turtle',
  'application/ld+json',
  'application/n-triples',
  'application/n-quads',
  'application/trig',
  'application/rdf+xml',
];

/**
 * Endpoints we must never cache (auth/identity/realtime). Matched against the
 * URL pathname (case-insensitive substring) so it is host-agnostic.
 */
const NEVER_CACHE_PATH_HINTS = [
  '/.well-known/',
  '/oidc',
  '/token',
  '/authorize',
  '/auth',
  '/login',
  '/register',
  '/credentials',
  '/.account',
  '/subscription',
  '/notifications',
  '/.notifications',
];

export interface RequestLike {
  url: string;
  method: string;
  headers: HeadersLike;
}

export interface ResponseLike {
  status: number;
  headers: HeadersLike;
  /** Cross-origin opaque responses have type 'opaque' and an unreadable body/headers. */
  type?: string;
}

/** The subset of the Headers API we rely on (so tests can pass a plain mock). */
export interface HeadersLike {
  get(name: string): string | null;
}

/** Reasons a response is/ isn't cacheable — returned for observability + tests. */
export type CacheDecisionReason =
  | 'cacheable'
  | 'cacheable-negative'
  | 'method-not-get-head'
  | 'no-store'
  | 'private'
  | 'never-cache-endpoint'
  | 'opaque-cross-origin'
  | 'vary-star'
  | 'error-status';

export interface CacheDecision {
  cacheable: boolean;
  reason: CacheDecisionReason;
  /** True when this is the short-TTL negative cache of a 403/404. */
  negative: boolean;
}

/** True if a `Vary` header contains a `*` token (making the response non-shareable). */
export function varyHasStar(vary: string | null): boolean {
  if (!vary) return false;
  return vary
    .split(',')
    .map((t) => t.trim())
    .some((t) => t === '*');
}

/** Is the request method one we ever cache? (GET/HEAD only, per §2.) */
export function isCacheableMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

/** Does the URL hit an auth/identity/realtime endpoint we must never cache? */
export function isNeverCacheEndpoint(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    // Unparseable URL → be conservative, do not cache.
    return true;
  }
  // WebSocket upgrade URLs.
  if (url.toLowerCase().startsWith('ws://') || url.toLowerCase().startsWith('wss://')) {
    return true;
  }
  return NEVER_CACHE_PATH_HINTS.some((hint) => path.includes(hint));
}

/** Parse a Cache-Control header into the directives we care about. */
function parseCacheControl(value: string | null): { noStore: boolean; private: boolean } {
  if (!value) return { noStore: false, private: false };
  const directives = value
    .toLowerCase()
    .split(',')
    .map((d) => d.trim());
  return {
    noStore: directives.includes('no-store'),
    private: directives.includes('private'),
  };
}

/**
 * Does the REQUEST demand a forced revalidation (no stale serve)?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SECURITY-CRITICAL (no-stale-ACL-for-mutations): a caller can opt a single read
 * OUT of the stale-while-revalidate fast path by sending `Cache-Control:
 * no-cache` (revalidate before serving) or `no-store` (don't touch the cache at
 * all). Solid clients send `Cache-Control: no-cache` precisely to defeat
 * heuristic HTTP caching when they are about to read-modify-write a
 * security-sensitive document (e.g. an `.acl` before a grant/revoke). The SWR
 * engine MUST NOT hand such a read a provisional cached body, or a mutation could
 * decide on a stale ACL. We therefore honour the request directive: `no-cache`
 * forces a synchronous conditional revalidation before serving; `no-store`
 * bypasses the cache entirely (network passthrough, no read, no write).
 * ────────────────────────────────────────────────────────────────────────────
 */
export function requestCacheDirective(req: RequestLike): 'no-store' | 'no-cache' | 'default' {
  const cc = req.headers.get('cache-control');
  if (!cc) return 'default';
  const directives = cc
    .toLowerCase()
    .split(',')
    .map((d) => d.trim());
  if (directives.includes('no-store')) return 'no-store';
  if (directives.includes('no-cache')) return 'no-cache';
  return 'default';
}

/**
 * Classify whether a (request, response) pair may be written to the cache.
 *
 * Per §2 "Never cache": no-store/private; non-GET/HEAD; 4xx/5xx EXCEPT a
 * short-TTL negative cache of 403/404; auth/token/OIDC/.well-known/subscription/
 * WS endpoints; opaque cross-origin responses (no readable ETag).
 */
export function classifyResponse(req: RequestLike, res: ResponseLike): CacheDecision {
  if (!isCacheableMethod(req.method)) {
    return { cacheable: false, reason: 'method-not-get-head', negative: false };
  }

  if (isNeverCacheEndpoint(req.url)) {
    return { cacheable: false, reason: 'never-cache-endpoint', negative: false };
  }

  // Opaque cross-origin: type 'opaque' (and status 0) — headers/ETag unreadable,
  // so we cannot honour never-authoritative. Skip.
  if (res.type === 'opaque' || res.type === 'opaqueredirect' || res.status === 0) {
    return { cacheable: false, reason: 'opaque-cross-origin', negative: false };
  }

  const cc = parseCacheControl(res.headers.get('cache-control'));
  if (cc.noStore) {
    return { cacheable: false, reason: 'no-store', negative: false };
  }
  if (cc.private) {
    return { cacheable: false, reason: 'private', negative: false };
  }

  // A `*` ANYWHERE in `Vary` means the response is not shareable across requests
  // (every request is potentially distinct). The Cache API itself refuses to store
  // such a response under a normal key; because we store under our own synthetic
  // canonical key we must enforce the same rule here, or a later request with the
  // same synthetic key would wrongly receive it. Parse comma-separated tokens so
  // coalesced headers like `Vary: *, Accept` are caught too (not just exact `*`).
  if (varyHasStar(res.headers.get('vary'))) {
    return { cacheable: false, reason: 'vary-star', negative: false };
  }

  if (res.status === 403 || res.status === 404) {
    // Short-TTL negative cache: enables crawl pruning + uniform no-leak offline.
    return { cacheable: true, reason: 'cacheable-negative', negative: true };
  }

  if (res.status >= 400) {
    return { cacheable: false, reason: 'error-status', negative: false };
  }

  if (res.status >= 200 && res.status < 300) {
    return { cacheable: true, reason: 'cacheable', negative: false };
  }

  // 1xx/3xx (other than handled opaqueredirect) — not cached.
  return { cacheable: false, reason: 'error-status', negative: false };
}

/**
 * Compute the canonical Accept header for keying + revalidation.
 *
 * Per §2: "Normalize app RDF reads to canonical `Accept: text/turtle`". If the
 * request asks for any RDF media type (or `* /*`), we treat it as text/turtle so
 * all RDF variants share one cache entry (JSON-LD is re-serialized locally from
 * the quad index in a later phase). Non-RDF Accept values pass through verbatim.
 */
export function canonicalAccept(accept: string | null): string {
  if (!accept) return CANONICAL_RDF_ACCEPT;
  const lower = accept.toLowerCase();
  if (lower.includes('*/*')) return CANONICAL_RDF_ACCEPT;
  const asksForRdf = RDF_ACCEPT_HINTS.some((t) => lower.includes(t));
  if (asksForRdf) return CANONICAL_RDF_ACCEPT;
  // Non-RDF (e.g. image/png, text/html) — key on what was actually requested.
  return accept.split(',')[0]?.trim() ?? CANONICAL_RDF_ACCEPT;
}

/**
 * Compute the Vary discriminator ("varyKey") for a response.
 *
 * The server emits `Vary: Accept, Origin`. We build a stable key from each
 * varied request header (per §2). `Origin` is deliberately ignored for keying
 * (same-origin SW). `Accept` is normalized via {@link canonicalAccept}.
 *
 * Returns '' when the response does not Vary on anything we key on.
 */
export function computeVaryKey(req: RequestLike, res: ResponseLike): string {
  const vary = res.headers.get('vary');
  if (!vary) {
    // No Vary → still normalize Accept so RDF variants collapse to one entry.
    return `accept=${canonicalAccept(req.headers.get('accept'))}`;
  }
  if (varyHasStar(vary)) {
    // A `*` token means uncacheable-as-shared; force a unique, never-matching key
    // by including the raw Accept. (classifyResponse still governs whether we store.)
    return `vary*=${req.headers.get('accept') ?? ''}`;
  }
  const fields = vary
    .toLowerCase()
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const field of fields.sort()) {
    if (field === 'origin') continue; // ignored for keying (same-origin SW)
    if (field === 'accept') {
      parts.push(`accept=${canonicalAccept(req.headers.get('accept'))}`);
    } else {
      parts.push(`${field}=${req.headers.get(field) ?? ''}`);
    }
  }
  // Even when only Origin was varied (now skipped), keep Accept-normalization so
  // RDF reads share an entry.
  if (parts.length === 0) {
    parts.push(`accept=${canonicalAccept(req.headers.get('accept'))}`);
  }
  return parts.join('&');
}

/** The composite cache key = (url, varyKey). */
export function computeCacheKey(req: RequestLike, res: ResponseLike): string {
  return `${req.url} ${computeVaryKey(req, res)}`;
}

/** Build the composite key from already-known url + varyKey (for lookups). */
export function makeKey(url: string, varyKey: string): string {
  return `${url} ${varyKey}`;
}

/**
 * The CANONICAL internal Cache-API key for a `(url, varyKey)` pair.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY A SYNTHETIC KEY (resolves the #1/#3/#7 family coherently):
 *   The Cache API matches by Request, and honours the response's `Vary: Accept`
 *   header itself. That means:
 *     - `application/ld+json` and `text/turtle` reads of the SAME RDF resource do
 *       NOT share a cache entry, even though our metadata collapses them to one
 *       canonical key (`#7`);
 *     - purge / invalidation only ever deletes the one header-shaped Request it
 *       happened to synthesize, leaving other stored variants behind (`#3`);
 *     - a stored variant can later be served by `match()` with NO matching
 *       metadata record, which is the cross-user leak vector (`#1`).
 *   By keying every Cache `put`/`match`/`delete` on a single synthetic Request
 *   whose URL embeds the SAME `(url, varyKey)` the metadata uses — and stripping
 *   `Vary` before storing — the byte cache and the metadata store stay in exact
 *   1:1 correspondence. One canonical key, no header-driven divergence.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The key is a SENTINEL-ORIGIN URL that encodes the FULL `(url, varyKey)`
 * composite in its path. It deliberately does NOT reuse the live resource URL:
 * folding the varyKey into a query param on the real URL would collide if the
 * resource URL already carried that param (e.g. `…/doc?__solid_offline_key=…`),
 * so a request with valid metadata could receive another resource's bytes. A
 * fresh sentinel origin + a single percent-encoded composite path segment is
 * injective: distinct `(url, varyKey)` pairs always produce distinct keys, and
 * nothing the server ever sees can collide with it. `Vary` is dropped on store
 * (see `swr.ts#stripVary`) so the Cache API never re-applies header matching on
 * top of our canonical key.
 */
export const CACHE_KEY_ORIGIN = 'https://solid-offline.invalid/';

export function keyRequest(url: string, varyKey: string): Request {
  // Encode the WHOLE composite as one opaque, collision-free path segment.
  const keyUrl = `${CACHE_KEY_ORIGIN}${encodeURIComponent(makeKey(url, varyKey))}`;
  return new Request(keyUrl, { method: 'GET' });
}

/** Build the canonical Cache key Request directly from a (request, response) pair. */
export function keyRequestFor(req: RequestLike, res: ResponseLike): Request {
  return keyRequest(req.url, computeVaryKey(req, res));
}

/** Map an HTTP status to the AclStatus marker stored in metadata. */
export function aclStatusFor(status: number): 'ok' | 'forbidden' | 'not-found' {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  return 'ok';
}
