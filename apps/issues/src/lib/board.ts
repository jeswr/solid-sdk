// AUTHORED-BY Claude Opus 4.8
/**
 * board.ts — pure board logic, decoupled from React so it can be tested in
 * isolation: which issues a board shows (incl. done-and-visible, pss-w29w),
 * how a grouped move maps to a Solid mutation, and the optimistic-update /
 * revert-on-error bookkeeping.
 *
 * The data layer keeps `wf:Open`/`wf:Closed` in lock-step with the workflow
 * status (a terminal status ⇒ `wf:Closed`; see `issue.ts setStatus`). A list
 * view filtered to `state:"open"` therefore drops every Done card — which made
 * the Done column always empty even though completed work belongs there. The
 * board owns its own visibility: it shows open work AND issues sitting in a
 * terminal (done) column, so "Done" means done-and-visible rather than vanished.
 * An explicit Archive action (state stays closed, board membership removed) is
 * how a finished card later leaves the board.
 */
import type { IssueRecord } from "./repository";
import type { Priority, StatusSlug, WorkflowDef } from "./issue";

/** How the board groups cards into columns. */
export type GroupBy = "status" | "priority";

/** The priority columns (board-only; the "none" column collects unprioritised). */
export const PRIORITY_COLUMNS: { key: string; label: string }[] = [
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
  { key: "none", label: "No priority" },
];

/** The slug a card sits under for the given grouping. */
export function groupOf(issue: IssueRecord, groupBy: GroupBy): string {
  return groupBy === "status" ? issue.status : (issue.priority ?? "none");
}

/**
 * The issues a board should display, given the user's state filter and the
 * active grouping. The board is the one place completed cards stay visible:
 * even when the state filter is "open", an issue whose current status is a
 * terminal (done) column is kept so the Done column is populated — UNLESS it
 * has been archived off the board. With the filter on "closed" or "all" the
 * usual filter already includes them, so this only ever ADDS the done-but-hidden
 * cards back; it never removes anything the filter kept.
 *
 * The "keep terminal cards visible" exception applies ONLY when `groupBy ===
 * "status"` — that is the only grouping with a Done column to populate. When
 * grouping by priority there is no Done column, so a closed Done card under the
 * "open" filter would otherwise leak into a priority column; in that grouping we
 * honour the state filter exactly (closed cards drop out of the "open" board).
 *
 * `archived` is the set of issue URLs the user has archived off the board
 * (board membership only — the issue stays closed in the pod).
 */
export function boardIssues(
  issues: IssueRecord[],
  workflow: WorkflowDef,
  state: "open" | "closed" | "all",
  groupBy: GroupBy,
  archived: ReadonlySet<string> = new Set(),
): IssueRecord[] {
  const terminalSlugs = new Set(workflow.statuses.filter((s) => s.terminal).map((s) => s.slug));
  // Only a status-grouped board has a Done column; only there do we keep
  // terminal-status cards visible past the "open" filter.
  const keepTerminalVisible = groupBy === "status";
  return issues.filter((i) => {
    if (archived.has(i.url)) return false;
    // The chosen state filter always shows its matches…
    if (state === "all") return true;
    if (state === "closed") return i.state === "closed";
    // …and on "open" a status-grouped board also keeps cards in a terminal
    // (done) column; a priority-grouped board honours the filter exactly.
    return i.state === "open" || (keepTerminalVisible && terminalSlugs.has(i.status));
  });
}

/** A board column with its display label. */
export interface BoardColumn {
  key: string;
  label: string;
}

/** The columns for a grouping: the workflow's statuses, or the fixed priority set. */
export function boardColumns(workflow: WorkflowDef, groupBy: GroupBy): BoardColumn[] {
  return groupBy === "status"
    ? workflow.statuses.map((s) => ({ key: s.slug, label: s.label }))
    : PRIORITY_COLUMNS;
}

/**
 * A single board mutation, expressed declaratively so the optimistic layer can
 * apply it locally AND the caller can persist it. `kind: "status"` carries the
 * target status slug; `kind: "priority"` the target priority (or undefined to
 * clear it).
 */
export type BoardMove =
  | { kind: "status"; status: StatusSlug }
  | { kind: "priority"; priority: Priority | undefined };

/** Translate a drop onto a column into the mutation it represents. */
export function moveForColumn(groupBy: GroupBy, columnKey: string): BoardMove {
  if (groupBy === "status") return { kind: "status", status: columnKey };
  return { kind: "priority", priority: columnKey === "none" ? undefined : (columnKey as Priority) };
}

/**
 * Apply a board move to one issue record locally (optimistic update). Returns a
 * NEW record — the input is never mutated — so React sees a fresh reference.
 * Mirrors the data layer's coupling of status and open/closed state: moving a
 * card into a terminal column closes it; into a non-terminal column reopens it.
 */
export function applyMove(issue: IssueRecord, move: BoardMove, workflow: WorkflowDef): IssueRecord {
  if (move.kind === "priority") {
    return { ...issue, priority: move.priority };
  }
  const terminal = workflow.statuses.find((s) => s.slug === move.status)?.terminal ?? false;
  return { ...issue, status: move.status, state: terminal ? "closed" : "open" };
}

/**
 * Optimistically apply a move across a list, returning the new list plus the
 * ORIGINAL record (for revert-on-error). The original is `undefined` when the
 * url is not in the list (nothing to do). A move that does not actually change
 * the grouped value is a no-op (returns the same list and no original), so a
 * drop onto the card's current column never spuriously shows "Saving…".
 */
export function optimisticMove(
  issues: IssueRecord[],
  url: string,
  move: BoardMove,
  groupBy: GroupBy,
  workflow: WorkflowDef,
): { next: IssueRecord[]; original?: IssueRecord } {
  const current = issues.find((i) => i.url === url);
  if (!current) return { next: issues };
  const updated = applyMove(current, move, workflow);
  if (groupOf(updated, groupBy) === groupOf(current, groupBy)) return { next: issues };
  return {
    next: issues.map((i) => (i.url === url ? updated : i)),
    original: current,
  };
}

/** Restore a reverted record into the list (used when the async write fails). */
export function revertMove(issues: IssueRecord[], original: IssueRecord): IssueRecord[] {
  return issues.map((i) => (i.url === original.url ? original : i));
}

/**
 * Revert a FAILED optimistic move to `original`, but ONLY when the card's
 * current local record still corresponds to the move that failed — identified
 * by `optimistic` (the record this move optimistically wrote). If, while the
 * write was in flight, the user moved the SAME card again (so its current record
 * no longer equals `optimistic`), that newer move owns the card's state: the
 * stale failure is dropped and the list returned unchanged.
 *
 * The relevant grouped value is what a move changes, so we compare on the move's
 * dimension (status vs priority) — a later, unrelated re-render that produced a
 * fresh object reference must not look like a "newer move".
 *
 * Crucially, the revert restores ONLY the field(s) the failed move changed
 * (`status`/`state` for a status move, `priority` for a priority move) onto the
 * CURRENT record — it does NOT replace the whole record with the stale
 * `original`. Any UNRELATED edit that landed while the write was pending (a
 * title/assignee change, a new comment) is preserved; only the failed move's own
 * dimension rolls back.
 */
export function revertMoveIfCurrent(
  issues: IssueRecord[],
  original: IssueRecord,
  optimistic: IssueRecord,
  move: BoardMove,
): IssueRecord[] {
  const current = issues.find((i) => i.url === original.url);
  if (!current) return issues; // card gone (deleted/archived) — nothing to revert
  const stillThisMove =
    move.kind === "status"
      ? current.status === optimistic.status && current.state === optimistic.state
      : current.priority === optimistic.priority;
  // A newer move of the same card already changed it — drop the stale failure.
  if (!stillThisMove) return issues;
  // Roll back ONLY the move's own dimension onto the CURRENT record, so any
  // concurrent edit to other fields (title, assignee, …) is kept.
  const reverted: IssueRecord =
    move.kind === "status"
      ? { ...current, status: original.status, state: original.state }
      : { ...current, priority: original.priority };
  return issues.map((i) => (i.url === original.url ? reverted : i));
}
