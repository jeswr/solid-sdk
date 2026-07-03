// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * Load the account's elimination protocols + tolerance conclusions from the durable
 * cache (cache-only reads — instant, offline-capable, UX invariant #3) and derive
 * the {@link ProtocolSafetyContext} the FSM needs. The emergency-trigger set is
 * derived from the diary (a trigger that preceded any emergency symptom is never
 * auto-challenged — RESEARCH §4); `coeliacDiagnosed` is caller-supplied (defaults to
 * `undefined` ⇒ NOT diagnosed ⇒ gluten challenges stay blocked, the safe default).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoredConclusion, StoredProtocol } from "../cache/diary-store";
import { diaryDataFromCache } from "../inference/from-cache";
import type { ProtocolSafetyContext } from "../protocol/fsm";
import { emergencyTriggersFromDiary } from "../protocol/safety-context";
import { useSession } from "./context";

/** What the caller can pin about the user's clinical status (safety-relevant). */
export interface ProtocolSafetyInput {
  /** A CONFIRMED coeliac diagnosis (serology + biopsy). Defaults to NOT diagnosed. */
  coeliacDiagnosed?: boolean;
}

export interface ProtocolsState {
  /** Every protocol, newest-created first. */
  protocols: StoredProtocol[];
  /** In-progress protocols (any non-`concluded` phase). */
  active: StoredProtocol[];
  /** Concluded protocols. */
  concluded: StoredProtocol[];
  /** Confirmed tolerance conclusions. */
  conclusions: StoredConclusion[];
  /** The derived safety context to pass into the FSM actions (never bypassed). */
  safety: ProtocolSafetyContext;
  loaded: boolean;
  refresh: () => Promise<void>;
}

const EMPTY: ProtocolSafetyInput = {};

export function useProtocols(input: ProtocolSafetyInput = EMPTY): ProtocolsState {
  const { store } = useSession();
  const [state, setState] = useState<Omit<ProtocolsState, "refresh" | "safety">>({
    protocols: [],
    active: [],
    concluded: [],
    conclusions: [],
    loaded: false,
  });
  const [emergencyTriggers, setEmergencyTriggers] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!store) {
      setState({ protocols: [], active: [], concluded: [], conclusions: [], loaded: true });
      setEmergencyTriggers([]);
      return;
    }
    const [protocols, conclusions, meals, symptoms] = await Promise.all([
      store.allProtocols(),
      store.allConclusions(),
      store.allMeals(),
      store.allSymptoms(),
    ]);
    const diary = diaryDataFromCache(meals, symptoms);
    setEmergencyTriggers(emergencyTriggersFromDiary(diary.meals, diary.symptoms));
    setState({
      protocols,
      active: protocols.filter((p) => p.phase !== "concluded"),
      concluded: protocols.filter((p) => p.phase === "concluded"),
      conclusions,
      loaded: true,
    });
  }, [store]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount data hook: the sync setState is the intentional loading flag; data setState runs in the async continuation (new react-hooks v6 rule, Next 16 upgrade)
    void refresh();
  }, [refresh]);

  const safety = useMemo<ProtocolSafetyContext>(
    () => ({
      coeliacDiagnosed: input.coeliacDiagnosed,
      emergencyTriggers: emergencyTriggers as ProtocolSafetyContext["emergencyTriggers"],
    }),
    [input.coeliacDiagnosed, emergencyTriggers],
  );

  return { ...state, safety, refresh };
}
