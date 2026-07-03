// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * Read the home-screen lists from the durable client cache (UX invariant #3 —
 * instant paint, never a blank load). Recent + frequent meals power the one-tap
 * re-log chips; the pending count surfaces un-synced offline writes. Reads are
 * cache-only (no network), so the home screen paints synchronously from IndexedDB.
 */
import { useCallback, useEffect, useState } from "react";
import type { FrequentMeal, StoredMeal, StoredSymptom } from "../cache/diary-store.js";
import { useSession } from "./context.js";

export interface DiaryLists {
  recent: StoredMeal[];
  frequent: FrequentMeal[];
  symptoms: StoredSymptom[];
  pending: number;
  loaded: boolean;
  refresh: () => Promise<void>;
}

export function useDiaryLists(): DiaryLists {
  const { store } = useSession();
  const [state, setState] = useState<Omit<DiaryLists, "refresh">>({
    recent: [],
    frequent: [],
    symptoms: [],
    pending: 0,
    loaded: false,
  });

  const refresh = useCallback(async () => {
    if (!store) {
      setState((s) => ({ ...s, loaded: true }));
      return;
    }
    const [recent, frequent, pending, symptoms] = await Promise.all([
      store.recentMeals(),
      store.frequentMeals(),
      store.pending(),
      store.allSymptoms(),
    ]);
    setState({
      recent,
      frequent,
      symptoms: symptoms.slice(0, 10),
      pending: pending.meals.length + pending.symptoms.length,
      loaded: true,
    });
  }, [store]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
