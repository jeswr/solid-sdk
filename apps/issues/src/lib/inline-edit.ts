// AUTHORED-BY Claude Opus 4.8
//
// Inline cell editing (#75 P1-6) — the pure, framework-free core of Monday-style
// edit-in-place. It models one optimistic field edit over the loaded issue list:
// apply the new value immediately, and (on a failed persist) revert ONLY the
// edited field — and only if a LATER edit of the same field hasn't superseded it.
//
// This mirrors the board's optimistic-move helpers (`board.ts`
// `optimisticMove`/`revertMoveIfCurrent`): the UI slides the value in instantly,
// persists via the existing `repository` update path in the background, shows a
// non-intrusive Saving…/Saved indicator, and reverts the cell + surfaces an error
// on failure. A status edit additionally couples `state` to the workflow's
// open/closed resolution, exactly as the data layer does on write.

import type { IssueRecord, IssuePatch, Repository } from "./repository";
import type { Priority, StatusSlug, WorkflowDef } from "./issue";
import { statusState } from "./issue";
import { ConflictError } from "./errors";

/**
 * The set of issue fields editable inline in the table. A small, deliberate
 * whitelist of EXISTING fields (no new vocab/model): the workflow status, the
 * priority, the assignee, the title, and any custom field (keyed `field:<slug>`).
 * Custom-field cells carry the slug after the `field:` prefix.
 */
export type EditableField =
  | "title"
  | "status"
  | "priority"
  | "assignee"
  | `field:${string}`;

/** The custom-field slug an `EditableField` targets, or undefined if it's a core field. */
export function customFieldSlug(field: EditableField): string | undefined {
  return field.startsWith("field:") ? field.slice("field:".length) : undefined;
}

/**
 * The current value of an editable field on a record, in the shape the edit cell
 * works with: a string for title/status/priority/assignee/select+text+url custom
 * fields, a number/Date for number/date custom fields, and `undefined` for an
 * unset optional field. Core enums (status/priority) are returned as their slug.
 */
export function currentValue(issue: IssueRecord, field: EditableField): string | number | Date | undefined {
  const slug = customFieldSlug(field);
  if (slug !== undefined) return issue.fields[slug];
  switch (field) {
    case "title":
      return issue.title;
    case "status":
      return issue.status;
    case "priority":
      return issue.priority;
    case "assignee":
      return issue.assignee;
  }
}

/**
 * Apply a field edit to ONE record locally (optimistic), returning a NEW record —
 * the input is never mutated, so React sees a fresh reference. A status edit also
 * couples `state` (open/closed) to the target status' resolution under the active
 * workflow, mirroring the data layer's write coupling (so a terminal status closes
 * the issue and a non-terminal one reopens it, consistently with the board).
 *
 * `value` is the field's new value (slug for status/priority, WebID for assignee,
 * the typed value for custom fields); `undefined` clears an optional field (a
 * cleared priority/assignee/custom field). `title` cannot be cleared — an empty
 * edit is rejected upstream by {@link normalizeTitle}, never reaching here.
 */
export function applyEdit(
  issue: IssueRecord,
  field: EditableField,
  value: string | number | Date | undefined,
  workflow: WorkflowDef,
): IssueRecord {
  const slug = customFieldSlug(field);
  if (slug !== undefined) {
    const fields = { ...issue.fields };
    if (value === undefined) delete fields[slug];
    else fields[slug] = value;
    return { ...issue, fields };
  }
  switch (field) {
    case "title":
      return { ...issue, title: String(value) };
    case "priority":
      return { ...issue, priority: value as Priority | undefined };
    case "assignee":
      return { ...issue, assignee: value === undefined ? undefined : String(value) };
    case "status": {
      const status = String(value) as StatusSlug;
      const terminal = statusState(workflow, status) === "closed";
      return { ...issue, status, state: terminal ? "closed" : "open" };
    }
    default:
      // Unreachable: a `field:<slug>` cell is handled by the customFieldSlug
      // branch above; every core field is covered. Kept for exhaustiveness.
      return issue;
  }
}

/**
 * Optimistically apply a field edit across the list, returning the new list plus
 * the ORIGINAL record (for revert-on-error). The original is `undefined` when the
 * url is not in the list, OR when the edit does not actually change the field's
 * value (a no-op re-assert) — so re-selecting the current value never spuriously
 * shows "Saving…" or fires a pointless write.
 */
export function optimisticEdit(
  issues: IssueRecord[],
  url: string,
  field: EditableField,
  value: string | number | Date | undefined,
  workflow: WorkflowDef,
): { next: IssueRecord[]; original?: IssueRecord } {
  const current = issues.find((i) => i.url === url);
  if (!current) return { next: issues };
  if (sameValue(currentValue(current, field), value)) return { next: issues };
  const updated = applyEdit(current, field, value, workflow);
  return { next: issues.map((i) => (i.url === url ? updated : i)), original: current };
}

/**
 * Revert a FAILED inline edit to `original`, but ONLY when the cell's current
 * local record still carries the value this edit optimistically wrote
 * (identified by `optimistic`). If, while the write was in flight, the user edited
 * the SAME field again (so its current value no longer equals `optimistic`'s),
 * that newer edit owns the cell: the stale failure is dropped and the list is
 * returned unchanged.
 *
 * Crucially, the revert restores ONLY the field this edit changed (plus the
 * coupled `state` for a status edit) onto the CURRENT record — it does NOT replace
 * the whole record with the stale `original`. Any UNRELATED edit that landed while
 * the write was pending (a different cell on the same row, a new comment) is
 * preserved; only the failed edit's own field rolls back. Mirrors
 * {@link board.revertMoveIfCurrent}.
 */
export function revertEditIfCurrent(
  issues: IssueRecord[],
  field: EditableField,
  original: IssueRecord,
  optimistic: IssueRecord,
): IssueRecord[] {
  const current = issues.find((i) => i.url === original.url);
  if (!current) return issues; // row gone (deleted) — nothing to revert
  if (!sameValue(currentValue(current, field), currentValue(optimistic, field))) return issues;
  // A status edit also wrote `state`; roll it back too. All other fields are
  // single-field rollbacks onto the CURRENT record (preserving concurrent edits).
  const reverted: IssueRecord =
    field === "status"
      ? { ...current, status: original.status, state: original.state }
      : restoreField(current, original, field);
  return issues.map((i) => (i.url === original.url ? reverted : i));
}

/** Restore a single (non-status) field's value from `original` onto `current`. */
function restoreField(current: IssueRecord, original: IssueRecord, field: EditableField): IssueRecord {
  const slug = customFieldSlug(field);
  if (slug !== undefined) {
    const fields = { ...current.fields };
    const prev = original.fields[slug];
    if (prev === undefined) delete fields[slug];
    else fields[slug] = prev;
    return { ...current, fields };
  }
  switch (field) {
    case "title":
      return { ...current, title: original.title };
    case "priority":
      return { ...current, priority: original.priority };
    case "assignee":
      return { ...current, assignee: original.assignee };
    // `status` is handled by the caller (it also couples `state`); unreachable here.
    case "status":
      return { ...current, status: original.status, state: original.state };
    default:
      return current; // unreachable: field: cells handled above, all core fields covered
  }
}

/**
 * Build the {@link IssuePatch} that persists an inline edit via the existing
 * `repository.update` path — the SAME persistence + validation the form dialog
 * uses. Custom-field edits go through the `fields` map (keyed by slug; `undefined`
 * clears the value). Status is NOT patched here: a status edit goes through the
 * workflow-validating `setStatus` (via the dependency-guarded transition), not a
 * raw field patch — see the table's status cell. Returns `undefined` for a status
 * field (the caller must route it through the guarded `setStatus`).
 */
export function patchForEdit(
  field: EditableField,
  value: string | number | Date | undefined,
): IssuePatch | undefined {
  const slug = customFieldSlug(field);
  if (slug !== undefined) return { fields: { [slug]: value } };
  switch (field) {
    case "title":
      return { title: String(value) };
    case "priority":
      return { priority: value as Priority | undefined };
    case "assignee":
      return { assignee: value === undefined ? undefined : String(value) };
    case "status":
      return undefined; // routed through guarded setStatus, never a raw patch
  }
}

/**
 * Normalize a title edit: trim, and return `undefined` for an empty result (a
 * blank title is rejected — there is nothing to persist and the model treats a
 * cleared title as `(untitled)`). The cell uses this to no-op an empty commit
 * (reverting to the prior value) rather than wiping the title.
 */
export function normalizeTitle(raw: string): string | undefined {
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

/** Value equality for the inline-edit value union (strings/numbers/Dates/undefined). */
function sameValue(a: string | number | Date | undefined, b: string | number | Date | undefined): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/**
 * The optimistic-mutation seam an inline edit drives — exactly the subset of the
 * `useIssues` hook the board already uses for its optimistic moves. Kept as an
 * interface so the edit flow ({@link makeInlineEditController}) is fully
 * unit-testable with a fake seam, no React/hook needed.
 */
export interface InlineEditSeam {
  /**
   * Read the CURRENT loaded issue list SYNCHRONOUSLY. Must reflect the latest
   * rendered state even when called from a deferred callback (a guarded status
   * edit confirmed after the warning dialog) — the hook backs this with a ref, so
   * the optimistic edit is always computed against live state, never a stale
   * closure snapshot. (Using a getter — not a captured array — is load-bearing:
   * the metadata below is derived synchronously from it, NOT via side-effects
   * inside the React state updater, which may be batched/deferred.)
   */
  getIssues: () => IssueRecord[];
  /** Optimistically replace the local list (slide the cell in immediately). */
  setIssuesLocal: (updater: (issues: IssueRecord[]) => IssueRecord[]) => void;
  /** Persist a pod write WITHOUT a blocking refresh (shows Saving…/Saved). */
  persist: (write: (repo: Repository) => Promise<void>) => Promise<void>;
  /** Reconcile from the pod after a conflict (don't clobber a concurrent change). */
  refresh: () => Promise<void>;
}

/** Toast surface for inline-edit feedback (conflict vs generic error). */
export interface InlineEditToast {
  error: (message: string) => void;
}

/**
 * The dependency/workflow guard for a status transition — the SAME
 * `guardedTransition` the board uses. Warns (never hard-blocks) before
 * starting/completing an issue with open blockers; `proceed` runs the transition
 * once the user confirms (or immediately when there's nothing to warn about).
 */
export type GuardedTransition = (
  issue: IssueRecord,
  targetStatus: StatusSlug,
  verb: string,
  proceed: () => void,
) => void;

/**
 * Build the two inline-edit commit handlers (a non-status field edit, and a
 * guarded status edit) over an optimistic seam. This is the testable core of the
 * IssuesView wiring: it owns the optimistic apply → background persist via the
 * EXISTING `repository.update` / `setStatus` path → revert-on-failure (preserving
 * concurrent edits) → ETag-conflict reconcile. It deliberately holds no React
 * state, so it can be exercised directly in a unit test with a fake seam.
 */
export function makeInlineEditController(
  seam: InlineEditSeam,
  workflow: WorkflowDef,
  toast: InlineEditToast,
  guardedTransition: GuardedTransition,
): {
  edit: (issue: IssueRecord, field: EditableField, value: string | number | Date | undefined) => void;
  editStatus: (issue: IssueRecord, status: StatusSlug) => void;
} {
  const handleFailure = (field: EditableField, original: IssueRecord, optimistic: IssueRecord, e: unknown) => {
    // Roll the field back to its true pre-edit value in the controller's
    // accumulator too, so a later edit composed before the next render starts from
    // reverted (not phantom-optimistic) state.
    accumulator = revertEditIfCurrent(accumulator ?? seam.getIssues(), field, original, optimistic);
    seam.setIssuesLocal((list) => revertEditIfCurrent(list, field, original, optimistic));
    if (e instanceof ConflictError) {
      toast.error(e.message);
      void seam.refresh(); // a concurrent change landed — reconcile, never clobber
    } else {
      toast.error(e instanceof Error ? e.message : "Could not save the change.");
    }
  };

  // A controller-local accumulator: the single SYNCHRONOUS source of truth for the
  // optimistic list across rapid edits within this controller instance's lifetime.
  // The controller is recreated each render with a fresh `seam.getIssues()`, so the
  // accumulator is seeded lazily from the live ref and then carries the composed
  // optimistic state between renders — where `getIssues()`'s ref is stale-until-
  // render. Driving the persist decision, the revert metadata, AND the state update
  // all from THIS one list keeps them consistent: two rapid same-field edits each
  // see the prior optimistic value as their `original`, so a later failed write
  // never reverts past an earlier (successful/pending) edit.
  let accumulator: IssueRecord[] | undefined;

  /**
   * Apply the optimistic edit + start the background write, all driven by the
   * synchronous {@link accumulator} (not the stale-until-render `getIssues()` ref):
   *
   *  - PERSIST DECISION + REVERT METADATA: computed against the accumulator, so a
   *    no-op (unchanged value / missing row) skips the write, and `original`/
   *    `optimistic` reflect the value JUST BEFORE this edit (even when an earlier
   *    rapid edit to the same field hasn't rendered yet). The decision is made
   *    synchronously here — never inside a (batchable/deferrable) state updater —
   *    so the write can't be silently skipped.
   *  - STATE UPDATE: still compositional against React's `current` list (which
   *    carries any queued change), reconciled with the accumulator so the two agree.
   */
  const applyAndPersist = (
    issue: IssueRecord,
    field: EditableField,
    value: string | number | Date | undefined,
    write: (repo: Repository) => Promise<void>,
  ) => {
    const base = accumulator ?? seam.getIssues();
    const { next, original } = optimisticEdit(base, issue.url, field, value, workflow);
    if (!original) return; // no-op (unchanged value / row gone)
    accumulator = next; // advance the synchronous source of truth
    const optimistic = next.find((i) => i.url === issue.url)!;
    // Compositional state update: re-apply against React's current list so a
    // concurrent/queued change isn't dropped; the result matches the accumulator.
    seam.setIssuesLocal((current) => optimisticEdit(current, issue.url, field, value, workflow).next);
    void seam.persist(write).catch((e) => handleFailure(field, original, optimistic, e));
  };

  const edit = (issue: IssueRecord, field: EditableField, value: string | number | Date | undefined) => {
    const patch = patchForEdit(field, value);
    if (!patch) return; // status is routed through editStatus, never a raw patch
    applyAndPersist(issue, field, value, (r) => r.update(issue.url, patch));
  };

  const editStatus = (issue: IssueRecord, status: StatusSlug) => {
    // Route through the dependency/workflow guard: starting/completing a blocked
    // issue warns first (override allowed) before the optimistic write fires. The
    // optimistic edit is computed against the live list at confirmation time, so a
    // deferred confirmation can't clobber newer local state. setStatus enforces the
    // workflow's transition rules at the data layer (a disallowed move throws) and
    // couples wf:Open/Closed — the inline status edit honours the SAME validation as
    // the form/board path.
    guardedTransition(issue, status, "set status", () =>
      applyAndPersist(issue, "status", status, (r) => r.setStatus(issue.url, status)),
    );
  };

  return { edit, editStatus };
}
