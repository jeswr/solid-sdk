// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * Run the pure inference engine ({@link analyze}) over the account's cached diary
 * (all meals + symptoms) and expose the result to the Insights view. Reads are
 * cache-only (no network), so Insights paints from IndexedDB and works fully offline
 * (UX invariant #3) — the engine is a pure function, so there is no I/O of its own.
 *
 * SAFETY: the engine's own hard rails are respected by construction — emergency
 * symptoms are excluded from correlation and surface only as a {@link SafetyRail};
 * correlation only ever PROPOSES (no `confirmed`); the pre-diagnosis gluten block and
 * orthorexia/expansion bias live inside `analyze`. This hook adds no inference of its
 * own — it only feeds cached records in and hands the typed result out.
 *
 * PER-USER LAG PROFILES (the Insights richer-UI data-flow fix, suite-tracker-ov8g
 * deliverable 5): every refresh ALSO reads back any locally-learned trigger lag
 * profiles ({@link import("../cache/diary-store").StoredTriggerClass}) from the
 * cache and feeds them into `diary.triggerClasses`, so `resolveLag` uses the
 * user's OWN observed lag window instead of the model's evidence prior once
 * enough evidence exists. After each analysis, any newly-eligible profiles
 * (`learnTriggerClasses`) are persisted back — best-effort, fire-and-forget, never
 * blocking the paint and never surfacing an error (a failed persist just means the
 * next run learns again from the same underlying diary). Nothing here leaves the
 * device: no network call is made, only the existing local cache.
 */
import { useCallback, useEffect, useState } from "react";
import { analyze, type AnalysisResult } from "../inference/analyze";
import { diaryDataFromCache, triggerClassDataToStored } from "../inference/from-cache";
import { learnTriggerClasses } from "../inference/learn-lag-profile";
import type { SafetyContext } from "../inference/types";
import { useSession } from "./context";

/** Stable default context identity so the effect does not re-fire every render. */
const EMPTY_CONTEXT: SafetyContext = {};

export interface InsightsState {
  result: AnalysisResult | null;
  /** How many diary records the analysis ran over (0 ⇒ empty-state). */
  mealCount: number;
  symptomCount: number;
  loaded: boolean;
  refresh: () => Promise<void>;
}

/**
 * Analyse the cached diary. `context` carries safety signals the diary model cannot
 * itself represent (confirmed-coeliac flag, alarm-symptom checklist, adherence) —
 * defaults to `{}` (NOT diagnosed ⇒ the pre-diagnosis gluten block stays armed).
 */
export function useInsights(context: SafetyContext = EMPTY_CONTEXT): InsightsState {
  const { store } = useSession();
  const [state, setState] = useState<Omit<InsightsState, "refresh">>({
    result: null,
    mealCount: 0,
    symptomCount: 0,
    loaded: false,
  });

  const refresh = useCallback(async () => {
    if (!store) {
      setState({ result: null, mealCount: 0, symptomCount: 0, loaded: true });
      return;
    }
    const [meals, symptoms, protocols, conclusions, triggerClasses] = await Promise.all([
      store.allMeals(),
      store.allSymptoms(),
      store.allProtocols(),
      store.allConclusions(),
      store.allTriggerClasses(),
    ]);
    const diary = diaryDataFromCache(meals, symptoms, protocols, conclusions, triggerClasses);
    const result = analyze(diary, context);
    setState({
      result,
      mealCount: diary.meals.length,
      symptomCount: diary.symptoms.length,
      loaded: true,
    });

    // Best-effort: persist any freshly-eligible per-user lag profiles for the NEXT
    // run to read back (see module docs). Never awaited — must not delay the paint
    // — and a rejection is swallowed (cache-only, non-critical refinement).
    for (const learned of learnTriggerClasses(result.suspicions)) {
      void store
        .putTriggerClass(triggerClassDataToStored(learned.data, learned.sampleSize))
        .catch(() => {});
    }
  }, [store, context]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount data hook: the sync setState is the intentional loading flag; data setState runs in the async continuation (new react-hooks v6 rule, Next 16 upgrade)
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
