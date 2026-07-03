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
import { knowledgeFetch } from "../knowledge/fetch.js";
import {
  buildEpmcSearchUrl,
  type EpmcResult,
  parseEpmcResponse,
  type RankedLiterature,
  rankLiterature,
} from "../knowledge/literature.js";
import { knowledgeJson } from "../knowledge/fetch.js";
import { readKnowledgeCache, writeKnowledgeCache } from "../knowledge/cache.js";
import { trackedTriggers } from "../knowledge/tracked.js";
import { useSession } from "./context.js";

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
    if (storageRoot) {
      const env = await readKnowledgeCache<LiteraturePayload>(authedFetch, storageRoot, CACHE_SLUG);
      cached = env?.data;
      if (cached) {
        setState({
          ranked: rankLiterature(cached.results, { trackedTriggers: triggers }),
          hitCount: cached.hitCount,
          loading: true,
          error: null,
          fromCache: true,
        });
      }
    }

    // 2) Refresh from Europe PMC through the closed allowlist.
    try {
      const kf = knowledgeFetch(publicFetch);
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
    } catch (err) {
      // Keep the cached view if we have one; only surface an error if we have nothing.
      setState((s) => ({
        ...s,
        loading: false,
        error: cached ? null : `Couldn't reach the research index (${(err as Error).message}).`,
      }));
    }
  }, [publicFetch, authedFetch, storageRoot, webId, store]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, refresh: load };
}
