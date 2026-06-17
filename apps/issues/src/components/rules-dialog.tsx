// AUTHORED-BY Claude Opus 4.8
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { OPERATOR_IRI } from "@jeswr/solid-odrl";
import { Repository } from "@/lib/repository";
import {
  ACTIONS,
  PRIORITIES,
  TRIGGERS,
  type ActionKind,
  type RuleConditionDef,
  type RuleDef,
  type TriggerKind,
  type WorkflowStatus,
} from "@/lib/issue";
import { BUILTIN_RULE_SEEDS, CONDITION_OPERANDS } from "@/lib/automation-engine";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, X, Zap } from "lucide-react";

/** Human labels for the trigger coded values. */
const TRIGGER_LABELS: Record<TriggerKind, string> = {
  OnStatusChange: "When status changes",
  OnDueDatePassed: "When the due date passes",
  OnAllSubtasksDone: "When all sub-tasks are done",
  OnAssigned: "When assigned",
  OnCreated: "When created",
};

/** Human labels for the action coded values. */
const ACTION_LABELS: Record<ActionKind, string> = {
  SetStatus: "Set status",
  SetPriority: "Set priority",
  Assign: "Assign to",
  AddComment: "Add a comment",
  CloseIssue: "Close the issue",
};

/** The operators the condition UI offers (a curated ODRL subset). */
const CONDITION_OPERATORS: { value: string; label: string }[] = [
  { value: OPERATOR_IRI.eq, label: "is" },
  { value: OPERATOR_IRI.neq, label: "is not" },
  { value: OPERATOR_IRI.gt, label: "is greater than" },
  { value: OPERATOR_IRI.gteq, label: "is at least" },
  { value: OPERATOR_IRI.lt, label: "is less than" },
  { value: OPERATOR_IRI.lteq, label: "is at most" },
];

const NO_CONDITION = "__none__";

/** A blank draft for the "add rule" form. */
interface RuleDraft {
  trigger: TriggerKind;
  action: ActionKind;
  actionValue: string;
  /** The condition left-operand IRI, or NO_CONDITION for no condition. */
  conditionOperand: string;
  conditionOperator: string;
  conditionValue: string;
}

const BLANK_DRAFT: RuleDraft = {
  trigger: "OnStatusChange",
  action: "SetPriority",
  actionValue: "high",
  conditionOperand: NO_CONDITION,
  conditionOperator: OPERATOR_IRI.eq,
  conditionValue: "",
};

/** Build the persisted {@link RuleConditionDef} from a draft, or undefined. */
function draftCondition(d: RuleDraft): RuleConditionDef | undefined {
  if (d.conditionOperand === NO_CONDITION) return undefined;
  if (d.conditionValue.trim() === "") return undefined;
  return {
    leftOperand: d.conditionOperand,
    operator: d.conditionOperator,
    rightOperand: d.conditionValue.trim(),
  };
}

/**
 * Manage the tracker's pod-persisted automation rules (#112 P1-3). Each rule is a
 * `tm:Rule` (trigger + optional `odrl:Constraint` condition + action). On first
 * open the two legacy built-in automations are SEEDED (disabled) so they become
 * ordinary editable rules. The action parameter input adapts to the action:
 * a status select, a priority select, a team-member assignee select, or free text.
 */
export function RulesDialog({
  open,
  onOpenChange,
  trackerUrl,
  statuses,
  teamMembers,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackerUrl: string;
  statuses: WorkflowStatus[];
  teamMembers: string[];
  onSaved?: () => void;
}) {
  const [rules, setRules] = useState<RuleDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<RuleDraft>(BLANK_DRAFT);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const repo = new Repository(trackerUrl);
    repo
      .rules()
      .then(async (existing) => {
        if (cancelled) return;
        // Seed the two migrated built-ins ONCE (when no rule exists yet), disabled
        // by default — preserving the legacy off-by-default behaviour. They are
        // then ordinary editable rules.
        if (existing.length === 0) {
          for (const seed of BUILTIN_RULE_SEEDS) {
            await repo.defineRule({ enabled: false, trigger: seed.trigger, action: seed.action, actionValue: seed.actionValue });
          }
          const seeded = await repo.rules();
          if (!cancelled) setRules(seeded);
        } else {
          setRules(existing);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, trackerUrl]);

  const reload = async () => {
    setRules(await new Repository(trackerUrl).rules());
    onSaved?.();
  };

  const toggle = async (rule: RuleDef, enabled: boolean) => {
    setBusy(true);
    try {
      await new Repository(trackerUrl).defineRule({ ...rule, enabled });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the rule.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (iri: string) => {
    setBusy(true);
    try {
      await new Repository(trackerUrl).removeRule(iri);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the rule.");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    // Validate the action value against the action.
    const value = draft.action === "CloseIssue" ? undefined : draft.actionValue.trim();
    if (draft.action !== "CloseIssue" && !value) {
      toast.error("This action needs a value.");
      return;
    }
    const condition = draftCondition(draft);
    if (draft.conditionOperand !== NO_CONDITION && !condition) {
      toast.error("The condition needs a value.");
      return;
    }
    setBusy(true);
    try {
      await new Repository(trackerUrl).defineRule({
        enabled: true,
        trigger: draft.trigger,
        action: draft.action,
        actionValue: value,
        condition,
      });
      setDraft(BLANK_DRAFT);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the rule.");
    } finally {
      setBusy(false);
    }
  };

  // The action-value input adapts to the chosen action.
  const actionValueControl = (
    <ActionValueInput
      action={draft.action}
      value={draft.actionValue}
      statuses={statuses}
      teamMembers={teamMembers}
      onChange={(v) => setDraft((d) => ({ ...d, actionValue: v }))}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-4 text-primary" aria-hidden /> Automations
          </DialogTitle>
          <DialogDescription>
            Rules run in the app, against issues you can edit. Each rule fires on a trigger, optionally
            checks a condition, then performs an action. Saved to the project, so they follow you across
            devices and apply for everyone who can edit it.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading rules" />
          </div>
        ) : rules.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No automation rules yet.</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((r) => (
              <li key={r.iri} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <Switch
                  checked={r.enabled}
                  disabled={busy}
                  aria-label={`Enable rule: ${describeRule(r, statuses)}`}
                  onCheckedChange={(v) => void toggle(r, v)}
                />
                <span className="min-w-0 flex-1 text-sm">{describeRule(r, statuses)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Remove rule"
                  disabled={busy}
                  onClick={() => void remove(r.iri)}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="space-y-3 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <h3 className="text-sm font-semibold">New rule</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rule-trigger">When</Label>
              <Select value={draft.trigger} onValueChange={(v) => setDraft((d) => ({ ...d, trigger: v as TriggerKind }))}>
                <SelectTrigger id="rule-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TRIGGER_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-action">Then</Label>
              <Select
                value={draft.action}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, action: v as ActionKind, actionValue: defaultActionValue(v as ActionKind) }))
                }
              >
                <SelectTrigger id="rule-action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {ACTION_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* The action value (none for CloseIssue). */}
          {draft.action !== "CloseIssue" && (
            <div className="space-y-1.5">
              <Label>{ACTION_LABELS[draft.action]}</Label>
              {actionValueControl}
            </div>
          )}

          {/* Optional ODRL condition. */}
          <fieldset className="space-y-2 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Condition (optional)</legend>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
              <Select
                value={draft.conditionOperand}
                onValueChange={(v) => setDraft((d) => ({ ...d, conditionOperand: v }))}
              >
                <SelectTrigger aria-label="Condition field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CONDITION}>Always</SelectItem>
                  {CONDITION_OPERANDS.map((o) => (
                    <SelectItem key={o.iri} value={o.iri}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={draft.conditionOperator}
                onValueChange={(v) => setDraft((d) => ({ ...d, conditionOperator: v }))}
                disabled={draft.conditionOperand === NO_CONDITION}
              >
                <SelectTrigger aria-label="Condition operator">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_OPERATORS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Condition value"
                placeholder="value"
                value={draft.conditionValue}
                disabled={draft.conditionOperand === NO_CONDITION}
                onChange={(e) => setDraft((d) => ({ ...d, conditionValue: e.target.value }))}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Evaluated with the ODRL constraint evaluator. e.g. Priority is high, or Open sub-tasks is at
              least 2.
            </p>
          </fieldset>

          <Button type="submit" className="gap-1.5" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            Add rule
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The default action value when an action is first chosen. */
function defaultActionValue(action: ActionKind): string {
  switch (action) {
    case "SetPriority":
      return "high";
    case "SetStatus":
    case "Assign":
    case "AddComment":
    case "CloseIssue":
      return "";
  }
}

/** The action-value control, adapting to the action (status / priority / assignee / text). */
function ActionValueInput({
  action,
  value,
  statuses,
  teamMembers,
  onChange,
}: {
  action: ActionKind;
  value: string;
  statuses: WorkflowStatus[];
  teamMembers: string[];
  onChange: (value: string) => void;
}) {
  if (action === "SetStatus") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label="Target status">
          <SelectValue placeholder="Choose a status" />
        </SelectTrigger>
        <SelectContent>
          {statuses.map((s) => (
            <SelectItem key={s.slug} value={s.slug}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (action === "SetPriority") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label="Target priority">
          <SelectValue placeholder="Choose a priority" />
        </SelectTrigger>
        <SelectContent>
          {PRIORITIES.map((p) => (
            <SelectItem key={p} value={p} className="capitalize">
              {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (action === "Assign" && teamMembers.length > 0) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label="Assignee">
          <SelectValue placeholder="Choose a team member" />
        </SelectTrigger>
        <SelectContent>
          {teamMembers.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  // Assign with no team list → free WebID; AddComment → free text.
  return (
    <Input
      aria-label={action === "Assign" ? "Assignee WebID" : "Comment text"}
      placeholder={action === "Assign" ? "https://…/profile/card#me" : "Comment to add"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** A one-line human description of a rule for the list. */
function describeRule(rule: RuleDef, statuses: WorkflowStatus[]): string {
  const statusLabel = (slug: string | undefined) => statuses.find((s) => s.slug === slug)?.label ?? slug;
  const operandLabel = (iri: string) => CONDITION_OPERANDS.find((o) => o.iri === iri)?.label ?? iri;
  let actionText: string;
  switch (rule.action) {
    case "SetStatus":
      actionText = `set status to ${statusLabel(rule.actionValue)}`;
      break;
    case "SetPriority":
      actionText = `set priority to ${rule.actionValue}`;
      break;
    case "Assign":
      actionText = `assign to ${rule.actionValue}`;
      break;
    case "AddComment":
      actionText = "add a comment";
      break;
    case "CloseIssue":
      actionText = "close the issue";
      break;
  }
  const cond = rule.condition ? ` if ${operandLabel(rule.condition.leftOperand)} matches “${rule.condition.rightOperand}”,` : "";
  return `${TRIGGER_LABELS[rule.trigger]},${cond} ${actionText}.`;
}
