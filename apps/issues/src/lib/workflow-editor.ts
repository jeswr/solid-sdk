// AUTHORED-BY Claude Opus 4.8
//
// Workflow editor (#75 P2-5) — the pure, framework-free core of in-app workflow
// editing. It models the editable form of a {@link WorkflowDef} (the ordered
// status list + the transition graph + the implicit initial state) and the
// operations the editor UI drives: add / rename / remove / reorder a status,
// toggle its open/closed (terminal) disposition, edit the allowed transitions
// between states, and choose the initial state.
//
// It mirrors the design of `inline-edit.ts` / `board.ts`: a pure transformation
// layer the React component consumes, so every operation + every validation rule
// is unit-testable WITHOUT React, a pod, or the RDF layer. The persisted shape is
// the SAME {@link WorkflowDef} the existing `Tracker.defineWorkflow` already
// writes — NO new vocab, no data-model change. The first status in the ordered
// list is always the initial state (matching `Tracker.defineWorkflow`, which sets
// `wf:initialState` to `statuses[0]`), so "set initial state" is implemented by
// moving a status to the front.

import type { WorkflowDef, WorkflowStatus } from "./issue";

/** Shared slug rule for fragment identifiers minted from a status display name. */
export function statusSlug(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A defensive deep copy of a workflow — the editor never mutates the workflow it
 * was handed (the loaded {@link WorkflowDef} may be the deep-frozen
 * `DEFAULT_WORKFLOW`, and React state must see fresh references). Every operation
 * below returns a freshly-cloned workflow.
 */
export function cloneWorkflow(workflow: WorkflowDef): WorkflowDef {
  return {
    statuses: workflow.statuses.map((s) => ({ ...s })),
    transitions: Object.fromEntries(
      Object.entries(workflow.transitions).map(([from, tos]) => [from, [...tos]]),
    ),
  };
}

/** Whether `slug` is already a declared status in `workflow`. */
function hasStatus(workflow: WorkflowDef, slug: string): boolean {
  return workflow.statuses.some((s) => s.slug === slug);
}

/**
 * Add a new status (appended to the end, so it is never the initial state by
 * accident). `label` is the human name; the slug is derived from it. Throws when
 * the label is blank or its slug collides with an existing status (a duplicate
 * slug would silently merge two columns). A new status starts non-terminal with
 * no outbound transitions.
 */
export function addStatus(workflow: WorkflowDef, label: string): WorkflowDef {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("A status needs a name.");
  const slug = statusSlug(trimmed);
  if (!slug) throw new Error("A status name must contain a letter or number.");
  if (hasStatus(workflow, slug)) throw new Error(`A status “${trimmed}” already exists.`);
  const next = cloneWorkflow(workflow);
  next.statuses.push({ slug, label: trimmed, terminal: false });
  next.transitions[slug] = [];
  return next;
}

/**
 * Rename a status (its human label only — the slug, which is the stable
 * identity carried by issues' `#status-` classes, is NEVER changed by a rename).
 * Renaming the slug would orphan every issue currently typed with the old class,
 * so a rename is label-only by design.
 *
 * This is a LIVE-EDIT setter driven directly from a text input's `onChange`, so it
 * must NEVER throw on a transient value (e.g. the field momentarily empty while the
 * user backspaces) — throwing there would surface an uncaught error in the React
 * event path (roborev job, Medium). The raw label is stored verbatim; a blank label
 * is instead caught by {@link validateWorkflow} as a save-blocking problem, so the
 * user can clear-and-retype freely while Save stays disabled until every status has
 * a name.
 */
export function renameStatus(workflow: WorkflowDef, slug: string, label: string): WorkflowDef {
  const next = cloneWorkflow(workflow);
  const status = next.statuses.find((s) => s.slug === slug);
  if (!status) return next;
  status.label = label;
  return next;
}

/**
 * Remove a status. The status is dropped from the ordered list AND every
 * transition edge that references it (as a source or a target) is pruned, so the
 * resulting graph never references a removed state. NOTE: this does NOT touch any
 * issue currently typed with the removed status — the caller (the editor UI) is
 * responsible for the in-use guard (block, or migrate the affected issues to
 * another state first) BEFORE removing it. {@link issuesInState} computes who is
 * affected.
 */
export function removeStatus(workflow: WorkflowDef, slug: string): WorkflowDef {
  const next = cloneWorkflow(workflow);
  next.statuses = next.statuses.filter((s) => s.slug !== slug);
  delete next.transitions[slug];
  for (const from of Object.keys(next.transitions)) {
    next.transitions[from] = next.transitions[from].filter((to) => to !== slug);
  }
  return next;
}

/** Set a status' open/closed disposition (terminal ⇒ resolves to `wf:Closed`). */
export function setTerminal(workflow: WorkflowDef, slug: string, terminal: boolean): WorkflowDef {
  const next = cloneWorkflow(workflow);
  const status = next.statuses.find((s) => s.slug === slug);
  if (status) status.terminal = terminal;
  return next;
}

/**
 * Toggle a single transition edge `from → to`. Adding an edge to a status that is
 * not in the workflow, or a self-edge (`from === to`), is rejected — a self-loop
 * is meaningless (same-status is always a permitted no-op in `canTransition`) and
 * a dangling target would be pruned on read anyway.
 */
export function toggleTransition(workflow: WorkflowDef, from: string, to: string): WorkflowDef {
  if (from === to) return cloneWorkflow(workflow); // a self-edge is a no-op
  const next = cloneWorkflow(workflow);
  if (!hasStatus(next, from) || !hasStatus(next, to)) return next;
  const edges = next.transitions[from] ?? (next.transitions[from] = []);
  next.transitions[from] = edges.includes(to) ? edges.filter((t) => t !== to) : [...edges, to];
  return next;
}

/**
 * Set the initial state by moving `slug` to the front of the ordered list (the
 * first status is the initial state — matching `Tracker.defineWorkflow`, which
 * writes `wf:initialState` as `statuses[0]`). A no-op if the slug is unknown.
 */
export function setInitialStatus(workflow: WorkflowDef, slug: string): WorkflowDef {
  const next = cloneWorkflow(workflow);
  const idx = next.statuses.findIndex((s) => s.slug === slug);
  if (idx <= 0) return next; // unknown, or already first
  const [status] = next.statuses.splice(idx, 1);
  next.statuses.unshift(status);
  return next;
}

/**
 * Move a status one slot earlier (`dir = -1`) or later (`dir = +1`) in the
 * declared order (which drives the board/list column order, and — for slot 0 —
 * the initial state). A move past either end is a no-op.
 */
export function moveStatus(workflow: WorkflowDef, slug: string, dir: -1 | 1): WorkflowDef {
  const next = cloneWorkflow(workflow);
  const idx = next.statuses.findIndex((s) => s.slug === slug);
  if (idx === -1) return next;
  const target = idx + dir;
  if (target < 0 || target >= next.statuses.length) return next;
  [next.statuses[idx], next.statuses[target]] = [next.statuses[target], next.statuses[idx]];
  return next;
}

/** The initial state of a workflow (the first declared status), or undefined if empty. */
export function initialStatus(workflow: WorkflowDef): WorkflowStatus | undefined {
  return workflow.statuses[0];
}

/**
 * A validation problem with the edited workflow. `error` problems BLOCK saving;
 * the editor disables Save while any exist. (There are no warning-level problems
 * here — the in-use-state guard is handled separately at remove time, not as a
 * standing validation, because it depends on the live issue list, not the
 * workflow shape.)
 */
export interface WorkflowProblem {
  message: string;
}

/**
 * Validate an edited workflow before it is persisted. The rules enforce a usable,
 * well-formed workflow:
 *  1. at least one status;
 *  2. every status has a non-blank name — `renameStatus` stores a label verbatim
 *     (it must not throw mid-edit), so a momentarily-cleared name is caught here
 *     and blocks save until the user re-types it;
 *  3. at least one INITIAL (non-terminal) state — the workflow's first status
 *     must be non-terminal, since new issues are born into it (a terminal initial
 *     state would create issues already closed);
 *  4. at least one TERMINAL state (so issues can be completed / closed);
 *  5. no transition referencing a status that is not declared (a removed-state
 *     reference) — defence-in-depth, since {@link removeStatus} already prunes
 *     edges, but a hand-constructed workflow could still carry a stale edge.
 *
 * Returns every problem found (empty ⇒ valid).
 */
export function validateWorkflow(workflow: WorkflowDef): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  if (workflow.statuses.length === 0) {
    problems.push({ message: "Add at least one status." });
    return problems; // nothing else is meaningful with no statuses
  }
  if (workflow.statuses.some((s) => s.label.trim() === "")) {
    problems.push({ message: "Every status needs a name." });
  }
  const initial = workflow.statuses[0];
  if (initial.terminal) {
    problems.push({
      message: `The first status (“${initial.label}”) is the initial state new issues start in — it must be an open (non-terminal) state.`,
    });
  }
  if (!workflow.statuses.some((s) => s.terminal)) {
    problems.push({ message: "Mark at least one status as closed (terminal) so issues can be completed." });
  }
  const slugs = new Set(workflow.statuses.map((s) => s.slug));
  for (const [from, tos] of Object.entries(workflow.transitions)) {
    if (!slugs.has(from)) {
      problems.push({ message: `A transition is defined from a removed status “${from}”.` });
      continue;
    }
    for (const to of tos) {
      if (!slugs.has(to)) {
        problems.push({ message: `“${from}” has a transition to a removed status “${to}”.` });
      }
    }
  }
  return problems;
}

/** Whether the edited workflow is free of save-blocking problems. */
export function isWorkflowValid(workflow: WorkflowDef): boolean {
  return validateWorkflow(workflow).length === 0;
}

/**
 * A minimal projection of an issue for the in-use-state guard: just its URL and
 * the status slug it currently carries. The editor takes these (mapped from the
 * loaded `IssueRecord[]`) so it never depends on the full record type.
 */
export interface IssueStatusRef {
  url: string;
  status: string;
}

/**
 * The issues currently sitting IN a given status (by slug). Used by the editor's
 * in-use-state removal guard: removing a state these issues are in would orphan
 * them onto a `#status-` class no longer in the workflow (it would stop resolving,
 * and the board could not show them in a column), so removal of an in-use state
 * is BLOCKED unless the caller first migrates these issues to another state.
 */
export function issuesInState(issues: IssueStatusRef[], slug: string): IssueStatusRef[] {
  return issues.filter((i) => i.status === slug);
}

/**
 * The migration targets offered when removing an in-use state: every OTHER
 * declared status (a removed state's issues must move somewhere that still
 * exists). The state being removed is excluded.
 */
export function migrationTargets(workflow: WorkflowDef, removingSlug: string): WorkflowStatus[] {
  return workflow.statuses.filter((s) => s.slug !== removingSlug);
}

/** One planned migration: the issues to move and the surviving target status. */
export interface MigrationPlanEntry {
  /** The removed source status the issues are currently in. */
  fromSlug: string;
  /** The surviving target status to move them to. */
  toSlug: string;
  /** The issue URLs to migrate. */
  urls: string[];
}

/**
 * The slugs REMOVED by an edit: statuses declared in `original` but no longer in
 * `saved`. This is the precise set the save-time migration must reconcile — NOT
 * "every status the saved workflow doesn't declare" (which would also sweep up a
 * pre-existing unknown / imported / corrupt status the user never touched, silently
 * relocating it — roborev job, Medium).
 */
export function removedStatuses(original: WorkflowDef, saved: WorkflowDef): string[] {
  const survivors = new Set(saved.statuses.map((s) => s.slug));
  return original.statuses.map((s) => s.slug).filter((slug) => !survivors.has(slug));
}

/**
 * Plan the save-time migration of issues stranded by a workflow save (#75 P2-5),
 * the consistency point that makes the removal/migration path race-free:
 *
 *  - `savedWorkflow` is the workflow about to be persisted — its statuses survive.
 *  - `removedSlugs` is the set of statuses REMOVED by this edit (see
 *    {@link removedStatuses}). ONLY issues in one of these are migrated — an issue
 *    in some OTHER unknown status (pre-existing, imported, or corrupt; not touched
 *    by this edit) is left exactly where it is (roborev job, Medium).
 *  - `liveRefs` is the FRESHEST issue→status data, read at save time (NOT the
 *    edit-time snapshot) — so an issue that moved into a to-be-removed status after
 *    the user clicked remove is still caught.
 *  - `removalTargets` is the user's recorded per-removed-state target (slug → slug).
 *
 * For every issue still in a removed status, the issue is migrated to that status'
 * recorded target when it survives, else to the new INITIAL state
 * (`savedWorkflow.statuses[0]`) as a safe surviving non-terminal default — never
 * left orphaned. A removed status with no issues yields no entry.
 *
 * Pure + deterministic so the save-time reconciliation is unit-tested independently
 * of React/the pod.
 */
export function planRemovalMigrations(
  savedWorkflow: WorkflowDef,
  removedSlugs: Iterable<string>,
  liveRefs: IssueStatusRef[],
  removalTargets: Record<string, string>,
): MigrationPlanEntry[] {
  const surviving = new Set(savedWorkflow.statuses.map((s) => s.slug));
  const removed = new Set(removedSlugs);
  const fallback = savedWorkflow.statuses[0]?.slug; // the new initial state
  const plan: MigrationPlanEntry[] = [];
  // Group the stranded issues by their (removed-this-edit) current status. An issue
  // in a status that is neither surviving NOR removed-this-edit is ignored.
  const strandedBySlug = new Map<string, string[]>();
  for (const ref of liveRefs) {
    if (!removed.has(ref.status)) continue; // only states removed by THIS edit
    const urls = strandedBySlug.get(ref.status) ?? [];
    urls.push(ref.url);
    strandedBySlug.set(ref.status, urls);
  }
  for (const [fromSlug, urls] of strandedBySlug) {
    const recorded = removalTargets[fromSlug];
    const toSlug = recorded && surviving.has(recorded) ? recorded : fallback;
    if (!toSlug) continue; // no surviving status at all (impossible: ≥1 always exists)
    plan.push({ fromSlug, toSlug, urls });
  }
  return plan;
}

/**
 * Build the INTERMEDIATE workflow persisted during an atomic removal-with-migration
 * (#75 P2-5): the saved (final) workflow PLUS the removed source states that still
 * have stranded issues, re-added from the ORIGINAL workflow's definitions (label,
 * terminal flag) with no outbound transitions. Persisting this BEFORE migrating
 * keeps BOTH the source columns and the migration targets present, so a partial
 * migration failure (or a closed tab) can never leave an issue referencing a status
 * the persisted workflow no longer declares (roborev job, Medium). The final
 * workflow is persisted only after every migration succeeds.
 *
 * Returns the saved workflow unchanged when nothing stranded needs a temporary
 * source column.
 */
export function buildIntermediateWorkflow(
  savedWorkflow: WorkflowDef,
  originalWorkflow: WorkflowDef,
  strandedSourceSlugs: Iterable<string>,
): WorkflowDef {
  const survivors = new Set(savedWorkflow.statuses.map((s) => s.slug));
  const originalBySlug = new Map(originalWorkflow.statuses.map((s) => [s.slug, s]));
  const next = cloneWorkflow(savedWorkflow);
  for (const slug of new Set(strandedSourceSlugs)) {
    if (survivors.has(slug)) continue; // already present in the final workflow
    const original = originalBySlug.get(slug);
    if (!original) continue; // not an original status (corrupt/unknown) — never re-add
    next.statuses.push({ ...original });
    next.transitions[slug] = []; // no outbound edges; migration uses the bypass path
  }
  return next;
}
