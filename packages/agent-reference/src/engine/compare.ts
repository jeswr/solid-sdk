// AUTHORED-BY Codex GPT-6
import type { TraceEvent } from "../trace/types.js";

export function decisionsOf(events: readonly TraceEvent[]) {
  return events
    .filter((e) => e.kind === "decision" && e.outcome)
    .map((e) => ({
      ...e,
      check:
        e.check ??
        events
          .slice(0, e.seq - 1)
          .findLast((c) => c.agent === e.agent && c.kind === "check" && c.reason === e.reason)
          ?.check,
    }));
}

/** Ordered, consuming matching: one main decision cannot match two branch decisions. */
export function firstBranchDivergence(main: readonly TraceEvent[], branch: readonly TraceEvent[]) {
  let next = 0;
  for (const decision of branch) {
    const match = main.findIndex(
      (candidate, index) =>
        index >= next &&
        candidate.agent === decision.agent &&
        candidate.part === decision.part &&
        candidate.check === decision.check &&
        candidate.outcome === decision.outcome &&
        candidate.reason === decision.reason,
    );
    if (match >= 0) next = match + 1;
    else if (!["pass", "admit", "go"].includes(decision.outcome ?? "")) return decision;
  }
  return undefined;
}
