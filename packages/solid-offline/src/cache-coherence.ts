// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * Shared byte-cache ↔ metadata COHERENCE primitives (internal).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ONE REVIEWED IMPLEMENTATION of the tricky cache-coherence rules that BOTH the
 * SWR engine (`swr.ts`) and the notification-invalidation pipeline
 * (`invalidation.ts`) must obey identically:
 *
 *   - the byte cache is keyed on a SYNTHETIC canonical `(url, varyKey)` Request
 *     (`cache-policy.ts#keyRequest`), so every read/delete passes `ignoreVary`
 *     and the stored response is written UN-mutated (its `Vary` is not stripped,
 *     `ignoreVary` stops the Cache API re-applying header matching) — that keeps
 *     `url`/`redirected`/`type` intact;
 *   - a metadata record is the 1:1 companion of those bytes (the client analogue
 *     of QLever): the SAME builder produces it from a (request, response) pair,
 *     including the short-TTL `negativeUntil` for a cacheable 403/404;
 *   - a change/revoke affects the WHOLE resource, so dropping bytes drops EVERY
 *     `Vary` variant for the URL, plus a defensive sweep of the canonical Turtle
 *     key in case an orphan byte entry exists with no metadata row (a no-leak hole).
 *
 * Previously each of these lived twice (once per file) — and the negative-cache
 * TTL was even hardcoded as a bare `30_000` in one copy while the other used the
 * named `NEGATIVE_CACHE_TTL_MS`, a latent drift. Consolidating here means the
 * reviewer audits the never-authoritative / no-leak coherence rules ONCE, and a
 * future change to (say) the negative-cache TTL or the synthetic-key write cannot
 * silently diverge between the two consumers.
 *
 * The per-file PURGE ORCHESTRATION (which broadcasts fire, whether to keep a
 * to-be-rewritten variant, how metadata rows are deleted) stays in each file —
 * those genuinely differ between the SWR and the notification paths and reading
 * them in place is clearer than a flag-driven shared function.
 *
 * Pure decisions over the same injected ports (`ByteCache`, `MetadataStore`) as
 * its callers — no `caches`/`indexedDB`/`fetch`/SW globals.
 * ────────────────────────────────────────────────────────────────────────────
 */

import {
  NEGATIVE_CACHE_TTL_MS,
  type RequestLike,
  type ResponseLike,
  aclStatusFor,
  computeCacheKey,
  computeVaryKey,
  keyRequest,
} from './cache-policy.js';
import type { CacheMetadata } from './types.js';

/**
 * We key the byte cache on our own synthetic canonical Request, so the stored
 * response's own `Vary` must NOT cause the Cache API to re-apply header matching
 * on top. We pass `ignoreVary` on every match/delete instead of mutating the
 * stored response — preserving its metadata (`url`, `redirected`, `type`).
 */
export const IGNORE_VARY: CacheQueryOptions = { ignoreVary: true };

/** The canonical RDF variant's varyKey — also the defensive orphan-sweep key. */
export const CANONICAL_TURTLE_VARY_KEY = 'accept=text/turtle';

/** The minimal Cache-API surface the coherence helpers touch (subset of `ByteCache`). */
export interface CoherenceByteCache {
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request, options?: CacheQueryOptions): Promise<boolean>;
}

/** Project a `Response` onto the header-only shape the policy functions read. */
export function resLike(response: Response): ResponseLike {
  return { status: response.status, headers: response.headers, type: response.type };
}

/**
 * Build the {@link CacheMetadata} record that is the 1:1 companion of a cacheable
 * response's bytes. `negative` (a cacheable 403/404) sets the short-TTL
 * `negativeUntil`; `lastState` records the notification ETag the invalidation
 * path carries (omitted on the SWR write path).
 */
export function metadataFromResponse(
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
    ...(negative ? { negativeUntil: now + NEGATIVE_CACHE_TTL_MS } : {}),
  };
}

/**
 * Write a response's bytes to the byte cache under the CANONICAL `(url, varyKey)`
 * key, UN-mutated (a clone, so the caller still gets a live body). Reads pass
 * `ignoreVary` so the stored `Vary` can't re-apply header matching; the
 * response's own metadata (`url`/`redirected`/`type`) is preserved.
 *
 * Caller writes the matching metadata row (the two halves stay 1:1 by contract).
 */
export async function putCanonicalBytes(
  cache: CoherenceByteCache,
  rl: RequestLike,
  response: Response,
): Promise<void> {
  const varyKey = computeVaryKey(rl, resLike(response));
  await cache.put(keyRequest(rl.url, varyKey), response.clone());
}

/**
 * Delete the BYTE entries for the given variant `varyKey`s of a URL, plus a
 * defensive sweep of the canonical Turtle key (in case an orphan byte entry
 * exists with no metadata row — a no-leak hole from a partial write).
 *
 * This is the byte half of "a change/revoke affects the whole resource". Metadata
 * rows are deleted by the caller, whose ordering + broadcast policy differs
 * between the SWR and notification paths.
 */
export async function deleteVariantBytes(
  cache: CoherenceByteCache,
  url: string,
  varyKeys: Iterable<string>,
): Promise<void> {
  let sawTurtle = false;
  for (const varyKey of varyKeys) {
    if (varyKey === CANONICAL_TURTLE_VARY_KEY) sawTurtle = true;
    await cache.delete(keyRequest(url, varyKey), IGNORE_VARY).catch(() => false);
  }
  if (!sawTurtle) {
    await cache.delete(keyRequest(url, CANONICAL_TURTLE_VARY_KEY), IGNORE_VARY).catch(() => false);
  }
}
