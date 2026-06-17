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
  /** Called after a successful workflow save so the parent reloads tracker config. */
  onSaved?: () => void;
}) {
  // The editable working copy. Re-seeded whenever the loaded workflow changes
  // (a fresh dialog open / a save → reload). The loaded workflow may be the
  // deep-frozen DEFAULT_WORKFLOW, so the editor only ever holds clones (every
  // operation in workflow-editor.ts returns a fresh copy).
  const [draft, setDraft] = useState<WorkflowDef>(workflow);
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

  useEffect(() => {
    // Re-seed the editable copy whenever the loaded workflow changes (dialog open
    // / a save → reload). Both setters run synchronously in the effect body.
    /* eslint-disable react-hooks/set-state-in-effect */
    setDraft(workflow);
    setDirty(false);
    setRemovalTargets({});
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
    try {
      // Trim each label on persist (the live-edit setter stores raw input, so a
      // trailing/leading space could otherwise be saved). Validation has already
      // guaranteed no label is blank.
      const toSave: WorkflowDef = {
        statuses: draft.statuses.map((s) => ({ ...s, label: s.label.trim() })),
        transitions: draft.transitions,
      };
      const repo = new Repository(trackerUrl);
      // Plan the migration against the FRESHEST issue data (re-read live refs here,
      // not the edit-time snapshot — closing the moved-in-after-remove race) and
      // ONLY for states removed by THIS edit (an unrelated unknown/imported status
      // is left untouched — removedStatuses, not "anything not in the new workflow").
      const liveRefs = getIssueStatusRefs ? getIssueStatusRefs() : issueStatusRefs;
      const removedSlugs = removedStatuses(workflow, toSave);
      const plan = planRemovalMigrations(toSave, removedSlugs, liveRefs, removalTargets);
      const migratedCount = plan.reduce((n, e) => n + e.urls.length, 0);

      if (plan.length === 0) {
        // No issues to relocate → a single atomic workflow write.
        await repo.defineWorkflow(toSave);
      } else {
        // Atomic removal-with-migration (compensating sequence): a partial migration
        // failure (or a closed tab) must NEVER leave an issue referencing a status
        // the persisted workflow no longer declares.
        //   1) persist an INTERMEDIATE workflow keeping the removed source columns
        //      AND the new targets — so both ends of every move exist on the pod;
        //   2) migrate the stranded issues to their targets;
        //   3) persist the FINAL workflow (dropping the now-empty source columns).
        // If step 2 fails, the pod is left at the intermediate: every issue still
        // references a declared status (no orphans), the editor stays dirty, and a
        // retry re-plans against the (now partly-migrated) fresh state.
        const intermediate = buildIntermediateWorkflow(toSave, workflow, plan.map((e) => e.fromSlug));
        await repo.defineWorkflow(intermediate);
        for (const entry of plan) await migrateIssues(entry.urls, entry.toSlug);
        await repo.defineWorkflow(toSave);
      }

      setDirty(false);
      setRemovalTargets({});
      onSaved?.();
      toast.success(migratedCount > 0 ? `Workflow saved; moved ${migratedCount} ${migratedCount === 1 ? "issue" : "issues"}.` : "Workflow saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the workflow.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setDraft(workflow);
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
                  disabled={busy || i === 0}
                  onClick={() => apply(moveStatus(draft, s.slug, -1))}
                >
                  <ArrowUp className="size-3.5" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label={`Move ${s.label} down`}
                  disabled={busy || i === draft.statuses.length - 1}
                  onClick={() => apply(moveStatus(draft, s.slug, 1))}
                >
                  <ArrowDown className="size-3.5" aria-hidden />
                </Button>
              </div>
              <Input
                className="h-8 flex-1"
                aria-label={`Status name for ${s.label}`}
                value={s.label}
                disabled={busy}
                onChange={(e) => apply(renameStatus(draft, s.slug, e.target.value))}
              />
              {s.slug === initialSlug && <Badge variant="outline">Initial</Badge>}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={s.terminal}
                  disabled={busy}
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
                disabled={busy || draft.statuses.length <= 1}
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
                        disabled={busy}
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
            disabled={busy}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. In Review"
          />
        </div>
        <Button type="submit" className="gap-1.5" disabled={busy || !newName.trim()}>
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

      {dirty && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={reset}>
            Discard changes
          </Button>
          <Button size="sm" className="gap-1.5" disabled={busy || !valid} onClick={() => void save()}>
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
