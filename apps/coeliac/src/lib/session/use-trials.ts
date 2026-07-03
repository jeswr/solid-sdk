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
import { knowledgeFetch, knowledgeJson } from "../knowledge/fetch.js";
import { readKnowledgeCache, writeKnowledgeCache } from "../knowledge/cache.js";
import {
  buildCtgovSearchUrl,
  countryNameForLocale,
  filterTrialsByCountry,
  parseCtgovResponse,
  type TrialStudy,
} from "../knowledge/trials.js";
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
    if (storageRoot) {
      const env = await readKnowledgeCache<TrialStudy[]>(authedFetch, storageRoot, CACHE_SLUG);
      cached = env?.data;
      if (cached && Array.isArray(cached)) {
        setAll(cached);
        setFromCache(true);
      }
    }

    try {
      const kf = knowledgeFetch(publicFetch);
      const body = await knowledgeJson(kf, buildCtgovSearchUrl({ pageSize: 40 }), { simple: true });
      const parsed = parseCtgovResponse(body);
      setAll([...parsed.studies]);
      setFromCache(false);
      setError(null);
      if (storageRoot && webId) {
        void writeKnowledgeCache(authedFetch, storageRoot, webId, CACHE_SLUG, [...parsed.studies]);
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
