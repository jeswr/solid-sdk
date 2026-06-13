// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * Notification-driven invalidation pipeline (P3, §5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHERE THIS RUNS — the SW side (decision 1 & 5):
 *   The WebSocket lives in the PAGE (`notifications.ts`); the page `postMessage`s
 *   each change frame here, into the (unauthenticated) service worker. This
 *   module owns the *invalidation* half: look the resource up in the P1 metadata
 *   store, decide whether anything changed, revalidate (or re-fetch a container
 *   listing) and broadcast `{url, event:'updated'}` to every tab. It NEVER signs
 *   or authenticates — for a private resource its conditional GET will simply
 *   404/401 and the page's own warm/read re-populates the cache; the SW only
 *   ever issues unauthenticated conditional GETs (consistent with P1/P2).
 * ────────────────────────────────────────────────────────────────────────────
 *
 * THE ETAG SHORT-CIRCUIT (the join with the server, §5):
 *   The server's change frame carries the resource's new ETag in `state`
 *   (prod-solid-server `src/notifications/notification.ts`). If that equals the
 *   ETag we already hold, the change is one WE caused (our own write, already
 *   reflected in the cache) — so it is a free no-op: no fetch, no broadcast.
 *   This is what makes a self-caused change cost nothing.
 *
 * The pipeline is written against the same small injected interfaces as `swr.ts`
 * (a Cache-API-like store, a `fetch`, a clock, a BroadcastChannel-like notifier)
 * plus the P1 {@link MetadataStore}, so the whole decision tree is unit-testable
 * with mocks — no real ServiceWorker, no real WebSocket, no real network.
 */

import {
  type RequestLike,
  type ResponseLike,
  aclStatusFor,
  classifyResponse,
  computeCacheKey,
  computeVaryKey,
  keyRequest,
} from './cache-policy.js';
import type { MetadataStore } from './metadata-store.js';
import type { Broadcaster, ByteCache } from './swr.js';
import type { CacheMetadata, NotificationFrame } from './types.js';

/**
 * We key the byte cache on our synthetic canonical Request, so reads/deletes pass
 * `ignoreVary` to stop the stored response's own `Vary` re-applying header matching
 * (mirrors `swr.ts`). This lets us keep the response UN-mutated (metadata preserved).
 */
const IGNORE_VARY: CacheQueryOptions = { ignoreVary: true };

/** Dependencies for the invalidation pipeline (all mockable). */
export interface InvalidateDeps {
  cache: ByteCache;
  meta: MetadataStore;
  /** Unauthenticated conditional GET (the SW's own fetch). See module note. */
  fetch: typeof fetch;
  broadcast: Broadcaster;
  now(): number;
}

/** Outcome of handling a single notification frame — returned for tests + observability. */
export type InvalidateOutcome =
  | { kind: 'short-circuit' } // frame.state === cached ETag → free no-op
  | { kind: 'not-cached' } // we hold nothing for this resource → nothing to do
  | { kind: '304-confirmed' } // revalidation confirmed the bytes are still fresh
  | { kind: 'updated'; etag?: string } // bytes replaced + broadcast
  | { kind: 'deleted' } // resource gone (Delete, or 403/404 on revalidate) → purged + broadcast
  | { kind: 'listing-refreshed' } // Add/Remove → container listing re-fetched + broadcast
  | { kind: 'skipped' } // nothing actionable (e.g. no ETag to revalidate against)
  | { kind: 'error'; error: unknown };

function rdfRequest(url: string): Request {
  return new Request(url, { method: 'GET', headers: { accept: 'text/turtle' } });
}

function resLike(response: Response): ResponseLike {
  return { status: response.status, headers: response.headers, type: response.type };
}

function metadataFromResponse(
  req: RequestLike,
  res: ResponseLike,
  now: number,
  negative: boolean,
  lastState?: string,
): CacheMetadata {
  return {
    key: computeCacheKey(req, res),
    url: req.url,
    varyKey: computeVaryKey(req, res),
    etag: res.headers.get('etag') ?? undefined,
    contentType: res.headers.get('content-type') ?? undefined,
    fetchedAt: now,
    vary: res.headers.get('vary') ?? undefined,
    aclStatus: aclStatusFor(res.status),
    status: res.status,
    ...(lastState !== undefined ? { lastState } : {}),
    ...(negative ? { negativeUntil: now + 30_000 } : {}),
  };
}

/**
 * Handle one change notification frame. The single entry point the SW message
 * handler calls; tests call it directly with mocked deps.
 *
 *  - `Create`/`Update`/`Delete` → look up the `object`; ETag short-circuit, else
 *    revalidate (`If-None-Match`) and update Cache+metadata, then broadcast.
 *  - `Add`/`Remove` → re-fetch the `target` *container listing* (membership
 *    changed; a bare ETag can't tell us the new member set), then broadcast.
 */
export async function handleNotification(
  frame: NotificationFrame,
  deps: InvalidateDeps,
): Promise<InvalidateOutcome> {
  try {
    if (frame.type === 'Add' || frame.type === 'Remove') {
      return await refreshListing(frame, deps);
    }
    if (frame.type === 'Delete') {
      return await invalidateResource(frame.object, frame.state, deps, { deleted: true });
    }
    // Create / Update.
    return await invalidateResource(frame.object, frame.state, deps, { deleted: false });
  } catch (error) {
    return { kind: 'error', error };
  }
}

/**
 * Invalidate a single (Create/Update/Delete) resource.
 *
 * ETag short-circuit FIRST: if the frame's `state` equals an ETag we already
 * hold for this URL, the change is already reflected in our cache (we caused it)
 * — record `lastState` and return without any network or broadcast.
 */
async function invalidateResource(
  url: string,
  state: string | undefined,
  deps: InvalidateDeps,
  opts: { deleted: boolean },
): Promise<InvalidateOutcome> {
  const records = await deps.meta.getByUrl(url);
  if (records.length === 0) {
    // We hold nothing for this resource. A Create we never warmed is not our
    // concern (the page will fetch it on demand → P1 caches it then).
    return { kind: 'not-cached' };
  }

  // THE ETAG SHORT-CIRCUIT: a self-caused change is free.
  if (state !== undefined && records.some((r) => r.etag === state)) {
    // Remember the state so a later identical frame is still recognized as a no-op.
    await deps.meta.setLastState(url, state);
    return { kind: 'short-circuit' };
  }

  if (opts.deleted) {
    return purge(url, records, deps);
  }

  return revalidateResource(url, records, state, deps);
}

/** Drop bytes + metadata for a deleted/forbidden resource, then broadcast. */
async function purge(
  url: string,
  records: CacheMetadata[],
  deps: InvalidateDeps,
): Promise<InvalidateOutcome> {
  // Delete EVERY cached variant for this URL (the #3 fix). Bytes are keyed on the
  // canonical `(url, varyKey)` Request, one per metadata record, so we must drop
  // each — deleting only a single synthetic `Accept: text/turtle` key would leave
  // other variants' bytes behind with no metadata (a no-leak hole).
  const seenKeys = new Set<string>();
  for (const record of records) {
    seenKeys.add(record.varyKey);
    await deps.cache.delete(keyRequest(url, record.varyKey), IGNORE_VARY).catch(() => false);
  }
  // Belt-and-braces: also drop the canonical Turtle variant in case a byte entry
  // exists with no metadata row (orphan from a partial write).
  if (!seenKeys.has('accept=text/turtle')) {
    await deps.cache.delete(keyRequest(url, 'accept=text/turtle'), IGNORE_VARY).catch(() => false);
  }
  for (const record of records) {
    await deps.meta.delete(record.key);
  }
  deps.broadcast.postMessage({ url, event: 'updated' });
  return { kind: 'deleted' };
}

/**
 * Store bytes under the canonical key WITHOUT mutating the response (mirrors
 * `swr.ts#store`): reads pass `ignoreVary` so the stored `Vary` can't re-apply
 * header matching, while the response's metadata (`url`/`type`/…) is preserved.
 */
async function putCanonical(
  rl: RequestLike,
  response: Response,
  deps: InvalidateDeps,
): Promise<void> {
  const varyKey = computeVaryKey(rl, resLike(response));
  await deps.cache.put(keyRequest(rl.url, varyKey), response.clone());
}

/**
 * A cacheable update REPLACES the whole resource: drop every existing variant
 * (byte entry + metadata row) for the URL EXCEPT the canonical one we're about to
 * (re)write, so `lookupRecord` can't keep matching a stale `Vary` row or a legacy
 * pre-canonical row after the update (the re-review corrective).
 */
async function purgeStaleVariants(
  url: string,
  records: CacheMetadata[],
  keepVaryKey: string,
  deps: InvalidateDeps,
): Promise<void> {
  for (const record of records) {
    // Keep the variant we're about to (re)write; it is overwritten by the
    // subsequent canonical put + meta.put.
    if (record.varyKey === keepVaryKey) continue;
    await deps.cache.delete(keyRequest(url, record.varyKey), IGNORE_VARY).catch(() => false);
    await deps.meta.delete(record.key);
  }
}

/**
 * Revalidate a changed resource with a conditional GET (`If-None-Match`).
 *  - 304 → confirm (touch fetchedAt + record the new state).
 *  - 2xx → replace bytes + metadata, broadcast with the new ETag.
 *  - 403/404 → resource gone/forbidden: purge + broadcast (no-leak parity).
 */
async function revalidateResource(
  url: string,
  records: CacheMetadata[],
  state: string | undefined,
  deps: InvalidateDeps,
): Promise<InvalidateOutcome> {
  const etag = records.find((r) => r.etag)?.etag;
  const req = rdfRequest(url);
  const rl: RequestLike = { url: req.url, method: req.method, headers: req.headers };

  const condHeaders = new Headers(req.headers);
  if (etag) condHeaders.set('If-None-Match', etag);
  const condRequest = new Request(url, { method: 'GET', headers: condHeaders });
  const fresh = await deps.fetch(condRequest);

  if (fresh.status === 304) {
    // Unchanged after all (the notification ETag differed from ours but the
    // server says our copy is current — e.g. a racing intermediate state).
    const now = deps.now();
    for (const record of records) {
      record.fetchedAt = now;
      if (state !== undefined) record.lastState = state;
      await deps.meta.put(record);
    }
    return { kind: '304-confirmed' };
  }

  if (fresh.status >= 200 && fresh.status < 300) {
    const decision = classifyResponse(rl, resLike(fresh));
    const newEtag = fresh.headers.get('etag') ?? undefined;
    if (decision.cacheable) {
      // Replace the whole resource: drop stale OTHER variants before writing the
      // new canonical one (so lookup can't keep matching an old Vary row).
      await purgeStaleVariants(url, records, computeVaryKey(rl, resLike(fresh)), deps);
      await putCanonical(rl, fresh, deps);
      await deps.meta.put(
        metadataFromResponse(rl, resLike(fresh), deps.now(), decision.negative, state ?? newEtag),
      );
      deps.broadcast.postMessage({ url, event: 'updated', etag: newEtag });
      return { kind: 'updated', etag: newEtag };
    }
    // 2xx but NOT cacheable (Cache-Control: no-store / private). The resource is
    // now uncacheable, so leaving the OLD bytes + metadata in place would keep
    // serving a stale entry (the re-review corrective). Purge everything for this
    // URL and broadcast so views re-read live.
    return purge(url, records, deps);
  }

  if (fresh.status === 403 || fresh.status === 404) {
    return purge(url, records, deps);
  }

  // Anything else (5xx, etc.): leave the provisional entry alone, surface nothing.
  return { kind: 'skipped' };
}

/**
 * Add/Remove → the container's membership changed. A bare ETag short-circuit
 * can't tell us the new member set, so we re-fetch the *container listing*
 * unconditionally, replace its cached bytes/metadata, and broadcast the
 * container URL so listing views refresh.
 */
async function refreshListing(
  frame: NotificationFrame,
  deps: InvalidateDeps,
): Promise<InvalidateOutcome> {
  const container = frame.target ?? frame.object;
  const records = await deps.meta.getByUrl(container);
  if (records.length === 0) {
    // We never cached this container listing → nothing to refresh.
    return { kind: 'not-cached' };
  }

  const req = rdfRequest(container);
  const rl: RequestLike = { url: req.url, method: req.method, headers: req.headers };
  const fresh = await deps.fetch(req);

  if (fresh.status >= 200 && fresh.status < 300) {
    const decision = classifyResponse(rl, resLike(fresh));
    if (!decision.cacheable) {
      // 2xx but uncacheable (no-store/private): purge the stale listing rather
      // than leaving the old bytes/metadata in place (re-review corrective).
      return purge(container, records, deps);
    }
    // Replace the whole listing: drop stale OTHER variants before writing the new
    // canonical one.
    await purgeStaleVariants(container, records, computeVaryKey(rl, resLike(fresh)), deps);
    await putCanonical(rl, fresh, deps);
    await deps.meta.put(
      metadataFromResponse(
        rl,
        resLike(fresh),
        deps.now(),
        decision.negative,
        fresh.headers.get('etag') ?? undefined,
      ),
    );
    deps.broadcast.postMessage({
      url: container,
      event: 'updated',
      etag: fresh.headers.get('etag') ?? undefined,
    });
    // (The newly-added member is fetched lazily on first read — P1 caches it then.
    // We don't eagerly pull it: the warm budget owns proactive byte-warming.)
    return { kind: 'listing-refreshed' };
  }

  if (fresh.status === 403 || fresh.status === 404) {
    return purge(container, records, deps);
  }
  return { kind: 'skipped' };
}

/**
 * The reconnect ETag-resync sweep (§5). After the socket reconnects (we missed
 * frames while down) revalidate the ENTIRE warmed set with conditional GETs —
 * mostly cheap 304s. This REPLACES P2's "re-issue the full BFS" re-warm: it does
 * no discovery/traversal, just a flat conditional revalidation of what we hold.
 *
 * Also used as the body of the disconnected slow-poll (one pass at a time).
 */
export interface SweepResult {
  /** Entries examined. */
  checked: number;
  /** Entries the server confirmed unchanged (304). */
  confirmed: number;
  /** Entries whose bytes were replaced (200). */
  replaced: number;
  /** Entries purged (403/404). */
  purged: number;
  /** Entries with no ETag to revalidate against (skipped). */
  skipped: number;
}

export async function resyncSweep(deps: InvalidateDeps): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, confirmed: 0, replaced: 0, purged: 0, skipped: 0 };
  const all = await deps.meta.getAll();
  // Dedup by URL (multiple varyKeys share an origin resource; one GET suffices).
  const byUrl = new Map<string, CacheMetadata[]>();
  for (const record of all) {
    const list = byUrl.get(record.url) ?? [];
    list.push(record);
    byUrl.set(record.url, list);
  }

  for (const [url, records] of byUrl) {
    // Skip negatively-cached entries: they have no body to confirm, and a fresh
    // read of them is the page's job (read-on-demand re-checks visibility).
    if (records.every((r) => r.status === 403 || r.status === 404)) continue;
    const etag = records.find((r) => r.etag)?.etag;
    if (!etag) {
      result.skipped += 1;
      continue;
    }
    result.checked += 1;
    const outcome = await revalidateResource(url, records, undefined, deps);
    if (outcome.kind === '304-confirmed') result.confirmed += 1;
    else if (outcome.kind === 'updated') result.replaced += 1;
    else if (outcome.kind === 'deleted') result.purged += 1;
    else result.skipped += 1;
  }
  return result;
}
