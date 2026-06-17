// AUTHORED-BY Claude Opus 4.8
import { describe, it, expect } from "vitest";
import {
  evaluateRules,
  conditionHolds,
  BUILTIN_RULE_SEEDS,
  terminalStatusOf,
  CONDITION_OPERANDS,
  MAX_CASCADE_ROUNDS,
  type RuleAction,
  type TriggerEvent,
} from "./automation-engine";
import { DEFAULT_WORKFLOW, type RuleDef, type WorkflowDef } from "./issue";
import type { IssueRecord } from "./repository";
import { odrl } from "./vocab";

const base: IssueRecord = {
  url: "",
  title: "",
  state: "open",
  status: "todo",
  issueType: "task",
  labels: [],
  components: [],
  blockedBy: [],
  relatesTo: [],
  attachments: [],
  comments: [],
  worklog: [],
  loggedSeconds: 0,
  canWrite: true,
  fields: {},
};
const mk = (p: Partial<IssueRecord>): IssueRecord => ({ ...base, ...p });
const NOW = new Date("2026-06-17T12:00:00Z");
const WF: WorkflowDef = DEFAULT_WORKFLOW;

const rule = (p: Partial<RuleDef>): RuleDef => ({
  iri: "https://pod.example/t.ttl#rule-x",
  enabled: true,
  trigger: "OnCreated",
  action: "AddComment",
  ...p,
});

describe("evaluateRules — triggers", () => {
  it("OnCreated fires only for the focus issue, and AddComment carries the value", () => {
    const issues = [mk({ url: "a", title: "A" }), mk({ url: "b", title: "B" })];
    const r = rule({ trigger: "OnCreated", action: "AddComment", actionValue: "Welcome!" });
    const actions = evaluateRules(issues, [r], { type: "OnCreated", url: "a" }, WF, NOW);
    expect(actions).toEqual([
      { ruleIri: r.iri, kind: "AddComment", url: "a", title: "A", value: "Welcome!", reason: "on create" },
    ]);
  });

  it("OnAssigned requires a non-empty assignee on the focus issue", () => {
    const r = rule({ trigger: "OnAssigned", action: "SetPriority", actionValue: "high" });
    const assigned = mk({ url: "a", title: "A", assignee: "https://alice.example/#me" });
    const unassigned = mk({ url: "a", title: "A" });
    expect(evaluateRules([assigned], [r], { type: "OnAssigned", url: "a" }, WF, NOW)).toHaveLength(1);
    expect(evaluateRules([unassigned], [r], { type: "OnAssigned", url: "a" }, WF, NOW)).toEqual([]);
  });

  it("OnStatusChange fires for the focus issue only", () => {
    const issues = [mk({ url: "a", title: "A", status: "in-progress" }), mk({ url: "b", title: "B", status: "in-progress" })];
    const r = rule({ trigger: "OnStatusChange", action: "SetPriority", actionValue: "high" });
    const actions = evaluateRules(issues, [r], { type: "OnStatusChange", url: "a" }, WF, NOW);
    expect(actions.map((a) => a.url)).toEqual(["a"]);
  });

  it("OnDueDatePassed fires on a load pass for open, past-due issues (not future/closed)", () => {
    const issues = [
      mk({ url: "late", title: "Late", dateDue: new Date("2026-06-01") }),
      mk({ url: "future", title: "Future", dateDue: new Date("2026-07-01") }),
      mk({ url: "late-closed", title: "Done", state: "closed", status: "done", dateDue: new Date("2026-06-01") }),
    ];
    const r = rule({ trigger: "OnDueDatePassed", action: "SetPriority", actionValue: "high" });
    const actions = evaluateRules(issues, [r], { type: "load" }, WF, NOW);
    expect(actions.map((a) => a.url)).toEqual(["late"]);
  });

  it("OnAllSubtasksDone fires for an open parent with ≥1 sub-task, all closed", () => {
    const issues = [
      mk({ url: "p", title: "Parent" }),
      mk({ url: "c1", parent: "p", state: "closed", status: "done" }),
      mk({ url: "c2", parent: "p", state: "closed", status: "done" }),
      mk({ url: "lonely", title: "No children" }),
      mk({ url: "p2", title: "Has open child" }),
      mk({ url: "c3", parent: "p2" }),
    ];
    const r = rule({ trigger: "OnAllSubtasksDone", action: "CloseIssue" });
    const actions = evaluateRules(issues, [r], { type: "load" }, WF, NOW);
    expect(actions.map((a) => a.url)).toEqual(["p"]);
    expect(actions[0].kind).toBe("CloseIssue");
  });

  it("a mutation-trigger rule never fires on a load pass (and vice versa)", () => {
    const r = rule({ trigger: "OnCreated", action: "AddComment", actionValue: "hi" });
    expect(evaluateRules([mk({ url: "a" })], [r], { type: "load" }, WF, NOW)).toEqual([]);
  });
});

describe("evaluateRules — conditions reuse @jeswr/solid-odrl", () => {
  it("only fires when the odrl:Constraint condition holds (priority eq)", () => {
    const r = rule({
      trigger: "OnStatusChange",
      action: "AddComment",
      actionValue: "high-priority moved",
      condition: { leftOperand: odrl("purpose"), operator: odrl("eq"), rightOperand: "high" },
    });
    const high = mk({ url: "a", title: "A", priority: "high", status: "in-progress" });
    const low = mk({ url: "a", title: "A", priority: "low", status: "in-progress" });
    expect(evaluateRules([high], [r], { type: "OnStatusChange", url: "a" }, WF, NOW)).toHaveLength(1);
    expect(evaluateRules([low], [r], { type: "OnStatusChange", url: "a" }, WF, NOW)).toEqual([]);
  });

  it("a count condition compares numerically (open sub-tasks gt 1)", () => {
    const parent = mk({ url: "p", title: "P", status: "in-progress" });
    const c1 = mk({ url: "c1", parent: "p" });
    const c2 = mk({ url: "c2", parent: "p" });
    const r = rule({
      trigger: "OnStatusChange",
      action: "SetPriority",
      actionValue: "high",
      condition: { leftOperand: odrl("count"), operator: odrl("gt"), rightOperand: "1" },
    });
    expect(evaluateRules([parent, c1, c2], [r], { type: "OnStatusChange", url: "p" }, WF, NOW)).toHaveLength(1);
    // Only one open sub-task → not > 1 → no fire.
    expect(evaluateRules([parent, c1], [r], { type: "OnStatusChange", url: "p" }, WF, NOW)).toEqual([]);
  });

  it("an unmappable left-operand fails closed (the rule does not fire)", () => {
    const r = rule({
      trigger: "OnStatusChange",
      action: "AddComment",
      actionValue: "x",
      condition: { leftOperand: odrl("spatial"), operator: odrl("eq"), rightOperand: "anything" },
    });
    expect(evaluateRules([mk({ url: "a", status: "in-progress" })], [r], { type: "OnStatusChange", url: "a" }, WF, NOW)).toEqual([]);
  });

  it("conditionHolds is true with no condition, false for an unknown operand", () => {
    const issue = mk({ priority: "high" });
    expect(conditionHolds(undefined, issue, 0, NOW)).toBe(true);
    expect(conditionHolds({ leftOperand: odrl("purpose"), operator: odrl("eq"), rightOperand: "high" }, issue, 0, NOW)).toBe(true);
    expect(conditionHolds({ leftOperand: "urn:nope", operator: odrl("eq"), rightOperand: "x" }, issue, 0, NOW)).toBe(false);
  });
});

describe("evaluateRules — guards & effectiveness", () => {
  it("skips disabled rules, read-only issues, and no-op actions", () => {
    const r = rule({ iri: "https://pod/t.ttl#rule-1", trigger: "OnCreated", action: "SetPriority", actionValue: "high" });
    // disabled
    expect(evaluateRules([mk({ url: "a" })], [{ ...r, enabled: false }], { type: "OnCreated", url: "a" }, WF, NOW)).toEqual([]);
    // read-only
    expect(evaluateRules([mk({ url: "a", canWrite: false })], [r], { type: "OnCreated", url: "a" }, WF, NOW)).toEqual([]);
    // already high → SetPriority(high) is a no-op → dropped
    expect(evaluateRules([mk({ url: "a", priority: "high" })], [r], { type: "OnCreated", url: "a" }, WF, NOW)).toEqual([]);
  });

  it("drops SetStatus to an unknown status and SetPriority with a bad value", () => {
    const badStatus = rule({ trigger: "OnCreated", action: "SetStatus", actionValue: "not-a-status" });
    const badPriority = rule({ trigger: "OnCreated", action: "SetPriority", actionValue: "urgent" });
    expect(evaluateRules([mk({ url: "a" })], [badStatus], { type: "OnCreated", url: "a" }, WF, NOW)).toEqual([]);
    expect(evaluateRules([mk({ url: "a" })], [badPriority], { type: "OnCreated", url: "a" }, WF, NOW)).toEqual([]);
  });

  it("CloseIssue is a no-op on an already-closed issue", () => {
    const r = rule({ trigger: "OnAllSubtasksDone", action: "CloseIssue" });
    const issues = [
      mk({ url: "p", title: "P", state: "closed", status: "done" }),
      mk({ url: "c", parent: "p", state: "closed", status: "done" }),
    ];
    expect(evaluateRules(issues, [r], { type: "load" }, WF, NOW)).toEqual([]);
  });
});

describe("the two migrated built-in rules (behaviour preserved)", () => {
  it("closeParentWhenChildrenDone → OnAllSubtasksDone + CloseIssue", () => {
    const r = rule({ ...BUILTIN_RULE_SEEDS[0], iri: "https://pod/t.ttl#rule-builtin-close" });
    expect(r.trigger).toBe("OnAllSubtasksDone");
    expect(r.action).toBe("CloseIssue");
    const issues = [
      mk({ url: "p", title: "Parent" }),
      mk({ url: "c1", parent: "p", state: "closed", status: "done" }),
      mk({ url: "c2", parent: "p", state: "closed", status: "done" }),
    ];
    const actions = evaluateRules(issues, [r], { type: "load" }, WF, NOW);
    expect(actions).toEqual([
      { ruleIri: r.iri, kind: "CloseIssue", url: "p", title: "Parent", value: undefined, reason: "all sub-tasks are done" },
    ]);
  });

  it("raiseOverdueToHigh → OnDueDatePassed + SetPriority(high)", () => {
    const r = rule({ ...BUILTIN_RULE_SEEDS[1], iri: "https://pod/t.ttl#rule-builtin-overdue" });
    expect(r.trigger).toBe("OnDueDatePassed");
    expect(r.action).toBe("SetPriority");
    expect(r.actionValue).toBe("high");
    const issues = [mk({ url: "late", title: "Late", dateDue: new Date("2026-06-01") })];
    const actions = evaluateRules(issues, [r], { type: "load" }, WF, NOW);
    expect(actions).toEqual([
      { ruleIri: r.iri, kind: "SetPriority", url: "late", title: "Late", value: "high", reason: "past its due date" },
    ]);
  });
});

describe("cascade bounding", () => {
  it("re-applying the same action becomes a no-op once it has taken effect (no infinite loop)", () => {
    // Simulate the caller's bounded cascade loop: apply actions, then re-evaluate.
    const r = rule({ iri: "https://pod/t.ttl#rule-c", trigger: "OnAllSubtasksDone", action: "CloseIssue" });
    let issues = [
      mk({ url: "p", title: "P" }),
      mk({ url: "c", parent: "p", state: "closed", status: "done" }),
    ];
    let rounds = 0;
    let fired: RuleAction[] = [];
    const event: TriggerEvent = { type: "load" };
    do {
      fired = evaluateRules(issues, [r], event, WF, NOW);
      // Apply: close the parent.
      issues = issues.map((i) =>
        fired.some((a) => a.url === i.url && a.kind === "CloseIssue") ? { ...i, state: "closed", status: "done" } : i,
      );
      rounds++;
    } while (fired.length > 0 && rounds < MAX_CASCADE_ROUNDS);
    // First round closes the parent; second round finds nothing (parent already closed).
    expect(rounds).toBe(2);
  });
});

describe("helpers", () => {
  it("terminalStatusOf returns the workflow's first terminal slug", () => {
    expect(terminalStatusOf(WF)).toBe("done");
  });
  it("CONDITION_OPERANDS exposes the curated issue-fact operands", () => {
    expect(CONDITION_OPERANDS.map((o) => o.fact)).toEqual(["priority", "assignee", "openSubtaskCount"]);
  });
});
