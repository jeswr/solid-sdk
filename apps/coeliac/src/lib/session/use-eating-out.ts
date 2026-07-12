// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * Cache-only signal for the Phase-4A eating-out surfacing (design §3.2): has the
 * user EVER logged a meal with `diet:context = restaurant`? Reads the durable
 * diary cache via {@link DiaryStore.hasMealContext} — a FULL-cache scan, not the
 * capped/deduped `recentMeals()`, so an eating-out signal is never lost to the
 * recent window or a signature collision (roborev Medium, fixed). Returns only a
 * boolean; no meal detail is read into the view.
 */
import { useEffect, useState } from "react";
import { useSession } from "./context";

export interface EatingOutSignal {
  /** True once at least one restaurant-context meal is in the cache. */
  ateOut: boolean;
  /** True once the cache read has settled (so the caller can avoid a flash). */
  loaded: boolean;
}

export function useHasEatenOut(): EatingOutSignal {
  const { store } = useSession();
  const [state, setState] = useState<EatingOutSignal>({ ateOut: false, loaded: false });

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!store) {
        if (alive) setState({ ateOut: false, loaded: true });
        return;
      }
      const ateOut = await store.hasMealContext("restaurant");
      if (alive) setState({ ateOut, loaded: true });
    })();
    return () => {
      alive = false;
    };
  }, [store]);

  return state;
}
