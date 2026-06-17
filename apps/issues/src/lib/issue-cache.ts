// AUTHORED-BY Claude Opus 4.8
/**
 * issue-cache.ts — a durable, per-tracker client cache of the last-fetched
 * issues, so reopening the app paints the board INSTANTLY from cache and then
 * revalidates in the background (stale-while-revalidate). Fixes the cold-open
 * load delay (pss-tvds): a blank "Loading…" board when data was already known.
 *
 * It is deliberately SYNCHRONOUS (localStorage), because the value here is a
 * first-paint that needs no await — the React state can be seeded from the
 * cache during the initial render, before any effect runs. Issue lists are
 * small render-snapshots (IssueRecord), so localStorage's size budget is ample;
 * a larger payload would move to IndexedDB, at the cost of an async hydrate.
 *
 * The suite's eventual home for offline read-through caching is the
 * `solid-offline` service-worker layer (it intercepts the pod fetches and serves
 * cached bytes directly); this app-level snapshot cache is the interim measure
 * until that layer is wired in here. See `jeswr/solid-offline`.
 *
 * Security/correctness notes:
 *  - Scoped per (WebID, tracker URL): a snapshot is keyed AND stamped with the
 *    WebID that fetched it, and is only ever painted back for that same
 *    authenticated WebID. Issue data a tracker exposes can differ per viewer
 *    (private trackers, per-member ACLs), so a snapshot cached by one signed-in
 *    user must never paint for a different later user on the same browser before
 *    authorization revalidates. A missing or mismatched WebID is a cache MISS
 *    (no hydrate) — never a hydrate of someone else's data.
 *  - Best-effort only: any read/parse/quota error degrades to "no cache" (a
 *    normal network fetch), never an exception that blocks the app.
 *  - Cleared on both logout AND account switch (see clearAllIssueCaches), so a
 *    signed-out / switched device leaves no prior user's issue snapshots behind.
 */
import type { IssueRecord } from "./repository";

const PREFIX = "solid-issues:cache:";
/**
 * Cache schema version — bump to invalidate all entries on a shape change.
 * Bumped to 2 when the cache became WebID-scoped (the key + envelope gained the
 * WebID): v1 entries (no WebID) are now unreadable, so they cannot leak.
 * Bumped to 3 when `IssueRecord` gained the required `components` array (+ the
 * optional affects/fix-version fields): a pre-v3 snapshot has no `components`,
 * so reviving it would yield `components === undefined` and crash the facets /
 * filter / detail code paths that call `.forEach`/`.some`/`.map` on it. The
 * version bump makes those entries a clean miss; `reviveIssue` below also
 * defaults the array on read as defence-in-depth.
 */
const VERSION = 3;
/** Don't paint from a cache older than this (ms) — a week. Stale data still
 *  revalidates; this only bounds how old a first-paint may be. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEnvelope {
  v: number;
  /** When the snapshot was written (epoch ms). */
  at: number;
  /** The WebID that fetched these issues — only this identity may paint them. */
  webId: string;
  /** The tracker the issues belong to (defence-in-depth against key collisions). */
  tracker: string;
  issues: IssueRecord[];
}

/** Minimal synchronous KV contract (localStorage matches it); injectable for tests. */
export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

function defaultStorage(): SyncStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // SSR / privacy mode without localStorage
  }
}

/**
 * The storage key for a (WebID, tracker) snapshot. The WebID is part of the key
 * so two users on the same browser never share a slot — defence in depth on top
 * of the in-envelope WebID check. The separator is a NUL byte, which cannot
 * appear in a URL, so a crafted WebID/tracker can't forge another pair's key.
 */
const keyFor = (webId: string, trackerUrl: string) => `${PREFIX}${webId}\u0000${trackerUrl}`;

/** ISO-8601 datetime (what JSON.stringify emits for a Date) — for revival on read. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Revive the Date-typed fields of an IssueRecord that JSON flattened to strings. */
function reviveValue(value: unknown): unknown {
  if (typeof value === "string" && ISO_DATE.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d;
  }
  return value;
}

/**
 * Backfill the required array fields of a revived record. JSON drops nothing on
 * a forward-compatible read, but a record written by an older shape (or a partial
 * write) can be missing `components` — default it to [] so downstream
 * `.forEach`/`.some`/`.map` never throws. (The other required arrays —
 * blockedBy/relatesTo/attachments/comments/worklog — predate the cache and are
 * always present, but defaulting `components` here is the one this guards.)
 */
function normalizeIssue(issue: IssueRecord): IssueRecord {
  return Array.isArray(issue.components) ? issue : { ...issue, components: [] };
}

/**
 * Read the cached issues for a (WebID, tracker) pair, or null when there is no
 * usable cache (absent, wrong version, WebID/tracker mismatch, too old, or
 * unparseable). A missing or mismatched WebID is treated as a MISS — a snapshot
 * is only ever painted back for the SAME authenticated WebID that fetched it, so
 * one user's private issue data can never paint for a different later user on the
 * same browser. Dates are revived.
 */
export function readIssueCache(
  webId: string | null | undefined,
  trackerUrl: string,
  storage: SyncStorage | null = defaultStorage(),
  now: number = Date.now(),
): IssueRecord[] | null {
  // No authenticated identity ⇒ nothing to match against ⇒ cache miss (no hydrate).
  if (!storage || !trackerUrl || !webId) return null;
  try {
    const raw = storage.getItem(keyFor(webId, trackerUrl));
    if (!raw) return null;
    const env = JSON.parse(raw, (_k, v) => reviveValue(v)) as CacheEnvelope;
    // Version, WebID, AND tracker must all match the current identity/tracker.
    if (env.v !== VERSION || env.webId !== webId || env.tracker !== trackerUrl) return null;
    if (!Array.isArray(env.issues)) return null;
    if (now - env.at > MAX_AGE_MS) return null;
    // Defence-in-depth: the version gate already excludes pre-v3 snapshots that
    // lacked `components`, but guarantee every required array field is present so
    // a partially-written/forward-incompatible envelope can never crash the
    // facets/filter/detail code that calls `.forEach`/`.some`/`.map` on it.
    return env.issues.map(normalizeIssue);
  } catch {
    return null; // corrupt entry is not a blocker — just fetch fresh
  }
}

/**
 * Persist the latest issues for a (WebID, tracker) pair (best-effort; quota
 * errors swallowed). Without a WebID there is nothing to scope the snapshot to,
 * so the write is skipped (the data would be unreadable anyway).
 */
export function writeIssueCache(
  webId: string | null | undefined,
  trackerUrl: string,
  issues: IssueRecord[],
  storage: SyncStorage | null = defaultStorage(),
  now: number = Date.now(),
): void {
  if (!storage || !trackerUrl || !webId) return;
  const env: CacheEnvelope = { v: VERSION, at: now, webId, tracker: trackerUrl, issues };
  try {
    storage.setItem(keyFor(webId, trackerUrl), JSON.stringify(env));
  } catch {
    // Quota/serialisation failure — the cache is an optimisation, never required.
  }
}

/** Remove one (WebID, tracker) cache entry. */
export function clearIssueCache(
  webId: string | null | undefined,
  trackerUrl: string,
  storage: SyncStorage | null = defaultStorage(),
): void {
  if (!storage || !trackerUrl || !webId) return;
  try {
    storage.removeItem(keyFor(webId, trackerUrl));
  } catch {
    /* best-effort */
  }
}

/**
 * Remove every issue-cache entry (all WebIDs, all trackers). Called on logout
 * AND on account switch, so a signed-out / switched device leaves no prior
 * user's issue snapshots behind, regardless of which trackers were open.
 */
export function clearAllIssueCaches(storage: SyncStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch {
    /* best-effort */
  }
}
