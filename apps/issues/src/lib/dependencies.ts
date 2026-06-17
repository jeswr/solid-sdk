// AUTHORED-BY Claude Opus 4.8
import type { IssueRecord } from "./repository";
import type { StatusSlug, WorkflowDef } from "./issue";
import { statusState } from "./issue";

/**
 * Dependency enforcement (#75 P1-4): a *warning*, never a hard block. When an
 * issue is started (moved out of its initial state) or completed (moved into a
 * terminal/closed state) while it still `dct:requires` issues that are NOT yet
 * closed, the open blockers are surfaced so the user can see them — and is then
 * allowed to proceed (override). Nothing here mutates the pod or blocks a write;
 * it is a pure derivation over the issue links the shared model already stores.
 */

/** One open blocker surfaced to the user before/at a guarded transition. */
export interface OpenBlocker {
  /** The blocker issue's document URL (its `dct:requires` target). */
  url: string;
  /** The blocker's human title, when resolvable from the loaded issues. */
  title?: string;
  /** The blocker's workflow status slug, when resolvable. */
  status?: StatusSlug;
}

/**
 * The structured result of the dependency check at a transition. `blocked` is
 * `true` iff there is at least one open blocker — but it is advisory: the caller
 * shows {@link OpenBlocker}s and may proceed regardless (override). The empty
 * result (`blocked: false`, no blockers) means the transition is unobstructed.
 */
export interface DependencyWarning {
  /** Whether the guarded transition has any open (not-closed) blocker. */
  blocked: boolean;
  /** The open blockers, in the issue's stored `blockedBy` order. */
  blockers: OpenBlocker[];
}

/** A target status whose transition is dependency-guarded carries no blockers. */
export const NO_WARNING: DependencyWarning = { blocked: false, blockers: [] };

/**
 * Whether moving `issue` to `targetStatus` is a transition we guard — i.e. the
 * user is *starting* the work (leaving the initial/todo state for a non-initial
 * state) or *completing* it (entering a terminal/closed state). Re-asserting the
 * same status, or moving *back* to the initial state (un-starting), is not
 * guarded — only forward progress can be obstructed by an open blocker.
 *
 * Workflow-agnostic: "started" is "no longer the workflow's first status", and
 * "done" is the status' open/closed resolution under the active workflow — so a
 * custom workflow's terminal status (e.g. "shipped") counts as completion
 * without naming any slug.
 */
export function isGuardedTransition(
  fromStatus: StatusSlug,
  targetStatus: StatusSlug,
  workflow: WorkflowDef,
): boolean {
  if (fromStatus === targetStatus) return false; // a no-op re-assert isn't a transition
  const initial = workflow.statuses[0]?.slug;
  const enteringDone = statusState(workflow, targetStatus) === "closed";
  // "Starting" = moving INTO a non-initial state from the initial one. Moving
  // between two already-started states (e.g. in-progress → in-review) is also
  // forward progress, so it is guarded too; only landing back ON the initial
  // state is exempt.
  const leavingInitial = targetStatus !== initial;
  return enteringDone || leavingInitial;
}

/**
 * Compute the open blockers of `issue` from a loaded issue list (the in-memory,
 * instant path the UI already has). A blocker is "open" when it is found in the
 * list and its `state` is not `"closed"`; a blocker that cannot be resolved (not
 * in the list, e.g. cross-pod or not-yet-loaded) is treated as NOT blocking — we
 * never block on data we can't see (fail-open, matching the warn-don't-block
 * stance).
 */
export function openBlockersOf(issue: IssueRecord, issues: IssueRecord[]): OpenBlocker[] {
  const byUrl = new Map(issues.map((i) => [i.url, i]));
  const out: OpenBlocker[] = [];
  for (const url of issue.blockedBy) {
    const blocker = byUrl.get(url);
    // Unresolvable blocker → not counted (fail-open). Resolved + closed → cleared.
    if (blocker && blocker.state !== "closed") {
      out.push({ url, title: blocker.title, status: blocker.status });
    }
  }
  return out;
}

/**
 * The dependency warning for moving `issue` to `targetStatus`, from a loaded
 * issue list. Returns {@link NO_WARNING} when the transition is not guarded
 * ({@link isGuardedTransition}) or when no blocker is open. Pure + synchronous —
 * the UI calls it to show blockers before a transition; the result is advisory
 * (the user may override).
 */
export function dependencyWarning(
  issue: IssueRecord,
  targetStatus: StatusSlug,
  issues: IssueRecord[],
  workflow: WorkflowDef,
): DependencyWarning {
  if (!isGuardedTransition(issue.status, targetStatus, workflow)) return NO_WARNING;
  const blockers = openBlockersOf(issue, issues);
  return blockers.length === 0 ? NO_WARNING : { blocked: true, blockers };
}
