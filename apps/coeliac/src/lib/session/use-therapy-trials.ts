// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Fetch the LIVE recruiting trials for the named therapy candidates (§4.4), so the
 * therapies page's "recruiting now" half stays current while its framing stays
 * static + human-reviewed. Best-effort + non-blocking: the static catalog is the
 * source of truth; a fetch failure just leaves the live section empty.
 *
 * Only the public candidate NAME (a curated constant, never user data) leaves the
 * device, through the closed knowledge allowlist.
 */
"use client";
import { useEffect, useState } from "react";
import { knowledgeFetch, knowledgeJson } from "../knowledge/fetch.js";
import { recruitingTherapies } from "../knowledge/therapies.js";
import { buildCtgovSearchUrl, parseCtgovResponse, type TrialStudy } from "../knowledge/trials.js";
import { useSession } from "./context.js";

/** term → its live recruiting studies (empty until/if the fetch resolves). */
export type TherapyTrials = Record<string, TrialStudy[]>;

export function useTherapyTrials(): { byTerm: TherapyTrials; loading: boolean } {
  const { publicFetch } = useSession();
  const [byTerm, setByTerm] = useState<TherapyTrials>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const kf = knowledgeFetch(publicFetch);
      const out: TherapyTrials = {};
      for (const t of recruitingTherapies()) {
        if (!t.ctgovTerm) continue;
        try {
          const body = await knowledgeJson(kf, buildCtgovSearchUrl({ term: t.ctgovTerm, pageSize: 10 }), {
            simple: true,
          });
          out[t.ctgovTerm] = [...parseCtgovResponse(body).studies];
        } catch {
          out[t.ctgovTerm] = [];
        }
      }
      if (!cancelled) {
        setByTerm(out);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicFetch]);

  return { byTerm, loading };
}
