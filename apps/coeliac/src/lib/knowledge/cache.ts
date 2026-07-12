// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Pod cache for the knowledge integrations (§3.5). Caches ONLY the PUBLIC
 * result-list JSON (never any health data) under
 * `…/health/diary/cache/knowledge/{slug}.json`, so the Research/Trials views paint
 * instantly + work offline (UX invariant #3) and the app does not re-hit the
 * upstream APIs on every visit.
 *
 * The cache lives under the diary root, so the owner-only, fail-closed ACL written
 * FIRST by `ensureDiaryReady` already protects it (the "ACL written first"
 * invariant). Best-effort throughout: a cache read/write failure never blocks a
 * fetch or a render.
 */
import { knowledgeCacheUrl } from "../pod/layout";
import { ensureDiaryReady, putResource } from "../pod/pod-fs";

/** A dated cache envelope: when it was fetched + the public payload. */
export interface KnowledgeCacheEnvelope<T> {
  readonly fetchedAt: string;
  readonly data: T;
}

/** Default staleness window: refresh after ~24h (§3.5). */
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Whether a cache envelope is older than `maxAgeMs` (or has an unparseable date ⇒ stale). */
export function isStale(envelope: { fetchedAt: string }, now: Date, maxAgeMs = DEFAULT_MAX_AGE_MS): boolean {
  const t = Date.parse(envelope.fetchedAt);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > maxAgeMs;
}

/**
 * Read a cached public JSON payload from the pod, or `undefined` if absent /
 * unreadable / malformed. Never throws.
 */
export async function readKnowledgeCache<T>(
  authedFetch: typeof globalThis.fetch,
  storageRoot: string,
  slug: string,
): Promise<KnowledgeCacheEnvelope<T> | undefined> {
  try {
    const url = knowledgeCacheUrl(storageRoot, slug);
    const res = await authedFetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return undefined;
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== "object") return undefined;
    const env = body as Record<string, unknown>;
    if (typeof env.fetchedAt !== "string" || !("data" in env)) return undefined;
    return { fetchedAt: env.fetchedAt, data: env.data as T };
  } catch {
    return undefined;
  }
}

/**
 * Write a public JSON payload to the pod cache (best-effort; swallows errors).
 * Ensures the diary root's owner-only ACL is in place FIRST (memoised, cheap) so a
 * fast scan right after login cannot race ahead of provisioning and write an
 * unprotected resource. Only ever writes PUBLIC data — never health/genetic data.
 */
export async function writeKnowledgeCache<T>(
  authedFetch: typeof globalThis.fetch,
  storageRoot: string,
  ownerWebId: string,
  slug: string,
  data: T,
  now: Date = new Date(),
): Promise<void> {
  try {
    await ensureDiaryReady(authedFetch, storageRoot, ownerWebId);
    const url = knowledgeCacheUrl(storageRoot, slug);
    const envelope: KnowledgeCacheEnvelope<T> = { fetchedAt: now.toISOString(), data };
    await putResource(authedFetch, url, JSON.stringify(envelope), "application/json");
  } catch {
    // caching is a nicety — never break the flow
  }
}
