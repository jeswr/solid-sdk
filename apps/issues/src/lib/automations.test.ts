import { describe, it, expect } from "vitest";
import { evaluateAutomations, DEFAULT_AUTOMATIONS } from "./automations";
import type { IssueRecord } from "./repository";

const base: IssueRecord = {
  url: "",
  title: "",
  state: "open",
  status: "todo",
  issueType: "task",
  labels: [],
  blockedBy: [],
  attachments: [],
  comments: [],
  canWrite: true,
  fields: {},
};
const mk = (p: Partial<IssueRecord>): IssueRecord => ({ ...base, ...p });
const NOW = new Date("2026-06-10T12:00:00Z");
const ALL_ON = { closeParentWhenChildrenDone: true, raiseOverdueToHigh: true };

describe("evaluateAutomations", () => {
  it("does nothing when disabled", () => {
    const issues = [
      mk({ url: "p", title: "Parent" }),
      mk({ url: "c", parent: "p", status: "done", state: "closed" }),
    ];
    expect(evaluateAutomations(issues, DEFAULT_AUTOMATIONS, NOW)).toEqual([]);
  });

  it("closes a parent when every sub-task is done", () => {
    const issues = [
      mk({ url: "p", title: "Parent" }),
      mk({ url: "c1", parent: "p", status: "done", state: "closed" }),
      mk({ url: "c2", parent: "p", status: "done", state: "closed" }),
      mk({ url: "other", title: "No children" }),
    ];
    const actions = evaluateAutomations(issues, ALL_ON, NOW);
    expect(actions).toEqual([
      { kind: "set-status-done", url: "p", title: "Parent", reason: "all sub-tasks are done" },
    ]);
  });

  it("does not close a parent with an open sub-task, an already-done parent, or read-only", () => {
    const issues = [
      mk({ url: "p1", title: "Open child" }),
      mk({ url: "c1", parent: "p1" }),
      mk({ url: "p2", title: "Done already", status: "done", state: "closed" }),
      mk({ url: "c2", parent: "p2", status: "done", state: "closed" }),
      mk({ url: "p3", title: "Read-only", canWrite: false }),
      mk({ url: "c3", parent: "p3", status: "done", state: "closed" }),
    ];
    expect(evaluateAutomations(issues, ALL_ON, NOW)).toEqual([]);
  });

  it("does not escalate an issue being auto-completed in the same pass", () => {
    const issues = [
      mk({ url: "p", title: "Overdue parent", dateDue: new Date("2026-06-01") }),
      mk({ url: "c", parent: "p", status: "done", state: "closed" }),
    ];
    const actions = evaluateAutomations(issues, ALL_ON, NOW);
    expect(actions).toEqual([
      { kind: "set-status-done", url: "p", title: "Overdue parent", reason: "all sub-tasks are done" },
    ]);
  });

  it("raises open overdue issues to high (skipping done/high/no-date)", () => {
    const issues = [
      mk({ url: "late", title: "Late", dateDue: new Date("2026-06-01") }),
      mk({ url: "late-high", priority: "high", dateDue: new Date("2026-06-01") }),
      mk({ url: "late-done", status: "done", state: "closed", dateDue: new Date("2026-06-01") }),
      mk({ url: "future", dateDue: new Date("2026-07-01") }),
    ];
    const actions = evaluateAutomations(issues, ALL_ON, NOW);
    expect(actions).toEqual([
      { kind: "set-priority-high", url: "late", title: "Late", reason: "past its due date" },
    ]);
  });
});
