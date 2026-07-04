// AUTHORED-BY Claude Sonnet 5
"use client";
/**
 * Persist the Insights safety-context inputs (DESIGN §4.4 — the confirmed-coeliac
 * toggle, the alarm-symptom checklist, the strict-adherence toggle) in the durable
 * client cache, WebID-scoped exactly like every other cached record, so they
 * survive a reload instead of silently resetting to the always-safe defaults every
 * visit (suite-tracker-ov8g deliverable 2). Cache-only: nothing here is ever sent
 * over the network, logged, or shared — self-reported clinical status stays on
 * the device, and is swept by the same purge-on-logout pass as everything else
 * (`DiaryStore.purge` — prefix-based, so this new record kind needed no change
 * there).
 */
import { useCallback, useEffect, useState } from "react";
import { storedSafetyContextToContext } from "../inference/from-cache";
import type { SafetyContext } from "../inference/types";
import { useSession } from "./context";

const EMPTY_CONTEXT: SafetyContext = {};

export interface SafetyContextState {
  /** The current safety-context inputs (defaults to `{}` until loaded/saved). */
  context: SafetyContext;
  loaded: boolean;
  /** Update + persist the safety-context inputs (optimistic — updates state first). */
  update: (next: SafetyContext) => Promise<void>;
}

export function useSafetyContextCache(): SafetyContextState {
  const { store } = useSession();
  const [context, setContext] = useState<SafetyContext>(EMPTY_CONTEXT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!store) {
        if (!cancelled) setLoaded(true);
        return;
      }
      const cached = await store.getSafetyContext();
      if (!cancelled) {
        setContext(storedSafetyContextToContext(cached));
        setLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [store]);

  const update = useCallback(
    async (next: SafetyContext) => {
      setContext(next); // optimistic — instant (UX invariant #2), never blocks on the write.
      if (!store) return;
      await store.putSafetyContext({
        kind: "safetyContext",
        coeliacDiagnosed: next.coeliacDiagnosed,
        alarmFlags: next.alarmFlags,
        strictAdherence: next.strictAdherence,
        updatedAt: new Date().toISOString(),
      });
    },
    [store],
  );

  return { context, loaded, update };
}
