// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * WebID cache scoping (§7) — the single source of truth for namespacing every
 * persistent store by identity.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * §7 CACHE SCOPING — a different WebID must never read another's cache:
 *   Both persistent stores are namespaced by a short, stable hash of the WebID:
 *     - the IndexedDB metadata DB  → `solid-offline:<webId-hash>`
 *     - the Cache API bytes cache  → `solid-offline-cache:<webId-hash>`
 *   The hash is only a *namespacing discriminator*, not a security boundary: the
 *   real boundary is the browser's origin isolation. Scoping by identity on top
 *   of that means logout-purge can drop exactly one identity's stores, and two
 *   identities sharing a device/origin never observe each other's cached bytes
 *   or metadata.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Keeping the hash + the name prefixes here (rather than duplicated in
 * metadata-store.ts and worker.ts) guarantees the page client and the service
 * worker agree on exactly which DB/Cache a given WebID maps to — which is what
 * makes the WebID-scoped read path and the logout-purge align.
 */

/** Prefix for the IndexedDB metadata DB name. */
export const DB_PREFIX = 'solid-offline:';
/** Prefix for the Cache API cache name. */
export const CACHE_PREFIX = 'solid-offline-cache:';

/** The discriminator used for anonymous (no-WebID) reads. */
export const ANONYMOUS_SCOPE = 'anonymous';

/** Default (un-scoped) DB name when no WebID is supplied (e.g. anonymous reads). */
export const DEFAULT_DB_NAME = `${DB_PREFIX}${ANONYMOUS_SCOPE}`;
/** Default (un-scoped) Cache name when no WebID is supplied. */
export const DEFAULT_CACHE_NAME = `${CACHE_PREFIX}${ANONYMOUS_SCOPE}`;

/**
 * Short, stable, NON-cryptographic hash of a WebID (FNV-1a 32-bit). Deterministic
 * and dependency-free; collision-tolerant for this use. NOT a security primitive
 * — see the module note: origin isolation is the boundary, this is namespacing.
 */
export function scopeHash(webId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < webId.length; i++) {
    h ^= webId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The per-identity scope discriminator (`anonymous` or the WebID hash). */
export function scopeFor(webId: string | undefined): string {
  return webId ? scopeHash(webId) : ANONYMOUS_SCOPE;
}

/** The per-identity IndexedDB metadata DB name (`solid-offline:<hash>`). */
export function dbNameForWebId(webId: string | undefined): string {
  return `${DB_PREFIX}${scopeFor(webId)}`;
}

/** The per-identity Cache API cache name (`solid-offline-cache:<hash>`). */
export function cacheNameForWebId(webId: string | undefined): string {
  return `${CACHE_PREFIX}${scopeFor(webId)}`;
}
