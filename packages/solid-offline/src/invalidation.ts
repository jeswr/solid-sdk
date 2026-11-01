// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/** StorageClient-driven invalidation. The worker remains credential-free. */

import type { StorageClient } from '@jeswr/storage-client';
import { StorageError } from '@jeswr/storage-client';
import {
  deleteVariantBytes,
  IGNORE_VARY,
  metadataFromResponse,
  putCanonicalBytes,
  resLike,
} from './cache-coherence.js';
import { classifyResponse, computeVaryKey, keyRequest, type RequestLike } from './cache-policy.js';
import type { MetadataStore } from './metadata-store.js';
import { policyResponse } from './storage.js';
import type { Broadcaster, ByteCache } from './swr.js';
import type { CacheMetadata, NotificationFrame } from './types.js';

/** Dependencies for the invalidation pipeline (all mockable). */
export interface InvalidateDeps {
  cache: ByteCache;
  meta: MetadataStore;
  /** The worker's credential-free client (or an injected page/test client). */
  storage: StorageClient;
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
    if (
      !deps.storage.isWithinStorage(frame.object) ||
      (frame.target && !deps.storage.isWithinStorage(frame.target)) ||
      (frame.origin && !deps.storage.isWithinStorage(frame.origin))
    )
      return { kind: 'skipped' };
    if (frame.type === 'Add' || frame.type === 'Remove') {
      return await refreshListing(frame, deps);
    }
    const outcome = await invalidateResource(frame.object, frame.state, deps, {
      deleted: frame.type === 'Delete',
    });
    const parents =
      frame.type === 'Move'
        ? [frame.origin, frame.target]
        : frame.type === 'Create'
          ? [frame.target]
          : frame.type === 'Delete'
            ? [frame.origin ?? frame.target]
            : [];
    for (const target of new Set(parents)) {
      if (target) await refreshListing({ type: 'Add', object: frame.object, target }, deps);
    }
    return outcome;
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
  // Delete EVERY cached variant's bytes for this URL (the #3 fix) + the defensive
  // canonical-Turtle orphan sweep — the shared coherence primitive (deleting only
  // a single synthetic key would leave other variants' bytes behind with no
  // metadata, a no-leak hole). Then drop the metadata rows + broadcast.
  await deleteVariantBytes(
    deps.cache,
    url,
    records.map((record) => record.varyKey),
  );
  for (const record of records) {
    await deps.meta.delete(record.key);
  }
  deps.broadcast.postMessage({ url, event: 'updated' });
  return { kind: 'deleted' };
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

  let fresh: Response;
  try {
    const result = await deps.storage.read(url, {
      accept: deps.storage.protocol === 'lws' ? '*/*' : 'text/turtle',
      ...(etag ? { ifNoneMatch: etag } : {}),
    });
    if (result.status === 304) fresh = new Response(null, { status: 304 });
    else {
      const observed = policyResponse(result);
      // Without the original HTTP policy, invalidate rather than manufacturing
      // a cacheable response from the reduced StorageClient result.
      if (!observed) {
        await result.body?.cancel();
        return purge(url, records, deps);
      }
      fresh = new Response(result.body, { status: result.status, headers: observed.headers });
      if (observed.type === 'opaque' || observed.type === 'opaqueredirect')
        return purge(url, records, deps);
    }
  } catch (error) {
    if (error instanceof StorageError && (error.status === 403 || error.status === 404))
      return purge(url, records, deps);
    if (error instanceof StorageError && error.status !== null) return { kind: 'skipped' };
    throw error;
  }

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
      await putCanonicalBytes(deps.cache, rl, fresh);
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
  const container = frame.target ?? frame.origin ?? frame.object;
  const records = await deps.meta.getByUrl(container);
  if (records.length === 0) {
    // We never cached this container listing → nothing to refresh.
    return { kind: 'not-cached' };
  }

  const req = rdfRequest(container);
  const rl: RequestLike = { url: req.url, method: req.method, headers: req.headers };
  let fresh: Response;
  try {
    const result = await deps.storage.read(container, {
      accept: deps.storage.protocol === 'lws' ? '*/*' : 'text/turtle',
    });
    const observed = policyResponse(result);
    if (!observed) {
      await result.body?.cancel();
      return purge(container, records, deps);
    }
    if (observed.type === 'opaque' || observed.type === 'opaqueredirect')
      return purge(container, records, deps);
    fresh = new Response(result.body, { status: result.status, headers: observed.headers });
  } catch (error) {
    if (error instanceof StorageError && (error.status === 403 || error.status === 404))
      return purge(container, records, deps);
    if (error instanceof StorageError && error.status !== null) return { kind: 'skipped' };
    throw error;
  }

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
    await putCanonicalBytes(deps.cache, rl, fresh);
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

/** Reconcile the warmed set using fresh HEADs, reading only changed/unversioned entries. */
export interface SweepResult {
  /** Entries examined. */
  checked: number;
  /** Entries confirmed by HEAD ETag equality or a conditional read (304). */
  confirmed: number;
  /** Entries whose bytes were replaced (200). */
  replaced: number;
  /** Entries purged (403/404). */
  purged: number;
  /** Entries that could not be reconciled (scope, transport or server failure). */
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
    if (!deps.storage.isWithinStorage(url)) {
      result.skipped += 1;
      continue;
    }
    result.checked += 1;
    let outcome: InvalidateOutcome;
    try {
      // HEAD is only an optimization. A refusal or transport error says nothing
      // about whether GET remains readable, so let the conditional read decide.
      const head = await deps.storage.head(url, { revalidate: true }).catch(() => null);
      if (etag && head?.etag === etag) {
        for (const record of records) {
          record.fetchedAt = deps.now();
          await deps.meta.put(record);
        }
        result.confirmed += 1;
        continue;
      } else outcome = await revalidateResource(url, records, undefined, deps);
    } catch {
      result.skipped += 1;
      continue;
    }
    if (outcome.kind === '304-confirmed') result.confirmed += 1;
    else if (outcome.kind === 'updated') result.replaced += 1;
    else if (outcome.kind === 'deleted') result.purged += 1;
    else result.skipped += 1;
  }
  return result;
}
