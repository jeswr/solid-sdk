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
  makeKey,
} from './cache-policy.js';
import type { MetadataStore } from './metadata-store.js';
import type { CacheMetadata, UpdatedEvent } from './types.js';

/** Minimal Cache-API surface we depend on (Cache stores Response bytes by Request). */
export interface ByteCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}

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

  const cached = await deps.cache.match(request);
  const now = deps.now();

  if (cached) {
    const key = keyForCachedLookup(rl, cached);
    const record = await deps.meta.get(key);

    // Negative cache (403/404): honour within TTL for no-leak parity; otherwise
    // fall through to a fresh network attempt.
    if (record && (record.status === 403 || record.status === 404)) {
      if (record.negativeUntil && now < record.negativeUntil) {
        return { response: cached.clone(), source: 'cache-hit-negative' };
      }
      // TTL expired → treat as a miss: re-fetch from network.
      return networkAndMaybeStore(request, rl, deps, 'expired-negative');
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

  // MISS.
  if (!deps.isOnline()) {
    // Offline miss: nothing to serve; let any network error surface to the caller
    // (we never invent an authoritative answer the cache cannot back).
    const response = await deps.fetch(request);
    return { response, source: 'offline-miss' };
  }
  return networkAndMaybeStore(request, rl, deps, 'miss');
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
 * Determine the metadata key for a cache hit. We re-derive the varyKey from the
 * cached response's Vary against the live request headers, so a request asking
 * for a different Accept variant doesn't collide.
 */
function keyForCachedLookup(rl: RequestLike, cached: Response): string {
  const varyKey = computeVaryKey(rl, resLike(cached));
  return makeKey(rl.url, varyKey);
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
  await store(request, rl, response, deps, decision.negative);
  return { response: response.clone(), source: 'network-miss-store' };
}

/** Write bytes (Cache API) + metadata (IDB) for a cacheable response. */
async function store(
  request: Request,
  rl: RequestLike,
  response: Response,
  deps: SwrDeps,
  negative: boolean,
): Promise<void> {
  const now = deps.now();
  // Store a clone so the caller still gets a live body.
  await deps.cache.put(request, response.clone());
  await deps.meta.put(metadataFromResponse(rl, resLike(response), now, negative));
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
    const condHeaders = new Headers(request.headers);
    condHeaders.set('If-None-Match', etag);
    const condRequest = new Request(request.url, {
      method: 'GET',
      headers: condHeaders,
    });
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
        await store(condRequest, rl, fresh, deps, decision.negative);
      }
      const newEtag = fresh.headers.get('etag') ?? undefined;
      deps.broadcast.postMessage({ url: rl.url, event: 'updated', etag: newEtag });
      return { kind: '200-replaced', etag: newEtag };
    }

    // 403/404 now? The resource changed visibility — drop the stale entry and
    // record a negative entry so offline reads are uniform (no-leak parity).
    if (fresh.status === 403 || fresh.status === 404) {
      await deps.cache.delete(request).catch(() => false);
      await deps.meta.put(metadataFromResponse(rl, resLike(fresh), deps.now(), true));
      deps.broadcast.postMessage({ url: rl.url, event: 'updated' });
      return { kind: '200-replaced' };
    }

    return { kind: 'skipped' };
  } catch (error) {
    return { kind: 'error', error };
  }
}
