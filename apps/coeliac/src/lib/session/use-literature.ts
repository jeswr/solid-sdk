// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * Load + rank the latest credible coeliac literature for the Research view
 * (Phase 3a §3). Offline-first: paint from the pod JSON cache immediately, then
 * refresh from Europe PMC through the closed knowledge allowlist and re-cache.
 *
 * PRIVACY: the external query is the GENERIC coeliac term — the user's tracked
 * triggers are used ONLY to re-rank the already-fetched public results ON-DEVICE
 * (`rankLiterature`), so no health interest ever leaves the device.
 */
import { useCallback, useEffect, useState } from "react";
import { knowledgeFetch, knowledgeJson } from "../knowledge/fetch";
import {
  buildEpmcSearchUrl,
  type EpmcResult,
  fetchPubmedFallback,
  parseEpmcResponse,
  type RankedLiterature,
  rankLiterature,
} from "../knowledge/literature";
import { isStale, readKnowledgeCache, writeKnowledgeCache } from "../knowledge/cache";
import { GENERIC_COELIAC_CONDITION } from "../knowledge/terms";
import { trackedTriggers } from "../knowledge/tracked";
import { useSession } from "./context";

const CACHE_SLUG = "research-latest";

interface LiteraturePayload {
  hitCount: number;
  results: EpmcResult[];
}

export interface LiteratureState {
  ranked: RankedLiterature[];
  hitCount: number;
  loading: boolean;
  /** A user-facing error (only when there is nothing to show at all). */
  error: string | null;
  /** True when the shown results came from the offline cache (upstream unavailable). */
  fromCache: boolean;
  refresh: () => Promise<void>;
}

export function useLiterature(): LiteratureState {
  const { publicFetch, authedFetch, storageRoot, webId, store } = useSession();
  const [state, setState] = useState<Omit<LiteratureState, "refresh">>({
    ranked: [],
    hitCount: 0,
    loading: true,
    error: null,
    fromCache: false,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const triggers = await trackedTriggers(store);

    // 1) Offline-first: paint from the pod cache if present.
    let cached: LiteraturePayload | undefined;
    let cacheFresh = false;
    if (storageRoot) {
      const env = await readKnowledgeCache<LiteraturePayload>(authedFetch, storageRoot, CACHE_SLUG);
      cached = env?.data;
      cacheFresh = !!env && !isStale(env, new Date());
      if (cached) {
        setState({
          ranked: rankLiterature(cached.results, { trackedTriggers: triggers }),
          hitCount: cached.hitCount,
          loading: !cacheFresh,
          error: null,
          fromCache: true,
        });
      }
    }

    // If the cache is still fresh (<24h), don't re-hit the API on every visit.
    if (cached && cacheFresh) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    // 2) Refresh from Europe PMC through the closed allowlist.
    const kf = knowledgeFetch(publicFetch);
    try {
      const body = await knowledgeJson(kf, buildEpmcSearchUrl({ pageSize: 30 }));
      const parsed = parseEpmcResponse(body);
      const payload: LiteraturePayload = { hitCount: parsed.hitCount, results: [...parsed.results] };
      setState({
        ranked: rankLiterature(parsed.results, { trackedTriggers: triggers }),
        hitCount: parsed.hitCount,
        loading: false,
        error: null,
        fromCache: false,
      });
      if (storageRoot && webId) {
        void writeKnowledgeCache(authedFetch, storageRoot, webId, CACHE_SLUG, payload);
      }
      return;
    } catch (epmcErr) {
      // 3) EPMC down — try the PubMed fallback before surfacing an error.
      try {
        const results = await fetchPubmedFallback(kf, GENERIC_COELIAC_CONDITION, 30);
        if (results.length > 0) {
          setState({
            ranked: rankLiterature(results, { trackedTriggers: triggers }),
            hitCount: results.length,
            loading: false,
            error: null,
            fromCache: false,
          });
          if (storageRoot && webId) {
            void writeKnowledgeCache(authedFetch, storageRoot, webId, CACHE_SLUG, {
              hitCount: results.length,
              results,
            });
          }
          return;
        }
      } catch {
        // fall through to the error/keep-cache path
      }
      // Keep the cached view if we have one; only surface an error if we have nothing.
      setState((s) => ({
        ...s,
        loading: false,
        error: cached ? null : `Couldn't reach the research index (${(epmcErr as Error).message}).`,
      }));
    }
  }, [publicFetch, authedFetch, storageRoot, webId, store]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, refresh: load };
}
