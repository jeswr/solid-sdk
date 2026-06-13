/**
 * Stale-while-revalidate engine for §2.
 *
 * This is the heart of P1 and is written against small injected interfaces
 * (a Cache-API-like store, a fetch function, a clock, an online flag and a
 * BroadcastChannel-like notifier) so the full decision tree is unit-testable
 * with mocks — no real ServiceWorker, no real browser.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NEVER-AUTHORITATIVE INVARIANT (mirrors prod-solid-server `CLAUDE.md`):
 *   A value served from cache is ALWAYS provisional. We only treat it as
 *   confirmed once a conditional revalidation (`If-None-Match: <etag>`) returns
 *   304 (ETag matches → touch fetchedAt) or 200 (replace entry + broadcast).
 *   On a cache hit we therefore ALWAYS kick a revalidation (online) and we tag
 *   offline hits with `X-Offline: stale` so the consumer knows the value is
 *   unconfirmed. The cache is never the source of truth.
 * ────────────────────────────────────────────────────────────────────────────
 */

import {
  NEGATIVE_CACHE_TTL_MS,
  type RequestLike,
  type ResponseLike,
  aclStatusFor,
  classifyResponse,
  computeCacheKey,
  computeVaryKey,
  keyRequest,
} from './cache-policy.js';
import type { MetadataStore } from './metadata-store.js';
import type { CacheMetadata, UpdatedEvent } from './types.js';

/** Minimal Cache-API surface we depend on (Cache stores Response bytes by Request). */
export interface ByteCache {
  match(request: Request, options?: CacheQueryOptions): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request, options?: CacheQueryOptions): Promise<boolean>;
}

/**
 * We key the byte cache on our own synthetic canonical Request (`keyRequest`), so
 * the stored response's own `Vary` must NOT cause the Cache API to re-apply header
 * matching on top. We pass `ignoreVary` on every match/delete instead of mutating
 * the stored response — preserving its metadata (`url`, `redirected`, `type`).
 */
const IGNORE_VARY: CacheQueryOptions = { ignoreVary: true };

/** Minimal BroadcastChannel surface. */
export interface Broadcaster {
  postMessage(message: UpdatedEvent): void;
}

/** Dependencies injected into the engine (all mockable in tests). */
export interface SwrDeps {
  cache: ByteCache;
  meta: MetadataStore;
  fetch: typeof fetch;
  broadcast: Broadcaster;
  /** Returns current epoch ms. */
  now(): number;
  /** Returns whether the browser believes it is online. */
  isOnline(): boolean;
}

/** Outcome classifier for tests + observability. */
export type ServeSource =
  | 'cache-hit-online' // served from cache, revalidation fired
  | 'cache-hit-offline' // served from cache + X-Offline: stale
  | 'cache-hit-negative' // served a cached 403/404 (within TTL)
  | 'network-miss-store' // cache miss → network → stored
  | 'network-miss-nostore' // cache miss → network → not cacheable
  | 'network-no-cache' // request was never-cache; straight passthrough
  | 'offline-miss'; // cache miss while offline → network error surfaces

export interface HandleResult {
  response: Response;
  source: ServeSource;
  /** Resolves once any background revalidation completes (for tests). */
  revalidation?: Promise<RevalidateOutcome>;
}

export type RevalidateOutcome =
  | { kind: '304-confirmed' }
  | { kind: '200-replaced'; etag?: string }
  | { kind: 'skipped' }
  | { kind: 'error'; error: unknown };

function reqLike(request: Request): RequestLike {
  return { url: request.url, method: request.method, headers: request.headers };
}

function resLike(response: Response): ResponseLike {
  return { status: response.status, headers: response.headers, type: response.type };
}

/** Add `X-Offline: stale` to a response without consuming its body. */
function withOfflineStale(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Offline', 'stale');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function metadataFromResponse(
  req: RequestLike,
  res: ResponseLike,
  now: number,
  negative: boolean,
): CacheMetadata {
  const varyKey = computeVaryKey(req, res);
  return {
    key: computeCacheKey(req, res),
    url: req.url,
    varyKey,
    etag: res.headers.get('etag') ?? undefined,
    contentType: res.headers.get('content-type') ?? undefined,
    fetchedAt: now,
    vary: res.headers.get('vary') ?? undefined,
    aclStatus: aclStatusFor(res.status),
    status: res.status,
    ...(negative ? { negativeUntil: now + NEGATIVE_CACHE_TTL_MS } : {}),
  };
}

/**
 * The main entry: decide how to serve a GET/HEAD request and (for hits) fire the
 * never-authoritative revalidation. Caller is the SW `fetch` handler; tests call
 * it directly with mocked deps.
 */
export async function handleFetch(request: Request, deps: SwrDeps): Promise<HandleResult> {
  const rl = reqLike(request);

  // Never-cache endpoints (auth/OIDC/.well-known/subscription/WS): straight passthrough.
  // We can decide this from the request alone — no need to consult the cache.
  if (!isPotentiallyCacheable(rl)) {
    const response = await deps.fetch(request);
    return { response, source: 'network-no-cache' };
  }

  const now = deps.now();

  // HEAD is a NON-DESTRUCTIVE network passthrough (the #6 corrective, hardened
  // across re-review). A HEAD has no body, and the byte cache holds GET bodies
  // under the SAME canonical (url, varyKey) key, so a HEAD must NEVER serve a
  // cached GET body, NEVER fabricate a body-backed metadata row, and — crucially —
  // NEVER PURGE. A HEAD result is not authoritative enough to evict GET bytes:
  //   - a warmer HEAD probe is unauthenticated relative to the GET, so a 403/404
  //     (or an ETag mismatch on a probe) does NOT mean the user lost access;
  //   - the SW forwards the warmer's HEAD through this very path, so purging here
  //     would evict valid offline bytes the authenticated GET would have kept.
  // Revocation/change is handled authoritatively by GET revalidation + notification
  // invalidation. The ONLY thing a HEAD does is CONFIRM freshness when its explicit
  // ETag matches the stored variant (a safe, additive touch).
  if (rl.method.toUpperCase() === 'HEAD') {
    const response = await deps.fetch(request);
    const headEtag = response.headers.get('etag') ?? undefined;
    if (response.status >= 200 && response.status < 300 && headEtag !== undefined) {
      const existing = await lookupRecord(rl, deps);
      if (existing && headEtag === existing.etag) {
        await deps.meta.touch(existing.key, deps.now()); // confirm freshness only
      }
    }
    return { response, source: 'network-no-cache' };
  }

  // METADATA-FIRST (the #1 fix). The metadata store — not the byte cache — is the
  // authority on what we hold and for whom: it is opened against the WebID-scoped
  // DB, and the byte cache is opened against the WebID-scoped Cache (`scope.ts`).
  // We find the metadata record whose stored `vary` the live request matches, and
  // ONLY then look at the bytes under THAT record's canonical (url, varyKey) key.
  // Deriving the key from the stored record (not from an assumed `Vary: Accept`)
  // means a resource that varies on some other header — e.g. `Accept-Language` —
  // is looked up under the same key it was stored under (no permanent miss /
  // orphan bytes). A byte-cache entry with no matching metadata is never served.
  const record = await lookupRecord(rl, deps);
  const keyReq = record
    ? keyRequest(rl.url, record.varyKey)
    : keyRequest(rl.url, varyKeyForRequest(rl));

  if (!record) {
    // No metadata: even if bytes somehow exist under this key, do NOT serve them.
    // Delete any orphan bytes (no-leak) and fall through to the network.
    await deps.cache.delete(keyReq, IGNORE_VARY).catch(() => false);
    if (!deps.isOnline()) {
      const response = await deps.fetch(request);
      return { response, source: 'offline-miss' };
    }
    return networkAndMaybeStore(request, rl, deps, 'miss');
  }

  // Negative cache (403/404): honour within TTL for no-leak parity; otherwise
  // fall through to a fresh network attempt.
  if (record.status === 403 || record.status === 404) {
    if (record.negativeUntil && now < record.negativeUntil) {
      const negBytes = await deps.cache.match(keyReq, IGNORE_VARY);
      // Serve the cached negative bytes if we kept them (#8); else synthesize the
      // bare status so offline/within-TTL reads are uniform.
      const response = negBytes ? negBytes.clone() : new Response(null, { status: record.status });
      return { response, source: 'cache-hit-negative' };
    }
    // TTL expired → treat as a miss: re-fetch from network.
    return networkAndMaybeStore(request, rl, deps, 'expired-negative');
  }

  const cached = await deps.cache.match(keyReq, IGNORE_VARY);
  if (!cached) {
    // Metadata says we hold this, but the bytes are gone (evicted / partial write).
    // Re-fetch rather than serve nothing.
    if (!deps.isOnline()) {
      const response = await deps.fetch(request);
      return { response, source: 'offline-miss' };
    }
    return networkAndMaybeStore(request, rl, deps, 'miss');
  }

  if (deps.isOnline()) {
    // HIT + ONLINE: serve provisional bytes NOW, revalidate in background.
    const revalidation = revalidate(request, rl, record, deps);
    return {
      response: cached.clone(),
      source: 'cache-hit-online',
      revalidation,
    };
  }

  // HIT + OFFLINE: serve provisional bytes, mark them stale/unconfirmed.
  return { response: withOfflineStale(cached.clone()), source: 'cache-hit-offline' };
}

/** True if the request *could* be cached (GET/HEAD + not a never-cache endpoint). */
function isPotentiallyCacheable(req: RequestLike): boolean {
  const decision = classifyResponse(req, {
    status: 200,
    headers: req.headers,
    type: 'basic',
  });
  // classifyResponse rejects method + endpoint regardless of (faux) 200 status.
  return decision.reason !== 'method-not-get-head' && decision.reason !== 'never-cache-endpoint';
}

/**
 * The varyKey a *request* maps to, derived from the request alone.
 *
 * At lookup time we don't yet have the server's `Vary` header, but the server
 * always varies RDF reads on `Accept` (prod-solid-server emits `Vary: Accept,
 * Origin`), and `computeVaryKey` ignores `Origin` for same-origin SW keying. So a
 * synthetic `Vary: Accept` reproduces exactly the canonical key the response path
 * computes — and folds all RDF Accept variants onto one entry (`#7`).
 */
function varyKeyForRequest(rl: RequestLike): string {
  return computeVaryKey(rl, { status: 200, headers: syntheticVaryAccept(), type: 'basic' });
}

/** A Headers-like that reports `Vary: Accept` (the server's RDF contract). */
function syntheticVaryAccept(): Headers {
  const h = new Headers();
  h.set('vary', 'Accept');
  return h;
}

/**
 * Find the metadata record for a request, matching the request against each
 * candidate's STORED `vary` (not an assumed `Vary: Accept`).
 *
 * For each row of this URL we recompute the varyKey the request would produce
 * UNDER THAT ROW'S `vary` header and compare it to the row's stored `varyKey`. The
 * row that matches is the one this request maps to — so a resource that varies on
 * any header (Accept, Accept-Language, …) is looked up under exactly the key it
 * was stored under (the #7-coherence corrective). The fast path (a single
 * Accept-keyed row, the overwhelmingly common case) still resolves in one compare.
 */
async function lookupRecord(rl: RequestLike, deps: SwrDeps): Promise<CacheMetadata | undefined> {
  const rows = await deps.meta.getByUrl(rl.url);
  if (rows.length === 0) return undefined;
  for (const row of rows) {
    const requestVaryKey = computeVaryKey(rl, {
      status: row.status,
      headers: varyHeaders(row.vary),
      type: 'basic',
    });
    if (requestVaryKey === row.varyKey) return row;
  }
  return undefined;
}

/** A Headers-like exposing a stored `vary` value (or `Accept` when unknown). */
function varyHeaders(vary: string | undefined): Headers {
  const h = new Headers();
  h.set('vary', vary ?? 'Accept');
  return h;
}

/**
 * Delete EVERY cached variant (byte entry + metadata row) for a URL.
 *
 * A change/revoke/delete affects the whole resource, not just the one `Vary` key
 * the current request matched. Purging only the matched variant would leave other
 * variants (or legacy pre-canonical rows) readable — a stale-serve / no-leak hole.
 */
async function purgeAllVariants(url: string, deps: SwrDeps): Promise<void> {
  const rows = await deps.meta.getByUrl(url);
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.varyKey);
    await deps.cache.delete(keyRequest(url, row.varyKey), IGNORE_VARY).catch(() => false);
    await deps.meta.delete(row.key);
  }
  // Defensive: also drop the canonical Turtle variant in case a byte entry exists
  // with no metadata row (orphan from a partial write).
  if (!seen.has('accept=text/turtle')) {
    await deps.cache.delete(keyRequest(url, 'accept=text/turtle'), IGNORE_VARY).catch(() => false);
  }
}

/** Cache miss → fetch from network and store iff cacheable. */
async function networkAndMaybeStore(
  request: Request,
  rl: RequestLike,
  deps: SwrDeps,
  _origin: 'miss' | 'expired-negative',
): Promise<HandleResult> {
  const response = await deps.fetch(request);
  const decision = classifyResponse(rl, resLike(response));
  if (!decision.cacheable) {
    return { response, source: 'network-miss-nostore' };
  }
  // GET only (HEAD is metadata-only, handled upstream).
  await store(rl, response, deps, decision.negative);
  return { response: response.clone(), source: 'network-miss-store' };
}

/**
 * Write bytes (Cache API) + metadata (IDB) for a cacheable response, under the
 * CANONICAL `(url, varyKey)` key so the byte cache and metadata stay 1:1.
 *  - The byte cache is keyed on `keyRequest(...)` (never the live request); reads
 *    pass `ignoreVary` so the stored response's own `Vary` can't re-apply header
 *    matching on top of our canonical key (#3/#7) — and we DON'T mutate the stored
 *    response, so its metadata (`url`, `redirected`, `type`) is preserved.
 *  - 403/404 negative bodies ARE byte-cached so within-TTL/offline reads serve
 *    the same bytes the server returned (#8).
 *
 * Only ever called for GET responses — HEAD is metadata-only and handled upstream
 * in `handleFetch` (it never reaches here, so it can never clobber GET bytes, #6).
 */
async function store(
  rl: RequestLike,
  response: Response,
  deps: SwrDeps,
  negative: boolean,
): Promise<void> {
  const now = deps.now();
  const res = resLike(response);
  const varyKey = computeVaryKey(rl, res);
  const keyReq = keyRequest(rl.url, varyKey);
  // Store a clone (so the caller still gets a live body) UN-mutated; reads use
  // `ignoreVary` rather than stripping the response's `Vary`.
  await deps.cache.put(keyReq, response.clone());
  await deps.meta.put(metadataFromResponse(rl, res, now, negative));
}

/**
 * The never-authoritative revalidation: conditional GET with `If-None-Match`.
 *  - 304 → confirm: touch fetchedAt (bytes still valid).
 *  - 200 → replace bytes + metadata, broadcast {url, event:'updated'}.
 *  - other → leave the provisional entry as-is (don't make things worse).
 */
async function revalidate(
  request: Request,
  rl: RequestLike,
  record: CacheMetadata | undefined,
  deps: SwrDeps,
): Promise<RevalidateOutcome> {
  if (!record || !record.etag) {
    // No ETag to revalidate against → nothing safe to do conditionally.
    return { kind: 'skipped' };
  }
  const etag = record.etag;
  try {
    // Build the conditional request FROM THE ORIGINAL (the #2 fix): preserve
    // credentials, mode, referrer, redirect, etc. A bare `new Request(url, {...})`
    // drops `credentials: 'include'`/`mode`, so a cross-origin authenticated read
    // would revalidate UNAUTHENTICATED and wrongly 401/403 → delete/replace state.
    const condHeaders = new Headers(request.headers);
    condHeaders.set('If-None-Match', etag);
    const condRequest = new Request(request, { method: 'GET', headers: condHeaders });
    const fresh = await deps.fetch(condRequest);

    if (fresh.status === 304) {
      // 304 carries no body and no reliable Vary; reuse the record key we
      // already hold and just touch fetchedAt — the provisional bytes are
      // hereby confirmed fresh.
      await deps.meta.touch(record.key, deps.now());
      return { kind: '304-confirmed' };
    }

    if (fresh.status >= 200 && fresh.status < 300) {
      const decision = classifyResponse(rl, resLike(fresh));
      if (decision.cacheable) {
        // A change replaces the whole resource: drop EVERY stale variant for this
        // URL first (other Vary keys / legacy rows), then store the new canonical
        // one — so `lookupRecord` can't keep matching an old variant.
        await purgeAllVariants(rl.url, deps);
        await store(rl, fresh, deps, decision.negative);
      } else {
        // 2xx but NOT cacheable now (e.g. the server added Cache-Control:
        // no-store/private). Leaving ANY variant's bytes + metadata would keep
        // serving stale content the server has made uncacheable — so purge ALL
        // variants for this URL (the re-review corrective: a revoke affects every
        // Vary key, not just the matched one).
        await purgeAllVariants(rl.url, deps);
      }
      const newEtag = fresh.headers.get('etag') ?? undefined;
      deps.broadcast.postMessage({ url: rl.url, event: 'updated', etag: newEtag });
      return { kind: '200-replaced', etag: newEtag };
    }

    // 403/404 now? The resource changed visibility — a permission revoke / delete
    // affects EVERY variant. Purge ALL variants for this URL first (the re-review
    // corrective), then go through `classifyResponse`: a cacheable 403/404 leaves a
    // single negative entry (offline parity, #8); a no-store/private 403/404 caches
    // nothing. Either way no stale positive variant survives.
    if (fresh.status === 403 || fresh.status === 404) {
      const decision = classifyResponse(rl, resLike(fresh));
      await purgeAllVariants(rl.url, deps);
      if (decision.cacheable) {
        await store(rl, fresh, deps, decision.negative);
      }
      deps.broadcast.postMessage({ url: rl.url, event: 'updated' });
      return { kind: '200-replaced' };
    }

    return { kind: 'skipped' };
  } catch (error) {
    return { kind: 'error', error };
  }
}
