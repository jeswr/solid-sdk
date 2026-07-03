// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Load RECRUITING coeliac trials for the Trials view (Phase 3b §4). Offline-first:
 * paint from the pod JSON cache, then refresh from ClinicalTrials.gov v2 through
 * the closed allowlist (simple GET — no preflight) and re-cache.
 *
 * The country filter is a where-is-it convenience only — it NEVER judges
 * eligibility. Default filter = the browser locale's CT.gov country NAME, with an
 * "all countries" option. No pod health/genetic data is read into any of this.
 */
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { knowledgeFetch } from "../knowledge/fetch.js";
import { isStale, readKnowledgeCache, writeKnowledgeCache } from "../knowledge/cache.js";
import { countryNameForLocale, fetchAllRecruitingTrials, filterTrialsByCountry, type TrialStudy } from "../knowledge/trials.js";
import { useSession } from "./context.js";

const CACHE_SLUG = "trials-latest";

export interface TrialsViewState {
  /** Studies after the country filter. */
  studies: TrialStudy[];
  /** All fetched studies (unfiltered) — for the "all countries" count. */
  allStudies: TrialStudy[];
  loading: boolean;
  error: string | null;
  fromCache: boolean;
  /** The active country-name filter, or null for "all countries". */
  countryName: string | null;
  setCountryName: (name: string | null) => void;
  /** The distinct country names present across the fetched studies (for the filter UI). */
  availableCountries: string[];
  refresh: () => Promise<void>;
}

function browserLocale(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.language;
}

export function useTrials(): TrialsViewState {
  const { publicFetch, authedFetch, storageRoot, webId } = useSession();
  const [all, setAll] = useState<TrialStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [countryName, setCountryName] = useState<string | null>(
    () => countryNameForLocale(browserLocale()) ?? null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    let cached: TrialStudy[] | undefined;
    let cacheFresh = false;
    if (storageRoot) {
      const env = await readKnowledgeCache<TrialStudy[]>(authedFetch, storageRoot, CACHE_SLUG);
      cached = Array.isArray(env?.data) ? env?.data : undefined;
      cacheFresh = !!env && !isStale(env, new Date());
      if (cached) {
        setAll(cached);
        setFromCache(true);
      }
    }

    // Fresh cache (<24h) — don't re-hit the registry every visit.
    if (cached && cacheFresh) {
      setLoading(false);
      return;
    }

    try {
      const kf = knowledgeFetch(publicFetch);
      // Follow nextPageToken so the client-side country filter sees the FULL set.
      const studies = await fetchAllRecruitingTrials(kf, { pageSize: 40, maxPages: 5 });
      setAll(studies);
      setFromCache(false);
      setError(null);
      if (storageRoot && webId) {
        void writeKnowledgeCache(authedFetch, storageRoot, webId, CACHE_SLUG, studies);
      }
    } catch (err) {
      if (!cached) setError(`Couldn't reach the trials registry (${(err as Error).message}).`);
    } finally {
      setLoading(false);
    }
  }, [publicFetch, authedFetch, storageRoot, webId]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableCountries = useMemo(() => {
    const set = new Set<string>();
    for (const s of all) for (const l of s.locations) if (l.country) set.add(l.country);
    return [...set].sort();
  }, [all]);

  const studies = useMemo(() => filterTrialsByCountry(all, countryName), [all, countryName]);

  return {
    studies,
    allStudies: all,
    loading,
    error,
    fromCache,
    countryName,
    setCountryName,
    availableCountries,
    refresh: load,
  };
}
