// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * MANDATORY LOGOUT-PURGE (§7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * §7: "Logout → mandatory purge of Cache API + IndexedDB for that WebID
 * (parallels the existing credential wipe on sign-out)."
 *
 *   When the user signs out we MUST remove every byte and every metadata record
 *   the offline layer cached for that identity, so nothing the now-departed user
 *   read is recoverable by the next user of the same browser/origin. Because both
 *   stores are namespaced by the WebID hash (`scope.ts`), purge is exact: we drop
 *   precisely one Cache API cache and one IndexedDB database, leaving other
 *   identities' caches (and the anonymous cache) untouched.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Written against the injectable platform surfaces (a `CacheStorage`-like
 * `caches` and an `IDBFactory`) so it is fully unit-testable headlessly
 * (fake-indexeddb + an in-memory caches stub) — no real browser.
 *
 * Purge is best-effort but TOTAL: a failure deleting one store does not stop the
 * other, and a missing store is a success (nothing to purge). The function never
 * throws for "store absent"; it only rejects if the underlying platform call
 * itself fails irrecoverably (e.g. a blocked DB deletion), and even then it
 * reports which half succeeded so the caller can decide.
 */

import { cacheNameForWebId, dbNameForWebId } from './scope.js';

/** Minimal `CacheStorage` surface we need to purge the bytes cache. */
export interface CacheStorageLike {
  delete(cacheName: string): Promise<boolean>;
}

/** What a purge actually did, for tests + observability. */
export interface PurgeResult {
  /** The WebID-scoped Cache API cache name we targeted. */
  cacheName: string;
  /** The WebID-scoped IndexedDB database name we targeted. */
  dbName: string;
  /** True if the Cache API cache existed and was deleted. */
  cacheDeleted: boolean;
  /**
   * True ONLY once the IndexedDB `deleteDatabase` request fired `onsuccess` (#5).
   * A `blocked` deletion does NOT set this — see {@link dbBlocked}.
   */
  dbDeleted: boolean;
  /**
   * True if the IndexedDB deletion was BLOCKED by another open connection
   * (another tab / a live SW handle still holds the DB open). The deletion is
   * queued and will complete once those connections close, but at the moment
   * logout returns the metadata is NOT yet gone — callers MUST surface this and
   * coordinate closing other handles rather than assume the purge is complete.
   */
  dbBlocked: boolean;
  /** Any error encountered (purge is best-effort; this surfaces the cause). */
  errors: unknown[];
}

export interface PurgeDeps {
  /** Injectable `CacheStorage` (tests). Falls back to the global `caches`. */
  caches?: CacheStorageLike;
  /** Injectable `IDBFactory` (tests inject fake-indexeddb). Falls back to global `indexedDB`. */
  indexedDB?: IDBFactory;
}

function resolveCaches(deps: PurgeDeps): CacheStorageLike | undefined {
  if (deps.caches) return deps.caches;
  if (typeof caches !== 'undefined') return caches as unknown as CacheStorageLike;
  return undefined;
}

function resolveIdb(deps: PurgeDeps): IDBFactory | undefined {
  return deps.indexedDB ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
}

/** Outcome of an IndexedDB `deleteDatabase` request. */
type DeleteDbOutcome = 'deleted' | 'blocked';

/**
 * Delete an IndexedDB database.
 *
 * Resolves `'deleted'` ONLY on `onsuccess` (the DB is actually gone, whether or
 * not it existed). Resolves `'blocked'` when `onblocked` fires — another open
 * connection (a second tab, or a live SW metadata handle) is preventing the
 * deletion. We do NOT hang on `blocked` (logout must stay responsive and the
 * deletion is queued to complete once connections close), but we report it
 * distinctly (#5) so the caller does not falsely claim the metadata was purged.
 */
function deleteDatabase(factory: IDBFactory, name: string): Promise<DeleteDbOutcome> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.deleteDatabase(name);
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    req.onsuccess = () => {
      if (settled) return;
      settled = true;
      resolve('deleted');
    };
    req.onerror = () => {
      if (settled) return;
      settled = true;
      reject(req.error);
    };
    req.onblocked = () => {
      // The deletion is queued; report blocked WITHOUT claiming success. If the
      // blocker later closes, `onsuccess` may still fire, but `settled` guards
      // against a double-resolve.
      if (settled) return;
      settled = true;
      resolve('blocked');
    };
  });
}

/**
 * Purge BOTH stores (Cache API bytes + IndexedDB metadata) for a single WebID.
 * Anonymous (`webId` undefined) purges the anonymous scope. Best-effort and
 * total: it always attempts both halves and reports the outcome.
 */
export async function purgeForWebId(
  webId: string | undefined,
  deps: PurgeDeps = {},
): Promise<PurgeResult> {
  const cacheName = cacheNameForWebId(webId);
  const dbName = dbNameForWebId(webId);
  const result: PurgeResult = {
    cacheName,
    dbName,
    cacheDeleted: false,
    dbDeleted: false,
    dbBlocked: false,
    errors: [],
  };

  const cacheStore = resolveCaches(deps);
  if (cacheStore) {
    try {
      result.cacheDeleted = await cacheStore.delete(cacheName);
    } catch (error) {
      result.errors.push(error);
    }
  }

  const idb = resolveIdb(deps);
  if (idb) {
    try {
      const outcome = await deleteDatabase(idb, dbName);
      if (outcome === 'deleted') {
        result.dbDeleted = true;
      } else {
        // 'blocked' — queued but NOT yet purged. Surface it; don't claim success.
        result.dbBlocked = true;
      }
    } catch (error) {
      result.errors.push(error);
    }
  }

  return result;
}
