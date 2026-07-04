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
 *
 * SESSION-RACE GUARD (roborev finding, health-data-critical): the background
 * persist above is deliberately NOT awaited, so it can still be in flight after
 * the account signs out. `DiaryStore.purge` (the mandatory logout privacy wipe,
 * `session/logout.ts`) targets the SAME store instance a stale `refresh()` call
 * closed over — an unguarded late write would silently resurrect a
 * just-purged account's derived data. `storeRef` always tracks the CURRENT
 * session's store; a refresh whose own captured store no longer matches it (the
 * session moved on — sign-out, re-login, or account switch happened while this
 * refresh was awaiting the cache reads) abandons the persist instead of writing.
 *
 * CONTEXT-APPLIED GATE (roborev finding, health-data-critical): a caller (e.g.
 * `InsightsView`) typically supplies a `context` that itself starts at the safe
 * empty default and is later replaced (by reference) once ITS OWN cache read
 * resolves (`useSafetyContextCache`). Exposing `loaded: true` for a result that
 * was computed against an now-superseded `context` reference would let a
 * consumer render safety rails — most dangerously an alarm-symptom rail — from
 * the WRONG context for one render. `contextUsed` records which `context`
 * reference produced the CURRENT `state`; the externally-exposed `loaded` is
 * `true` only once `contextUsed === context` (the render's current context) —
 * so a caller sees `loaded: false` (not a stale/wrong-context result) for the
 * brief window between a context change and this hook's next completed refresh.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
  // `contextUsed` is the exact `context` reference the CURRENT `state` was
  // computed against (see the CONTEXT-APPLIED GATE docs above) — `null` before
  // the first refresh completes.
  const [state, setState] = useState<Omit<InsightsState, "refresh" | "loaded"> & {
    loaded: boolean;
    contextUsed: SafetyContext | null;
  }>({
    result: null,
    mealCount: 0,
    symptomCount: 0,
    loaded: false,
    contextUsed: null,
  });

  // Always tracks the CURRENT session's store (see the SESSION-RACE GUARD docs
  // above) — updated synchronously in an effect so a refresh in flight can tell
  // whether the session has moved on since it started.
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
  }, [store]);

  const refresh = useCallback(async () => {
    const refreshStore = store; // the store THIS invocation reads from + persists to.
    const refreshContext = context; // the context THIS invocation's result reflects.
    if (!refreshStore) {
      setState({ result: null, mealCount: 0, symptomCount: 0, loaded: true, contextUsed: refreshContext });
      return;
    }
    const [meals, symptoms, protocols, conclusions, triggerClasses] = await Promise.all([
      refreshStore.allMeals(),
      refreshStore.allSymptoms(),
      refreshStore.allProtocols(),
      refreshStore.allConclusions(),
      refreshStore.allTriggerClasses(),
    ]);
    const diary = diaryDataFromCache(meals, symptoms, protocols, conclusions, triggerClasses);
    const result = analyze(diary, refreshContext);

    // The session may have signed out (or switched accounts) WHILE the reads
    // above were in flight — `DiaryStore.purge` (the mandatory logout wipe) may
    // already have run against this exact store. Abandon BOTH the state update
    // (never show a stale/previous account's analysis after the session moved
    // on) and the persist below (never risk resurrecting purged data).
    if (storeRef.current !== refreshStore) return;

    setState({
      result,
      mealCount: diary.meals.length,
      symptomCount: diary.symptoms.length,
      loaded: true,
      contextUsed: refreshContext,
    });

    // Best-effort: persist any freshly-eligible per-user lag profiles for the NEXT
    // run to read back (see module docs). Never awaited — must not delay the paint
    // — and a rejection is swallowed (cache-only, non-critical refinement).
    for (const learned of learnTriggerClasses(result.suspicions)) {
      void refreshStore
        .putTriggerClass(triggerClassDataToStored(learned.data, learned.sampleSize))
        .catch(() => {});
    }
  }, [store, context]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount data hook: the sync setState is the intentional loading flag; data setState runs in the async continuation (new react-hooks v6 rule, Next 16 upgrade)
    void refresh();
  }, [refresh]);

  // See the CONTEXT-APPLIED GATE docs above: only expose `loaded` once the held
  // state was computed against THIS render's `context` reference.
  const contextApplied = state.contextUsed === context;
  return {
    result: state.result,
    mealCount: state.mealCount,
    symptomCount: state.symptomCount,
    loaded: state.loaded && contextApplied,
    refresh,
  };
}
