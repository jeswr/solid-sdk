// AUTHORED-BY Claude Opus 4.8
/**
 * automation-engine.ts — the client-side ECA (event-condition-action) automation
 * engine (#112 P1-3). Pods have no server-side compute, so rules run in the app
 * whenever the relevant mutation happens (a status change, an assign, a create) or
 * when fresh state is observed on load (overdue / all-subtasks-done) — the honest
 * pure-Solid translation of a Jira/Monday automation engine.
 *
 * A rule is a pod-persisted {@link RuleDef}: a {@link TriggerKind} (WHEN), an
 * optional `odrl:Constraint` condition (IF), and an {@link ActionKind} + value
 * (THEN). The condition is evaluated by the suite's `@jeswr/solid-odrl`
 * `constraintSatisfied` — solid-issues does NOT roll its own constraint evaluator.
 *
 * This module is PURE: {@link evaluateRules} derives the list of actions to take
 * from (issues, rules, a trigger event) with no I/O and an injectable `now`, so it
 * is exhaustively testable. The caller (the issues view) executes the returned
 * actions through the EXISTING repository mutation path (workflow/dep-guarded
 * status changes, ETag-safe optimistic writes), and re-runs the engine on the
 * resulting state — bounded by {@link MAX_CASCADE_ROUNDS} so a rule that re-triggers
 * itself (or a pair that ping-pong) can never loop forever.
 */
import { constraintSatisfied, type OdrlConstraint, type RequestContext } from "@jeswr/solid-odrl";
import type { IssueRecord } from "./repository";
import {
  ACTIONS,
  TRIGGERS,
  type ActionKind,
  type Priority,
  type RuleConditionDef,
  type RuleDef,
  type StatusSlug,
  type TriggerKind,
  type WorkflowDef,
} from "./issue";
import { odrl } from "./vocab";
import { statusState } from "./issue";
import { startOfUtcDay } from "./dates";

/**
 * The issue-fact left-operands a `tm:condition` can constrain, mapped to the ODRL
 * left-operand short name `@jeswr/solid-odrl`'s evaluator understands. This is the
 * curated set surfaced in the automation UI — a `tm:condition` is a real
 * `odrl:Constraint`, so its `leftOperand` is stored as an ODRL IRI; this table is
 * how the engine knows WHICH issue fact to feed the evaluator for that operand.
 *
 *  - `odrl:purpose`  ← the issue's priority slug (high/medium/low).
 *  - `odrl:recipient`← the issue's assignee WebID ("" when unassigned).
 *  - `odrl:count`    ← the issue's open (not-closed) direct sub-task count.
 *
 * A constraint whose left-operand is not in this table contributes no issue value,
 * so `constraintSatisfied` fails it closed (the rule does not fire) — we never
 * silently treat an unknown operand as satisfied.
 */
export const CONDITION_OPERANDS = [
  { iri: odrl("purpose"), operand: "purpose", label: "Priority", fact: "priority" },
  { iri: odrl("recipient"), operand: "recipient", label: "Assignee", fact: "assignee" },
  { iri: odrl("count"), operand: "count", label: "Open sub-tasks", fact: "openSubtaskCount" },
] as const;

type ConditionFact = (typeof CONDITION_OPERANDS)[number]["fact"];

const OPERAND_BY_IRI = new Map(CONDITION_OPERANDS.map((o) => [o.iri, o]));

/** Max times the engine re-runs after applying actions, before giving up (cascade bound). */
export const MAX_CASCADE_ROUNDS = 8;

/** One concrete action the engine decided to take against one issue. */
export interface RuleAction {
  /** The rule that produced this action (its IRI), for the applied-set / dedupe. */
  ruleIri: string;
  kind: ActionKind;
  url: string;
  title: string;
  /** The action parameter (status slug / priority / WebID / comment); undefined for CloseIssue. */
  value?: string;
  /** Human reason for the toast/log. */
  reason: string;
}

/** The event that drove an engine pass — which trigger to consider, and the focus issue(s). */
export type TriggerEvent =
  | { type: "load" } // periodic / on-load evaluation: OnDueDatePassed + OnAllSubtasksDone
  | { type: "OnStatusChange"; url: string }
  | { type: "OnAssigned"; url: string }
  | { type: "OnCreated"; url: string };

/** Resolve the issue fact for a condition operand to a comparable scalar. */
function factValue(fact: ConditionFact, issue: IssueRecord, openSubtaskCount: number): string | number {
  switch (fact) {
    case "priority":
      return issue.priority ?? "";
    case "assignee":
      return issue.assignee ?? "";
    case "openSubtaskCount":
      return openSubtaskCount;
  }
}

/**
 * Build the ODRL request context for evaluating ONE issue against ONE constraint.
 * Only the operand the constraint actually uses is supplied; an unknown operand
 * yields no attribute, so `constraintSatisfied` fails closed.
 */
function requestContextFor(condition: RuleConditionDef, issue: IssueRecord, openSubtaskCount: number): RequestContext {
  const mapped = OPERAND_BY_IRI.get(condition.leftOperand);
  const attributes: Record<string, string | number> = {};
  if (mapped) attributes[mapped.operand] = factValue(mapped.fact, issue, openSubtaskCount);
  // `action` is required by RequestContext but irrelevant to a bare constraint
  // check — `constraintSatisfied` only reads `attributes`.
  return { action: "use", attributes };
}

/** Map a persisted {@link RuleConditionDef} to the `@jeswr/solid-odrl` `OdrlConstraint` shape. */
function toOdrlConstraint(condition: RuleConditionDef): OdrlConstraint | undefined {
  const mapped = OPERAND_BY_IRI.get(condition.leftOperand);
  if (!mapped) return undefined; // unknown operand → no issue fact → fail closed
  const operator = condition.operator.startsWith(odrl("")) ? condition.operator.slice(odrl("").length) : condition.operator;
  // The constraint compares the issue's fact (a string/number) against the stored
  // right-operand. Numeric operands (count) parse the right-operand as a number so
  // gt/lt compare numerically rather than lexically.
  const numeric = mapped.fact === "openSubtaskCount";
  const right = numeric ? Number(condition.rightOperand) : condition.rightOperand;
  if (numeric && !Number.isFinite(right as number)) return undefined;
  return {
    leftOperand: mapped.operand as OdrlConstraint["leftOperand"],
    operator: operator as OdrlConstraint["operator"],
    rightOperand: right,
  };
}

/**
 * Whether a rule's condition holds for an issue. No condition ⇒ always true (the
 * rule applies on its trigger alone). REUSES `@jeswr/solid-odrl`'s
 * `constraintSatisfied` — the suite's ODRL constraint evaluator — rather than a
 * bespoke comparator. A condition we cannot map to an issue fact fails closed.
 */
export function conditionHolds(
  condition: RuleConditionDef | undefined,
  issue: IssueRecord,
  openSubtaskCount: number,
  now: Date,
): boolean {
  if (!condition) return true;
  const constraint = toOdrlConstraint(condition);
  if (!constraint) return false; // unmappable/invalid condition → does not fire
  return constraintSatisfied(constraint, requestContextFor(condition, issue, openSubtaskCount), now);
}

/** Count an issue's open (not-closed) direct sub-tasks within the loaded list. */
function openSubtaskCountOf(issue: IssueRecord, issues: IssueRecord[]): number {
  return issues.filter((i) => i.parent === issue.url && i.state !== "closed").length;
}

/**
 * Whether a rule's trigger fires for `issue` under `event`, given current state.
 * Trigger semantics are state-derived (so they are idempotent — the dedupe layer,
 * not re-detection, is what prevents repeated firing within a session):
 *  - OnCreated / OnAssigned / OnStatusChange: fire for the event's focus issue.
 *  - OnDueDatePassed: an open issue past its due date (load pass).
 *  - OnAllSubtasksDone: an open issue with ≥1 sub-task, all closed (load pass).
 */
function triggerFires(rule: RuleDef, issue: IssueRecord, issues: IssueRecord[], event: TriggerEvent, now: Date): boolean {
  switch (rule.trigger) {
    case "OnCreated":
      return event.type === "OnCreated" && event.url === issue.url;
    case "OnAssigned":
      return event.type === "OnAssigned" && event.url === issue.url && !!issue.assignee;
    case "OnStatusChange":
      return event.type === "OnStatusChange" && event.url === issue.url;
    case "OnDueDatePassed":
      return (
        event.type === "load" &&
        issue.state === "open" &&
        !!issue.dateDue &&
        issue.dateDue.getTime() < startOfUtcDay(now).getTime()
      );
    case "OnAllSubtasksDone": {
      if (event.type !== "load" || issue.state === "closed") return false;
      const children = issues.filter((i) => i.parent === issue.url);
      return children.length > 0 && children.every((c) => c.state === "closed");
    }
  }
}

/** A short human reason for a fired rule (for the toast/log). */
function reasonFor(rule: RuleDef): string {
  switch (rule.trigger) {
    case "OnCreated":
      return "on create";
    case "OnAssigned":
      return "on assignment";
    case "OnStatusChange":
      return "on status change";
    case "OnDueDatePassed":
      return "past its due date";
    case "OnAllSubtasksDone":
      return "all sub-tasks are done";
  }
}

/**
 * Whether applying `action` to `issue` would be a genuine change — so a rule that
 * sets a value already in place produces NO action (it cannot cascade, and it never
 * shows a spurious "automation fired" toast). This is also the second cascade
 * guard: once an action has taken effect, the same rule re-firing is a no-op.
 */
function isEffective(kind: ActionKind, value: string | undefined, issue: IssueRecord, workflow: WorkflowDef): boolean {
  switch (kind) {
    case "SetStatus":
      return !!value && workflow.statuses.some((s) => s.slug === value) && issue.status !== value;
    case "SetPriority":
      return !!value && issue.priority !== value;
    case "Assign":
      return (issue.assignee ?? "") !== (value ?? "");
    case "CloseIssue":
      return issue.state !== "closed";
    case "AddComment":
      // A comment is always "new" — but it is NOT cascade-relevant (adding a comment
      // changes no field a trigger reads), so it never loops. Require non-empty text.
      return !!value && value.trim().length > 0;
  }
}

/**
 * Evaluate the enabled rules against the current issue list for one trigger event,
 * returning the concrete actions to take. PURE — no I/O, injectable `now`. The
 * caller executes the actions and re-invokes for cascades (bounded). An action that
 * would not change anything ({@link isEffective}) is dropped, so the result is
 * exactly the set of state-changing actions.
 *
 * Rules with an unknown trigger/action (forward-compat / corrupt data) are skipped.
 */
export function evaluateRules(
  issues: IssueRecord[],
  rules: RuleDef[],
  event: TriggerEvent,
  workflow: WorkflowDef,
  now: Date = new Date(),
): RuleAction[] {
  const actions: RuleAction[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!(TRIGGERS as readonly string[]).includes(rule.trigger)) continue;
    if (!(ACTIONS as readonly string[]).includes(rule.action)) continue;
    for (const issue of issues) {
      // Only act on issues the user can write — an automation must never attempt a
      // mutation the pod will reject (mirrors the built-in-automation `canWrite` gate).
      if (!issue.canWrite) continue;
      if (!triggerFires(rule, issue, issues, event, now)) continue;
      const openSubtasks = openSubtaskCountOf(issue, issues);
      if (!conditionHolds(rule.condition, issue, openSubtasks, now)) continue;
      // SetPriority's value must be a real priority; SetStatus's a real status.
      if (rule.action === "SetPriority" && !isPriority(rule.actionValue)) continue;
      if (!isEffective(rule.action, rule.actionValue, issue, workflow)) continue;
      actions.push({
        ruleIri: rule.iri,
        kind: rule.action,
        url: issue.url,
        title: issue.title,
        value: rule.actionValue,
        reason: reasonFor(rule),
      });
    }
  }
  return actions;
}

function isPriority(value: string | undefined): value is Priority {
  return value === "high" || value === "medium" || value === "low";
}

/**
 * The two built-in automations promoted from the legacy hardcoded `automations.ts`
 * to pod-persisted, user-editable rules (#112 requirement). Behaviour is preserved:
 *  - `closeParentWhenChildrenDone` → OnAllSubtasksDone + CloseIssue.
 *  - `raiseOverdueToHigh`          → OnDueDatePassed + SetPriority(high).
 * These are seeded onto a tracker (disabled by default, matching the legacy
 * defaults) the first time the rules UI is opened, then are ordinary editable rules.
 */
export const BUILTIN_RULE_SEEDS: { trigger: TriggerKind; action: ActionKind; actionValue?: string }[] = [
  { trigger: "OnAllSubtasksDone", action: "CloseIssue" },
  { trigger: "OnDueDatePassed", action: "SetPriority", actionValue: "high" },
];

/** A status slug the engine emits for CloseIssue (the workflow's first terminal status). */
export function terminalStatusOf(workflow: WorkflowDef): StatusSlug | undefined {
  return workflow.statuses.find((s) => statusState(workflow, s.slug) === "closed")?.slug;
}
