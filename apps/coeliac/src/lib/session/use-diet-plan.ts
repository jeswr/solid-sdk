// AUTHORED-BY Claude Fable 5
"use client";
/**
 * Load the account's current DietPlan (DESIGN §2.2 entity 9) and its due
 * re-challenges from the durable cache — cache-only reads, so the Plan view and the
 * home re-challenge prompts paint instantly and work fully offline (UX invariant
 * #3). The plan itself is DERIVED (not fetched) from the grounded state: confirmed
 * ToleranceConclusions + active EliminationProtocols (`deriveCurrentPlan`), so it is
 * always consistent with what the diary actually holds. Due reviews reuse the pure
 * {@link surfaceReviews} — which already fails closed on the lifelong-exclusion set
 * (gluten is never surfaced for re-test).
 */
import { useCallback, useEffect, useState } from "react";
import { storedConclusionToData } from "../protocol/persist";
import { deriveCurrentPlan, type CurrentPlan } from "../inference/diet-plan";
import { surfaceReviews } from "../inference/review";
import type { ReviewSurfacing } from "../inference/types";
import { useSession } from "./context";

export interface DietPlanState {
  plan: CurrentPlan;
  /** Time-boxed exclusions whose review date has arrived (expansion bias). */
  reviews: ReviewSurfacing[];
  loaded: boolean;
  refresh: () => Promise<void>;
}

const EMPTY_PLAN: CurrentPlan = { exclusions: [], reviewDueCount: 0 };

export function useDietPlan(): DietPlanState {
  const { store } = useSession();
  const [state, setState] = useState<Omit<DietPlanState, "refresh">>({
    plan: EMPTY_PLAN,
    reviews: [],
    loaded: false,
  });

  const refresh = useCallback(async () => {
    if (!store) {
      setState({ plan: EMPTY_PLAN, reviews: [], loaded: true });
      return;
    }
    const [conclusions, protocols] = await Promise.all([
      store.allConclusions(),
      store.allProtocols(),
    ]);
    const plan = deriveCurrentPlan(conclusions, protocols);
    const reviews = surfaceReviews(conclusions.map(storedConclusionToData));
    setState({ plan, reviews, loaded: true });
  }, [store]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount data hook: the sync setState is the intentional loading flag; data setState runs in the async continuation (new react-hooks v6 rule, Next 16 upgrade)
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
