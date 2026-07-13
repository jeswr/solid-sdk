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
  deleteVariantBytes,
  IGNORE_VARY,
  metadataFromResponse,
  putCanonicalBytes,
  resLike,
} from './cache-coherence.js';
import {
  classifyResponse,
  computeVaryKey,
  keyRequest,
  type RequestLike,
  requestCacheDirective,
} from './cache-policy.js';
import type { MetadataStore } from './metadata-store.js';
import type { CacheMetadata, UpdatedEvent } from './types.js';

/** Minimal Cache-API surface we depend on (Cache stores Response bytes by Request). */
export interface ByteCache {
  match(request: Request, options?: CacheQueryOptions): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request, options?: CacheQueryOptions): Promise<boolean>;
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
  | 'request-no-store' // request sent `Cache-Control: no-store`; pure network bypass
  | 'request-no-cache-revalidated' // request sent `Cache-Control: no-cache`; forced synchronous revalidation
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

/**
 * The main entry: decide how to serve a GET/HEAD request and (for hits) fire the
 * never-authoritative revalidation. Caller is the SW `fetch` handler; tests call
 * it directly with mocked deps.
 *
 * Reads as a dispatcher of the distinct serving modes; each mode is its own named
 * function (so each security branch is independently readable):
 *   1. never-cache endpoint → straight passthrough;
 *   2. HEAD → non-destructive passthrough (`handleHead`);
 *   3. an online `Cache-Control: no-store`/`no-cache` request → `handleDirective`;
 *   4. otherwise the metadata-first SWR cache path (`handleCachePath`).
 */
export async function handleFetch(request: Request, deps: SwrDeps): Promise<HandleResult> {
  const rl = reqLike(request);

  // 1. Never-cache endpoints (auth/OIDC/.well-known/subscription/WS): straight
  //    passthrough — decidable from the request alone, no cache consulted.
  if (!isPotentiallyCacheable(rl)) {
    const response = await deps.fetch(request);
    return { response, source: 'network-no-cache' };
  }

  // 2. HEAD is a non-destructive passthrough (never serves/evicts GET bytes).
  if (rl.method.toUpperCase() === 'HEAD') {
    return handleHead(request, rl, deps);
  }

  // 3. An online request-directive (no-store/no-cache) opts out of the SWR fast
  //    path (offline they can't be satisfied → fall through to the cache path).
  const directive = requestCacheDirective(rl);
  if (deps.isOnline() && directive !== 'default') {
    return handleDirective(directive, request, rl, deps);
  }

  // 4. The normal metadata-first stale-while-revalidate cache path.
  return handleCachePath(request, rl, deps);
}

/**
 * HEAD is a NON-DESTRUCTIVE network passthrough (the #6 corrective, hardened
 * across re-review). A HEAD has no body, and the byte cache holds GET bodies under
 * the SAME canonical (url, varyKey) key, so a HEAD must NEVER serve a cached GET
 * body, NEVER fabricate a body-backed metadata row, and — crucially — NEVER PURGE.
 * A HEAD result is not authoritative enough to evict GET bytes:
 *   - a warmer HEAD probe is unauthenticated relative to the GET, so a 403/404 (or
 *     an ETag mismatch on a probe) does NOT mean the user lost access;
 *   - the SW forwards the warmer's HEAD through this very path, so purging here
 *     would evict valid offline bytes the authenticated GET would have kept.
 * Revocation/change is handled authoritatively by GET revalidation + notification
 * invalidation. The ONLY thing a HEAD does is CONFIRM freshness when its explicit
 * ETag matches the stored variant (a safe, additive touch).
 */
async function handleHead(request: Request, rl: RequestLike, deps: SwrDeps): Promise<HandleResult> {
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

/**
 * REQUEST-DIRECTED FRESHNESS (security-critical, no-stale-ACL-for-mutations). A
 * caller opts a single GET out of the stale-while-revalidate fast path:
 *   - `no-store` → pure network bypass: never read OR write the cache. Forward
 *     with `cache: 'no-store'` so the SW's own fetch can't satisfy the read from
 *     the browser/intermediary HTTP cache either (roborev Medium) — the caller
 *     wants nothing cache-derived.
 *   - `no-cache` → forced SYNCHRONOUS revalidation before serving (never a
 *     provisional/stale body). This is exactly how Solid clients defeat heuristic
 *     HTTP caching before a read-modify-write on a security-sensitive doc (e.g. an
 *     `.acl` ahead of a grant/revoke), so the SW must not undercut it.
 * Only reached when online (the caller gates `directive !== 'default'` on online).
 */
async function handleDirective(
  directive: 'no-store' | 'no-cache',
  request: Request,
  rl: RequestLike,
  deps: SwrDeps,
): Promise<HandleResult> {
  if (directive === 'no-store') {
    const passthrough = new Request(request, { method: 'GET', cache: 'no-store' });
    const response = await deps.fetch(passthrough);
    return { response, source: 'request-no-store' };
  }
  // no-cache: forced synchronous revalidation before serving.
  return forcedRevalidate(request, rl, deps);
}

/**
 * The metadata-first stale-while-revalidate cache path (the #1 fix). The metadata
 * store — not the byte cache — is the authority on what we hold and for whom: it
 * is opened against the WebID-scoped DB, and the byte cache against the
 * WebID-scoped Cache (`scope.ts`). We find the metadata record whose stored `vary`
 * the live request matches, and ONLY then look at the bytes under THAT record's
 * canonical (url, varyKey) key. Deriving the key from the stored record (not an
 * assumed `Vary: Accept`) means a resource that varies on some other header (e.g.
 * `Accept-Language`) is looked up under the same key it was stored under (no
 * permanent miss / orphan bytes). A byte-cache entry with no matching metadata is
 * never served.
 */
async function handleCachePath(
  request: Request,
  rl: RequestLike,
  deps: SwrDeps,
): Promise<HandleResult> {
  const record = await lookupRecord(rl, deps);
  const keyReq = record
    ? keyRequest(rl.url, record.varyKey)
    : keyRequest(rl.url, varyKeyForRequest(rl));

  if (!record) {
    // No metadata: even if bytes somehow exist under this key, do NOT serve them.
    // Delete any orphan bytes (no-leak) and fall through to the network.
    await deps.cache.delete(keyReq, IGNORE_VARY).catch(() => false);
    return missOrFetch(request, rl, deps);
  }

  // Negative cache (403/404): honour within TTL for no-leak parity; otherwise
  // fall through to a fresh network attempt.
  if (record.status === 403 || record.status === 404) {
    if (record.negativeUntil && deps.now() < record.negativeUntil) {
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
    return missOrFetch(request, rl, deps);
  }

  if (deps.isOnline()) {
    // HIT + ONLINE: serve provisional bytes NOW, revalidate in background.
    const revalidation = revalidate(request, rl, record, deps);
    return { response: cached.clone(), source: 'cache-hit-online', revalidation };
  }

  // HIT + OFFLINE: serve provisional bytes, mark them stale/unconfirmed.
  return { response: withOfflineStale(cached.clone()), source: 'cache-hit-offline' };
}

/**
 * FORCED SYNCHRONOUS REVALIDATION for a `Cache-Control: no-cache` request
 * (security-critical, no-stale-ACL-for-mutations).
 *
 * Unlike the SWR hit path, this NEVER returns a provisional body: it goes to the
 * network and only serves once the answer is confirmed. If we hold a record with
 * an ETag we send a conditional GET (`If-None-Match`) so a `304` is cheap and the
 * confirmed cached bytes are served; a `200` replaces every variant + broadcasts;
 * a `403`/`404` purges + broadcasts. With no usable record we just fetch and store
 * iff cacheable. The cached entry is kept coherent the same way the background
 * revalidation does, but the caller is guaranteed a server-confirmed response.
 */
async function forcedRevalidate(
  request: Request,
  rl: RequestLike,
  deps: SwrDeps,
): Promise<HandleResult> {
  const record = await lookupRecord(rl, deps);

  // KEEP the caller's `Cache-Control: no-cache` on the wire (roborev High): the
  // SW's `self.fetch` can itself hit the browser HTTP cache / an intermediary, so
  // dropping the directive would let the conditional request be confirmed against
  // STALE intermediary state — defeating the very guarantee this path exists for.
  // When we hold an ETag we add `If-None-Match` so a fresh origin answer is a
  // cheap 304; the `no-cache` directive (and `cache: 'no-cache'` request mode)
  // forces the revalidation all the way to the origin either way.
  const condHeaders = new Headers(request.headers);
  if (!condHeaders.has('cache-control')) condHeaders.set('cache-control', 'no-cache');
  if (record?.etag) condHeaders.set('If-None-Match', record.etag);
  const condRequest = new Request(request, {
    method: 'GET',
    headers: condHeaders,
    cache: 'no-cache',
  });
  const fresh = await deps.fetch(condRequest);

  // A `304` only CONFIRMS our cached bytes when WE sent the validator that earned
  // it — i.e. only when the stored record had an ETag we put in `If-None-Match`
  // (roborev High). If the record had no ETag we sent no validator, so a `304`
  // (e.g. earned by an `If-Modified-Since` the caller's request happened to carry,
  // or a misbehaving server) does NOT validate OUR bytes — never serve them. We
  // re-fetch unconditionally (purging first) so the caller gets a confirmed body.
  if (fresh.status === 304 && record?.etag) {
    // Confirmed: serve the cached bytes (now proven fresh), touch fetchedAt.
    const keyReq = keyRequest(rl.url, record.varyKey);
    const cached = await deps.cache.match(keyReq, IGNORE_VARY);
    await deps.meta.touch(record.key, deps.now());
    if (cached) {
      return { response: cached.clone(), source: 'request-no-cache-revalidated' };
    }
    // Bytes evicted under us → fall through to a fresh unconditional read below
    // (purge first so no stale variant can survive). Re-fetch without the
    // conditional so we get a body.
  }

  // Either a `304` we did NOT validate (no stored ETag), or a `304` whose bytes
  // were evicted: re-fetch UNCONDITIONALLY (strip any `If-None-Match`) so the
  // caller is guaranteed a real body, and purge any stale variant first.
  if (fresh.status === 304) {
    await purgeAllVariants(rl.url, deps);
    const unconditional = new Headers(request.headers);
    // Strip EVERY conditional validator (roborev Medium) — not just If-None-Match
    // but also If-Modified-Since (and the other precondition headers) — or the
    // caller's own validators could earn ANOTHER bodyless 304 and we'd hand back a
    // 304 instead of the promised confirmed body.
    unconditional.delete('if-none-match');
    unconditional.delete('if-modified-since');
    unconditional.delete('if-match');
    unconditional.delete('if-unmodified-since');
    unconditional.delete('if-range');
    if (!unconditional.has('cache-control')) unconditional.set('cache-control', 'no-cache');
    const refetch = await deps.fetch(
      new Request(request, { method: 'GET', headers: unconditional, cache: 'no-cache' }),
    );
    return finalizeForced(rl, refetch, deps);
  }

  // Authoritative answer (200/403/404/etc.): purge every stale variant and store
  // the new one iff cacheable, regardless of whether we previously held an ETag
  // (roborev High: the no-ETag path must ALSO purge a stale positive entry when
  // the fresh answer is non-cacheable — no-store/private or 403/404 — so an old
  // positive ACL can never survive to be served later).
  return finalizeForced(rl, fresh, deps);
}

/**
 * Make a freshly-fetched authoritative response the cache's new truth for this
 * URL: drop EVERY existing variant, store the new one iff cacheable, broadcast.
 * Always returns the network answer (never a provisional body). Used by the
 * forced (`no-cache`) revalidation path for every non-304 authoritative status.
 */
async function finalizeForced(
  rl: RequestLike,
  fresh: Response,
  deps: SwrDeps,
): Promise<HandleResult> {
  // 1xx/3xx (or any non-authoritative blip): don't touch the cache; hand the
  // network answer back as-is. Only 2xx/403/404 are authoritative about content.
  const authoritative =
    (fresh.status >= 200 && fresh.status < 300) || fresh.status === 403 || fresh.status === 404;
  if (!authoritative) {
    return { response: fresh, source: 'request-no-cache-revalidated' };
  }
  const decision = classifyResponse(rl, resLike(fresh));
  // A change/revoke affects the whole resource → purge ALL variants first, so a
  // stale positive entry can never survive a non-cacheable (no-store/403/404)
  // answer.
  await purgeAllVariants(rl.url, deps);
  if (decision.cacheable) await store(rl, fresh, deps, decision.negative);
  deps.broadcast.postMessage({
    url: rl.url,
    event: 'updated',
    etag: fresh.headers.get('etag') ?? undefined,
  });
  return { response: fresh.clone(), source: 'request-no-cache-revalidated' };
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
  // Drop EVERY variant's bytes (+ the defensive canonical-Turtle orphan sweep).
  await deleteVariantBytes(
    deps.cache,
    url,
    rows.map((row) => row.varyKey),
  );
  for (const row of rows) {
    await deps.meta.delete(row.key);
  }
}

/**
 * A cache MISS (no usable metadata, or metadata but evicted bytes): offline →
 * passthrough the network error as `offline-miss`; online → fetch and store iff
 * cacheable. The two miss sites in `handleCachePath` share this exact behaviour.
 */
async function missOrFetch(
  request: Request,
  rl: RequestLike,
  deps: SwrDeps,
): Promise<HandleResult> {
  if (!deps.isOnline()) {
    const response = await deps.fetch(request);
    return { response, source: 'offline-miss' };
  }
  return networkAndMaybeStore(request, rl, deps, 'miss');
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
  // Store the bytes UN-mutated under the canonical (url, varyKey) key + the 1:1
  // metadata row (the shared coherence primitives — see `cache-coherence.ts`).
  await putCanonicalBytes(deps.cache, rl, response);
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
  if (!record?.etag) {
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
