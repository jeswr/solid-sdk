// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * Shared cache ↔ metadata COHERENCE primitives (`src/cache-coherence.ts`).
 *
 * This file focuses on the NO-LEAK invariant of `deleteVariantBytes` — the byte
 * half of "a change/revoke affects the whole resource". A change/revoke must
 * drop EVERY cached byte variant for the URL, including a defensive sweep of the
 * canonical Turtle key for the orphan case: a byte entry that survived with NO
 * matching metadata row (e.g. a partial write). If that orphan byte were left
 * behind it could later be served by `match()` with no metadata gate — the
 * cross-identity leak vector the synthetic-key design exists to close.
 *
 * The orphan-sweep branch (`if (!sawTurtle)`) is reachable ONLY through the
 * metadata-driven call sites (`purge` / `purgeStaleVariants` pass
 * `records.map(r => r.varyKey)`), so when the orphan byte has no metadata row the
 * canonical Turtle varyKey is absent from that list — exactly the path these
 * tests pin so a future regression deleting the sweep FAILS here.
 */
import { describe, expect, it } from 'vitest';
import { CANONICAL_TURTLE_VARY_KEY, deleteVariantBytes } from '../src/cache-coherence.js';
import { keyRequest } from '../src/cache-policy.js';

/**
 * A byte cache that records exactly which synthetic keys were deleted. It keys on
 * the synthetic Request URL alone (which embeds the `(url, varyKey)` composite),
 * matching how the real Cache API is driven through `keyRequest`.
 */
class RecordingByteCache {
  readonly present = new Set<string>();
  readonly deleted: string[] = [];

  seed(url: string, varyKey: string): void {
    this.present.add(keyRequest(url, varyKey).url);
  }

  has(url: string, varyKey: string): boolean {
    return this.present.has(keyRequest(url, varyKey).url);
  }

  put(_request: Request, _response: Response): Promise<void> {
    return Promise.resolve();
  }

  delete(request: Request, _options?: CacheQueryOptions): Promise<boolean> {
    this.deleted.push(request.url);
    return Promise.resolve(this.present.delete(request.url));
  }
}

const URL_A = 'https://alice.example/private/notes';

describe('deleteVariantBytes — no-leak orphan sweep', () => {
  it('sweeps the canonical Turtle byte even when it has NO metadata row (orphan)', async () => {
    const cache = new RecordingByteCache();
    // An orphan byte entry: the canonical Turtle variant is cached, but there is
    // NO metadata row for it (a partial write left it behind). A JSON-LD variant
    // DOES have a metadata row, so it's the only varyKey the caller can derive.
    cache.seed(URL_A, CANONICAL_TURTLE_VARY_KEY);
    cache.seed(URL_A, 'accept=application/ld+json');

    // The metadata-driven varyKeys deliberately EXCLUDE the canonical Turtle key
    // (no metadata row exists for the orphan) — this is the real call shape from
    // `purge`/`purgeStaleVariants` (`records.map(r => r.varyKey)`).
    await deleteVariantBytes(cache, URL_A, ['accept=application/ld+json']);

    // The metadata-backed variant is gone …
    expect(cache.has(URL_A, 'accept=application/ld+json')).toBe(false);
    // … AND the orphan canonical-Turtle byte must NOT survive (the no-leak
    // invariant). Removing the defensive sweep makes THIS assertion fail.
    expect(cache.has(URL_A, CANONICAL_TURTLE_VARY_KEY)).toBe(false);
    // Concretely: the sweep issued a delete against the canonical Turtle key.
    expect(cache.deleted).toContain(keyRequest(URL_A, CANONICAL_TURTLE_VARY_KEY).url);
  });

  it('does NOT double-delete when the canonical Turtle key is already in the variant list', async () => {
    const cache = new RecordingByteCache();
    cache.seed(URL_A, CANONICAL_TURTLE_VARY_KEY);

    await deleteVariantBytes(cache, URL_A, [CANONICAL_TURTLE_VARY_KEY]);

    expect(cache.has(URL_A, CANONICAL_TURTLE_VARY_KEY)).toBe(false);
    // Exactly one delete for the canonical key — the `sawTurtle` guard suppresses
    // the redundant sweep when the variant list already covers it.
    const turtleKey = keyRequest(URL_A, CANONICAL_TURTLE_VARY_KEY).url;
    expect(cache.deleted.filter((u) => u === turtleKey)).toHaveLength(1);
  });

  it('sweeps the canonical Turtle key even when given NO variants at all', async () => {
    const cache = new RecordingByteCache();
    cache.seed(URL_A, CANONICAL_TURTLE_VARY_KEY);

    await deleteVariantBytes(cache, URL_A, []);

    // With an empty variant list the orphan byte is still swept (no-leak).
    expect(cache.has(URL_A, CANONICAL_TURTLE_VARY_KEY)).toBe(false);
    expect(cache.deleted).toContain(keyRequest(URL_A, CANONICAL_TURTLE_VARY_KEY).url);
  });
});
