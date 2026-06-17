// AUTHORED-BY Claude Opus 4.8
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Repository } from "@/lib/repository";
import type { WorkflowDef } from "@/lib/issue";
import {
  addStatus,
  renameStatus,
  removeStatus,
  setTerminal,
  toggleTransition,
  moveStatus,
  validateWorkflow,
  isWorkflowValid,
  issuesInState,
  migrationTargets,
  planRemovalMigrations,
  removedStatuses,
  buildIntermediateWorkflow,
  type IssueStatusRef,
} from "@/lib/workflow-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ArrowDown, ArrowUp, Check, GitBranch, Loader2, Plus, X } from "lucide-react";

/**
 * Workflow editor (#75 P2-5) — an in-app editor for the tracker's configurable
 * status workflow, lives inside {@link FieldsDialog}. It edits the EXISTING
 * {@link WorkflowDef} that already drives the board/list/table (the `#status-*`
 * `wf:State` classes + `wf:allowedTransitions` + `wf:initialState`), persisting via
 * the existing `Repository.defineWorkflow` write path (ETag-safe via `mutateTracker`).
 * NO new vocab, no data-model change.
 *
 * Capabilities: add / rename / remove / reorder a status, set each state's
 * open/closed (terminal) resolution + order, edit the allowed transitions between
 * states, and set the initial state (= the first status, reorderable to the top).
 *
 * Validation (save is disabled while any problem stands): every status named + ≥1
 * initial (non-terminal) state + ≥1 terminal state + no transition referencing a
 * removed state.
 *
 * In-use-state guard (SAVE-TIME consistent): removing a state issues are currently
 * IN prompts the user to pick a migration target, but NOTHING is migrated yet — the
 * removal is a draft-only edit and the chosen target is recorded. All reconciliation
 * happens atomically at SAVE:
 *   1. the new workflow is persisted FIRST (so the migration targets exist with
 *      their final terminal flags — `migrateStatus` resolves open/closed against the
 *      PERSISTED workflow, so migrating before save could fail or write a stale
 *      state — roborev job, Medium);
 *   2. then, re-reading the LIVE issue→status refs (`getIssueStatusRefs`, not the
 *      edit-time snapshot — an issue may have moved into a removed state after the
 *      remove click, roborev job Medium), every issue still in a removed state is
 *      migrated to that state's recorded target, defaulting safely to the new
 *      workflow's initial state when none was recorded.
 * So an issue is never orphaned onto a `#status-` class no longer in the workflow,
 * even under concurrent moves.
 */
export function WorkflowEditorSection({
  trackerUrl,
  workflow,
  issueStatusRefs,
  getIssueStatusRefs,
  migrateIssues,
  onSaved,
}: {
  trackerUrl: string;
  /** The loaded workflow (the editor seeds its editable copy from this). */
  workflow: WorkflowDef;
  /** Render-snapshot status of each issue — the EDIT-TIME in-use guard's source. */
  issueStatusRefs: IssueStatusRef[];
  /**
   * Read the LIVE issue→status refs synchronously at call time — used at SAVE to
   * reconcile removed states against the freshest data (an issue may have moved into
   * a removed state since the edit-time check). Falls back to {@link issueStatusRefs}.
   */
  getIssueStatusRefs?: () => IssueStatusRef[];
  /**
   * Migrate the given issues to a target status, via the parent's `migrateStatus`
   * batch (relocates out of a removed state WITHOUT the transition guard, keeping
   * the target's open/closed resolution + activity log). Resolves when all moved.
   */
  migrateIssues: (urls: string[], toStatus: string) => Promise<void>;
  /**
   * Called after a save so the parent reloads its own tracker config / issue list.
   * The editor does NOT depend on it to recover from a partial failure — it re-reads
   * the persisted workflow itself and re-seeds the draft (see the catch in `save`).
   */
  onSaved?: () => void;
}) {
  // The editable working copy. Re-seeded whenever the loaded workflow changes
  // (a fresh dialog open / a save → reload). The loaded workflow may be the
  // deep-frozen DEFAULT_WORKFLOW, so the editor only ever holds clones (every
  // operation in workflow-editor.ts returns a fresh copy).
  const [draft, setDraft] = useState<WorkflowDef>(workflow);
  // The CONFIRMED baseline the draft was derived from — the source of truth for save
  // planning (`removedStatuses`, `buildIntermediateWorkflow`) and `reset`, NOT the
  // raw `workflow` prop. It advances on: the prop changing (seeding effect), a
  // SUCCESSFUL strict re-read (recovery), and a SUCCESSFUL save (the saved workflow
  // becomes the new baseline). This stops a save from planning removals against a
  // stale prop after a recovery re-read or a save the parent hasn't reloaded yet —
  // which could otherwise miss a status removal and strand its issues (roborev job).
  const [baseline, setBaseline] = useState<WorkflowDef>(workflow);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  // A pending in-use-state removal awaiting the user's migrate-or-cancel decision.
  const [pendingRemoval, setPendingRemoval] = useState<
    { slug: string; label: string; affected: IssueStatusRef[] } | undefined
  >(undefined);
  const [migrateTo, setMigrateTo] = useState<string>("");
  // Recorded migration targets for in-use states removed in the draft (slug →
  // target slug). Applied at SAVE, after the new workflow is persisted — never
  // eagerly. A removed state with no recorded target (e.g. it became in-use only
  // after removal) falls back to the new initial state at save.
  const [removalTargets, setRemovalTargets] = useState<Record<string, string>>({});
  // Locked after a partial-save failure (we'd already written to the pod, so the
  // persisted workflow has moved past this attempt's baseline) UNTIL a confirmed-fresh
  // re-read installs a clean baseline. While set, every control incl. Save is disabled,
  // so the user cannot re-save from a stale draft after an ambiguous pod write (roborev
  // job). Released only by a SUCCESSFUL strict re-read (here or via the Reload button)
  // or by a fresh `workflow` prop landing (the seeding effect).
  const [reloadPending, setReloadPending] = useState(false);
  // True when the partial-save recovery's strict re-read FAILED — the editor stays
  // locked and shows a "Reload from server" retry. We never fall back to the stale
  // prop baseline AND unlock, which could drop intermediate-only statuses + orphan
  // migrated issues (roborev job).
  const [reloadFailed, setReloadFailed] = useState(false);

  useEffect(() => {
    // Re-seed the editable copy whenever the loaded workflow changes (dialog open
    // / a save → reload). Both setters run synchronously in the effect body. This
    // is also where a post-partial-failure reload clears the lock (a fresh
    // `workflow` prop has landed — the baseline is fresh again).
    /* eslint-disable react-hooks/set-state-in-effect */
    setDraft(workflow);
    setBaseline(workflow); // the prop is now the confirmed planning baseline
    setDirty(false);
    setRemovalTargets({});
    setReloadPending(false);
    setReloadFailed(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [workflow]);

  const apply = (next: WorkflowDef) => {
    setDraft(next);
    setDirty(true);
  };

  const problems = useMemo(() => validateWorkflow(draft), [draft]);
  const valid = isWorkflowValid(draft);
  const initialSlug = draft.statuses[0]?.slug;

  const handleAdd = () => {
    try {
      apply(addStatus(draft, newName));
      setNewName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the status.");
    }
  };

  // Drop a status from the draft AND clear any recorded migration target keyed on
  // it (a removed-then-readded state must not carry a stale plan).
  const dropFromDraft = (slug: string) => {
    apply(removeStatus(draft, slug));
    setRemovalTargets((m) => {
      if (!(slug in m)) return m;
      const rest = { ...m };
      delete rest[slug];
      return rest;
    });
  };

  // Removing a status: if issues are (per the edit-time snapshot) in it, prompt for
  // a migration target before dropping it; otherwise drop it straight away. NOTHING
  // is migrated here — the actual move happens atomically at save, after the new
  // workflow is persisted and against the freshest issue data.
  const handleRemove = (slug: string, label: string) => {
    const affected = issuesInState(issueStatusRefs, slug);
    if (affected.length > 0) {
      const targets = migrationTargets(draft, slug);
      setMigrateTo(targets[0]?.slug ?? "");
      setPendingRemoval({ slug, label, affected });
      return;
    }
    dropFromDraft(slug);
  };

  // Confirm the in-use removal: RECORD the chosen target (not a pod write) and drop
  // the state from the draft. The migration is deferred to save (so the target
  // exists with its final terminal flag, and the live issue set is re-checked).
  const confirmMigrateAndRemove = () => {
    const pending = pendingRemoval;
    if (!pending || !migrateTo) return;
    apply(removeStatus(draft, pending.slug));
    setRemovalTargets((m) => ({ ...m, [pending.slug]: migrateTo }));
    setPendingRemoval(undefined);
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    // Tracks whether we've written ANYTHING to the pod yet. If a write succeeds and
    // a LATER step fails, the persisted workflow no longer matches the `workflow`
    // prop baseline this attempt planned from — so a naive retry would plan removals
    // against a stale baseline (roborev job). On such a partial failure we reload the
    // editor from the live persisted state instead of allowing a stale-baseline retry.
    let wroteToPod = false;
    let persisted = false;
    let migratedCount = 0;
    // The trimmed workflow we persist — hoisted so the success block (below, outside
    // the pod-write try/catch) can adopt it as the new confirmed `baseline`.
    const toSave: WorkflowDef = {
      statuses: draft.statuses.map((s) => ({ ...s, label: s.label.trim() })),
      transitions: draft.transitions,
    };
    // The persistence try/catch guards ONLY the pod writes — so a throw from the
    // parent's `onSaved` (run AFTER, below) can never be misclassified as a failed
    // workflow persistence and trip the partial-save recovery (roborev job).
    try {
      // (Labels trimmed above; validation has already guaranteed no label is blank.)
      const repo = new Repository(trackerUrl);
      // Plan the migration against the FRESHEST issue data (re-read live refs here,
      // not the edit-time snapshot — closing the moved-in-after-remove race) and
      // ONLY for states removed by THIS edit (an unrelated unknown/imported status
      // is left untouched — removedStatuses, not "anything not in the new workflow").
      const liveRefs = getIssueStatusRefs ? getIssueStatusRefs() : issueStatusRefs;
      // Plan against the CONFIRMED `baseline` (the workflow the draft was derived
      // from), NOT the raw `workflow` prop — after a recovery re-read or a prior save
      // the prop can lag, and planning from it could miss a removal and strand issues.
      const removedSlugs = removedStatuses(baseline, toSave);
      const plan = planRemovalMigrations(toSave, removedSlugs, liveRefs, removalTargets);
      migratedCount = plan.reduce((n, e) => n + e.urls.length, 0);

      if (plan.length === 0) {
        // No issues to relocate → a single atomic workflow write.
        await repo.defineWorkflow(toSave);
        wroteToPod = true;
      } else {
        // Atomic removal-with-migration (compensating sequence): a partial migration
        // failure (or a closed tab) must NEVER leave an issue referencing a status
        // the persisted workflow no longer declares.
        //   1) persist an INTERMEDIATE workflow keeping the removed source columns
        //      AND the new targets — so both ends of every move exist on the pod;
        //   2) migrate the stranded issues to their targets;
        //   3) persist the FINAL workflow (dropping the now-empty source columns).
        // If a step fails after (1), the pod is left at a consistent intermediate
        // (every issue still references a declared status — no orphans). We then
        // RELOAD the editor from the live persisted state (see catch) rather than
        // retry from the stale `workflow` baseline this attempt planned from.
        const intermediate = buildIntermediateWorkflow(toSave, baseline, plan.map((e) => e.fromSlug));
        // Mark BEFORE the write: a write whose ack is lost to a network error may
        // still have COMMITTED server-side, so any failure from here on is ambiguous
        // and MUST trigger recovery (re-read), never be treated as "nothing written"
        // (roborev job). The whole multi-step sequence is therefore recovery-guarded.
        wroteToPod = true;
        await repo.defineWorkflow(intermediate);
        for (const entry of plan) await migrateIssues(entry.urls, entry.toSlug);
        await repo.defineWorkflow(toSave);
      }
      persisted = true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the workflow.");
      // If we'd already written to the pod, the persisted workflow has moved past the
      // `workflow` baseline this attempt planned from. Recover by installing a
      // CONFIRMED-FRESH baseline and LOCK the editor meanwhile, so the user cannot
      // re-save from the now-stale draft.
      if (wroteToPod) {
        // The pod may already hold the intermediate workflow (and migrated issues), so
        // the `workflow` prop baseline is stale. LOCK the editor and recover by a STRICT
        // re-read. CRITICAL: a FAILED re-read must keep the editor LOCKED (no editable
        // save) — falling back to the stale prop AND unlocking would let the user drop
        // statuses that now exist only in the persisted intermediate, orphaning the
        // migrated issues (roborev job). Unlock ONLY on a confirmed fresh re-read.
        toast.info("Saved partially — reloading the workflow from the server. Re-apply your changes once it loads.");
        await recoverFromPartialSave();
        // Parent reload (its own config/issue list). Best-effort, outside the pod-write
        // guard so a throw here is never misclassified as a failed persistence.
        try {
          onSaved?.();
        } catch {
          /* parent reload is best-effort; the editor recovery is independent */
        }
      }
    } finally {
      setBusy(false);
    }

    // Success-side effects run OUTSIDE the persistence try/catch, so a throw from the
    // parent's `onSaved` can never be mistaken for a failed pod write (roborev job).
    if (persisted) {
      setBaseline(toSave); // the persisted workflow is now the confirmed planning baseline
      setDirty(false);
      setRemovalTargets({});
      toast.success(migratedCount > 0 ? `Workflow saved; moved ${migratedCount} ${migratedCount === 1 ? "issue" : "issues"}.` : "Workflow saved.");
      try {
        onSaved?.();
      } catch {
        /* parent reload is best-effort; the save itself already succeeded */
      }
    }
  };

  // Recover from a partial save by a STRICT re-read of the persisted workflow.
  //  - SUCCESS → install the fresh workflow as the draft, clear dirty/targets, and
  //    UNLOCK (the draft now matches the persisted state, so a save is safe).
  //  - FAILURE → keep the editor LOCKED with a Reload retry (`reloadFailed`). We do
  //    NOT fall back to the stale `workflow` prop and unlock: the pod may hold the
  //    intermediate (with migrated issues), so a save from the pre-attempt baseline
  //    could drop intermediate-only statuses and orphan those issues (roborev job).
  //    The user retries the reload (or closes the dialog) before any further save.
  const recoverFromPartialSave = async (): Promise<void> => {
    setReloadPending(true); // lock
    setReloadFailed(false); // in-flight: hide the failed banner until/unless it fails again
    try {
      const fresh = await new Repository(trackerUrl).workflowStrict();
      setDraft(fresh);
      setBaseline(fresh); // the re-read is now the confirmed planning baseline
      setDirty(false);
      setRemovalTargets({});
      setReloadPending(false); // confirmed-fresh baseline → safe to edit/save again
    } catch {
      // Re-read failed: stay LOCKED (reloadPending stays true) and offer a retry.
      setReloadFailed(true);
    }
  };

  // The editor is locked while a write is in flight (`busy`) OR while a partial-save
  // recovery is unresolved (`reloadPending`) — both keep every control incl. Save
  // disabled so a stale draft can never be re-saved.
  const locked = busy || reloadPending;

  const reset = () => {
    setDraft(baseline); // discard edits back to the confirmed baseline, not the raw prop
    setDirty(false);
  };

  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <GitBranch className="size-4" aria-hidden /> Workflow
      </h3>
      <p className="text-sm text-muted-foreground">
        The statuses issues move through. The first (initial) status is where new issues start — it must be
        open. Mark closed statuses as terminal, and choose which transitions are allowed between them.
      </p>

      {/* Per-status rows: order, name, terminal flag, allowed transitions, remove. */}
      <ul className="space-y-2">
        {draft.statuses.map((s, i) => (
          <li key={s.slug} className="space-y-2 rounded-lg border px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="flex flex-col">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label={`Move ${s.label} up`}
                  disabled={locked || i === 0}
                  onClick={() => apply(moveStatus(draft, s.slug, -1))}
                >
                  <ArrowUp className="size-3.5" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label={`Move ${s.label} down`}
                  disabled={locked || i === draft.statuses.length - 1}
                  onClick={() => apply(moveStatus(draft, s.slug, 1))}
                >
                  <ArrowDown className="size-3.5" aria-hidden />
                </Button>
              </div>
              <Input
                className="h-8 flex-1"
                aria-label={`Status name for ${s.label}`}
                value={s.label}
                disabled={locked}
                onChange={(e) => apply(renameStatus(draft, s.slug, e.target.value))}
              />
              {s.slug === initialSlug && <Badge variant="outline">Initial</Badge>}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={s.terminal}
                  disabled={locked}
                  aria-label={`Mark ${s.label} as a closed (terminal) status`}
                  onCheckedChange={(c) => apply(setTerminal(draft, s.slug, c === true))}
                />
                Closed
              </label>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Remove status ${s.label}`}
                disabled={locked || draft.statuses.length <= 1}
                onClick={() => handleRemove(s.slug, s.label)}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            {/* Allowed transitions FROM this status to each other status. */}
            <div className="flex flex-wrap items-center gap-1.5 pl-7">
              <span className="text-xs text-muted-foreground">Can move to:</span>
              {draft.statuses.filter((t) => t.slug !== s.slug).length === 0 ? (
                <span className="text-xs text-muted-foreground">—</span>
              ) : (
                draft.statuses
                  .filter((t) => t.slug !== s.slug)
                  .map((t) => {
                    const on = (draft.transitions[s.slug] ?? []).includes(t.slug);
                    return (
                      <Button
                        key={t.slug}
                        type="button"
                        variant={on ? "secondary" : "outline"}
                        size="sm"
                        className="h-6 gap-1 px-2 text-xs"
                        disabled={locked}
                        aria-pressed={on}
                        aria-label={`${on ? "Disallow" : "Allow"} ${s.label} → ${t.label}`}
                        onClick={() => apply(toggleTransition(draft, s.slug, t.slug))}
                      >
                        {on && <Check className="size-3" aria-hidden />}
                        {t.label}
                      </Button>
                    );
                  })
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Add a status. */}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleAdd();
        }}
      >
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="new-status-name">New status</Label>
          <Input
            id="new-status-name"
            value={newName}
            disabled={locked}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. In Review"
          />
        </div>
        <Button type="submit" className="gap-1.5" disabled={locked || !newName.trim()}>
          <Plus className="size-4" aria-hidden /> Add status
        </Button>
      </form>

      {/* Validation problems (block saving). */}
      {problems.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          {problems.map((p) => (
            <li key={p.message} className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{p.message}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Partial-save recovery: the strict re-read failed, so the editor stays LOCKED
          (no editable save from a possibly-stale baseline after an ambiguous pod write)
          until a successful reload. */}
      {reloadFailed && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <span className="flex items-start gap-2 text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Couldn&apos;t reload the workflow after a partial save. Editing is locked until it reloads — retry,
            or close and reopen this dialog.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 shrink-0"
            disabled={busy}
            onClick={() => void recoverFromPartialSave()}
          >
            Reload from server
          </Button>
        </div>
      )}

      {dirty && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={locked} onClick={reset}>
            Discard changes
          </Button>
          <Button size="sm" className="gap-1.5" disabled={locked || !valid} onClick={() => void save()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            Save workflow
          </Button>
        </div>
      )}

      {/* In-use-state removal guard: migrate affected issues, then remove. */}
      <Dialog open={!!pendingRemoval} onOpenChange={(o) => !o && setPendingRemoval(undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>“{pendingRemoval?.label}” is in use</DialogTitle>
            <DialogDescription>
              {pendingRemoval?.affected.length === 1
                ? "1 issue is"
                : `${pendingRemoval?.affected.length} issues are`}{" "}
              currently in this status. Removing it would leave {pendingRemoval?.affected.length === 1 ? "it" : "them"}{" "}
              with no column. Choose where to move {pendingRemoval?.affected.length === 1 ? "it" : "them"} — the move
              happens when you save the workflow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="migrate-to">Move to</Label>
            <Select value={migrateTo} onValueChange={setMigrateTo}>
              <SelectTrigger id="migrate-to">
                <SelectValue placeholder="Choose a status" />
              </SelectTrigger>
              <SelectContent>
                {pendingRemoval &&
                  migrationTargets(draft, pendingRemoval.slug).map((t) => (
                    <SelectItem key={t.slug} value={t.slug}>
                      {t.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRemoval(undefined)}>
              Cancel
            </Button>
            <Button disabled={!migrateTo} onClick={confirmMigrateAndRemove}>
              Remove &amp; move on save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
