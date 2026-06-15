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
 *  - Scoped per tracker URL: one tracker's cache can never paint under another.
 *  - Best-effort only: any read/parse/quota error degrades to "no cache" (a
 *    normal network fetch), never an exception that blocks the app.
 *  - This is a cache of data the user could already read; it is NOT an auth
 *    artefact, so it does not need the IndexedDB/WebID-scoping the session
 *    refresh-token store uses. It is cleared on logout regardless (see clearAll).
 */
import type { IssueRecord } from "./repository";

const PREFIX = "solid-issues:cache:";
/** Cache schema version — bump to invalidate all entries on a shape change. */
const VERSION = 1;
/** Don't paint from a cache older than this (ms) — a week. Stale data still
 *  revalidates; this only bounds how old a first-paint may be. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEnvelope {
  v: number;
  /** When the snapshot was written (epoch ms). */
  at: number;
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

const keyFor = (trackerUrl: string) => `${PREFIX}${trackerUrl}`;

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
 * Read the cached issues for a tracker, or null when there is no usable cache
 * (absent, wrong version/tracker, too old, or unparseable). Dates are revived.
 */
export function readIssueCache(
  trackerUrl: string,
  storage: SyncStorage | null = defaultStorage(),
  now: number = Date.now(),
): IssueRecord[] | null {
  if (!storage || !trackerUrl) return null;
  try {
    const raw = storage.getItem(keyFor(trackerUrl));
    if (!raw) return null;
    const env = JSON.parse(raw, (_k, v) => reviveValue(v)) as CacheEnvelope;
    if (env.v !== VERSION || env.tracker !== trackerUrl) return null;
    if (!Array.isArray(env.issues)) return null;
    if (now - env.at > MAX_AGE_MS) return null;
    return env.issues;
  } catch {
    return null; // corrupt entry is not a blocker — just fetch fresh
  }
}

/** Persist the latest issues for a tracker (best-effort; quota errors swallowed). */
export function writeIssueCache(
  trackerUrl: string,
  issues: IssueRecord[],
  storage: SyncStorage | null = defaultStorage(),
  now: number = Date.now(),
): void {
  if (!storage || !trackerUrl) return;
  const env: CacheEnvelope = { v: VERSION, at: now, tracker: trackerUrl, issues };
  try {
    storage.setItem(keyFor(trackerUrl), JSON.stringify(env));
  } catch {
    // Quota/serialisation failure — the cache is an optimisation, never required.
  }
}

/** Remove one tracker's cache entry. */
export function clearIssueCache(trackerUrl: string, storage: SyncStorage | null = defaultStorage()): void {
  if (!storage || !trackerUrl) return;
  try {
    storage.removeItem(keyFor(trackerUrl));
  } catch {
    /* best-effort */
  }
}

/**
 * Remove every issue-cache entry (all trackers). Called on logout so a signed-out
 * device leaves no issue snapshots behind, regardless of which trackers were open.
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
