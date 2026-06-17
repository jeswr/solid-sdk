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
 * Validation (save is disabled while any problem stands): ≥1 initial (non-terminal)
 * state + ≥1 terminal state + no transition referencing a removed state.
 *
 * In-use-state guard: removing a state that issues are currently IN is BLOCKED — the
 * editor surfaces a migrate-and-remove dialog that moves those issues to another
 * state FIRST (via the parent's `migrateIssues`, which routes through the same
 * workflow-validated `setStatus` batch the bulk toolbar uses), so issues are never
 * silently orphaned onto a `#status-` class no longer in the workflow.
 */
export function WorkflowEditorSection({
  trackerUrl,
  workflow,
  issueStatusRefs,
  migrateIssues,
  onSaved,
}: {
  trackerUrl: string;
  /** The loaded workflow (the editor seeds its editable copy from this). */
  workflow: WorkflowDef;
  /** Live status of each issue in the tracker — the in-use-state guard's source. */
  issueStatusRefs: IssueStatusRef[];
  /**
   * Migrate the given issues to a target status, via the parent's
   * workflow-validated `setStatus` batch (so the move honours the SAME validation +
   * ETag-safe write the bulk toolbar uses). Resolves when all have moved.
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

  useEffect(() => {
    // Re-seed the editable copy whenever the loaded workflow changes (dialog open
    // / a save → reload). Both setters run synchronously in the effect body.
    /* eslint-disable react-hooks/set-state-in-effect */
    setDraft(workflow);
    setDirty(false);
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

  // Removing a status: if issues are currently in it, BLOCK and open the
  // migrate-and-remove dialog; otherwise remove immediately.
  const handleRemove = (slug: string, label: string) => {
    const affected = issuesInState(issueStatusRefs, slug);
    if (affected.length > 0) {
      const targets = migrationTargets(draft, slug);
      setMigrateTo(targets[0]?.slug ?? "");
      setPendingRemoval({ slug, label, affected });
      return;
    }
    apply(removeStatus(draft, slug));
  };

  // Confirm the migrate-and-remove: move the affected issues to `migrateTo` in the
  // pod FIRST (so nothing is orphaned), then drop the state from the draft. The
  // migration target must be a status that survives the removal.
  const confirmMigrateAndRemove = async () => {
    const pending = pendingRemoval;
    if (!pending || !migrateTo) return;
    setBusy(true);
    try {
      await migrateIssues(pending.affected.map((i) => i.url), migrateTo);
      apply(removeStatus(draft, pending.slug));
      setPendingRemoval(undefined);
      toast.success(`Moved ${pending.affected.length} ${pending.affected.length === 1 ? "issue" : "issues"} and removed “${pending.label}”.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not migrate the issues.");
    } finally {
      setBusy(false);
    }
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
      await new Repository(trackerUrl).defineWorkflow(toSave);
      setDirty(false);
      onSaved?.();
      toast.success("Workflow saved.");
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
              with no column. Move {pendingRemoval?.affected.length === 1 ? "it" : "them"} to another status first.
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
            <Button variant="outline" disabled={busy} onClick={() => setPendingRemoval(undefined)}>
              Cancel
            </Button>
            <Button disabled={busy || !migrateTo} className="gap-1.5" onClick={() => void confirmMigrateAndRemove()}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Move &amp; remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
