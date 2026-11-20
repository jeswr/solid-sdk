// AUTHORED-BY Codex GPT-6
import type { TraceEvent } from "../trace/types.js";

export function decisionsOf(events: readonly TraceEvent[], scopeChecks = true) {
  return events
    .filter((e) => e.kind === "decision" && e.outcome)
    .map((e) => ({
      ...e,
      check:
        e.check ??
        events
          .slice(0, e.seq - 1)
          .findLast(
            (c) =>
              c.agent === e.agent &&
              (!scopeChecks || (c.part === e.part && c.gateRun === e.gateRun)) &&
              c.kind === "check" &&
              c.reason === e.reason,
          )?.check,
    }));
}

const sameDecision = (candidate: TraceEvent | undefined, decision: TraceEvent): boolean =>
  candidate?.agent === decision.agent &&
  candidate.part === decision.part &&
  candidate.check === decision.check &&
  candidate.outcome === decision.outcome &&
  candidate.reason === decision.reason;

/** Compare a suite branch's common prefix without skipping changed or missing decisions. */
export function firstBranchDivergence(main: readonly TraceEvent[], branch: readonly TraceEvent[]) {
  return branch.find((decision, index) => !sameDecision(main[index], decision));
}

/** Keep the existing failure classification for catalogue paths outside C6. */
export function firstCatalogueFailure(main: readonly TraceEvent[], branch: readonly TraceEvent[]) {
  let next = 0;
  for (const decision of branch) {
    const match = main.findIndex((event, index) => index >= next && sameDecision(event, decision));
    if (match >= 0) next = match + 1;
    else if (!["pass", "admit", "go"].includes(decision.outcome ?? "")) return decision;
  }
  return undefined;
}

/** A scoped stop permits subsequent releases only after their own gate decision. */
export function continuedReleaseProblem(stop: TraceEvent, later: readonly TraceEvent[]): boolean {
  if (!stop.actionDigest || !stop.actionScope) return true;
  const rejected = stop.actionScope;
  const allowed = new Map<number, TraceEvent>();
  for (const event of later) {
    if (event.agent !== stop.agent || event.part !== "outbound-gate" || event.outcome !== "go")
      continue;
    const action = event.actionScope;
    if (!action || !event.actionDigest || event.actionDigest === stop.actionDigest) return true;
    if (
      action.conversation === rejected.conversation &&
      action.action === rejected.action &&
      action.operation === rejected.operation &&
      (action.recipient !== rejected.recipient ||
        action.purpose !== rejected.purpose ||
        new Set(action.evidence).size >= new Set(rejected.evidence).size ||
        action.evidence.some((item) => !rejected.evidence.includes(item)))
    )
      return true;
    if (event.gateRun !== undefined) allowed.set(event.gateRun, event);
  }
  return later.some((event) => {
    if (event.agent !== stop.agent) return false;
    if (event.kind === "store") {
      const preceding = later.findLast(
        (candidate) =>
          candidate.agent === event.agent &&
          candidate.kind === "decision" &&
          candidate.step === event.step &&
          candidate.seq < event.seq,
      );
      return (
        !preceding ||
        !(
          (preceding.part === "inbound-gate" && preceding.outcome === "admit") ||
          (preceding.gateRun !== undefined && allowed.get(preceding.gateRun) === preceding)
        )
      );
    }
    if (event.kind !== "message-out") return false;
    const release = event.gateRun === undefined ? undefined : allowed.get(event.gateRun);
    return (
      !release ||
      release.seq >= event.seq ||
      release.messageId !== event.messageId ||
      release.actionDigest !== event.actionDigest
    );
  });
}
