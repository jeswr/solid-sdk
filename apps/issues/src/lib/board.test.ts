import { describe, it, expect } from "vitest";
import {
  applyMove,
  boardColumns,
  boardIssues,
  groupOf,
  moveForColumn,
  optimisticMove,
  revertMove,
} from "./board";
import { DEFAULT_WORKFLOW, type WorkflowDef } from "./issue";
import type { IssueRecord } from "./repository";

const base: IssueRecord = {
  url: "",
  title: "",
  state: "open",
  status: "todo",
  issueType: "task",
  labels: [],
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

const wf: WorkflowDef = DEFAULT_WORKFLOW; // todo, in-progress, done(terminal)

describe("boardColumns", () => {
  it("uses the workflow statuses when grouping by status", () => {
    expect(boardColumns(wf, "status").map((c) => c.key)).toEqual(["todo", "in-progress", "done"]);
  });
  it("uses the fixed priority columns when grouping by priority", () => {
    expect(boardColumns(wf, "priority").map((c) => c.key)).toEqual(["high", "medium", "low", "none"]);
  });
});

describe("boardIssues — Done column is populated (pss-w29w)", () => {
  const todo = mk({ url: "t", status: "todo", state: "open" });
  const wip = mk({ url: "w", status: "in-progress", state: "open" });
  // A completed card: terminal status ⇒ wf:Closed (state "closed"), as the data layer couples them.
  const done = mk({ url: "d", status: "done", state: "closed" });

  it("keeps done (closed) cards visible even with the OPEN state filter", () => {
    const result = boardIssues([todo, wip, done], wf, "open").map((i) => i.url);
    expect(result).toContain("d"); // the bug: previously dropped, leaving Done empty
    expect(result).toEqual(["t", "w", "d"]);
  });

  it("shows only closed cards with the CLOSED filter", () => {
    expect(boardIssues([todo, wip, done], wf, "closed").map((i) => i.url)).toEqual(["d"]);
  });

  it("shows everything with the ALL filter", () => {
    expect(boardIssues([todo, wip, done], wf, "all").map((i) => i.url)).toEqual(["t", "w", "d"]);
  });

  it("excludes archived cards from the board", () => {
    const archived = new Set(["d"]);
    expect(boardIssues([todo, wip, done], wf, "open", archived).map((i) => i.url)).toEqual(["t", "w"]);
    // even with the ALL filter, an archived card stays off the board
    expect(boardIssues([todo, wip, done], wf, "all", archived).map((i) => i.url)).toEqual(["t", "w"]);
  });
});

describe("moveForColumn", () => {
  it("maps a status column to a status move", () => {
    expect(moveForColumn("status", "done")).toEqual({ kind: "status", status: "done" });
  });
  it("maps a priority column to a priority move; 'none' clears it", () => {
    expect(moveForColumn("priority", "high")).toEqual({ kind: "priority", priority: "high" });
    expect(moveForColumn("priority", "none")).toEqual({ kind: "priority", priority: undefined });
  });
});

describe("applyMove — keeps state coupled to a terminal status", () => {
  it("moving into a terminal column closes the issue", () => {
    const out = applyMove(mk({ status: "todo", state: "open" }), { kind: "status", status: "done" }, wf);
    expect(out.status).toBe("done");
    expect(out.state).toBe("closed");
  });
  it("moving into a non-terminal column reopens the issue", () => {
    const out = applyMove(mk({ status: "done", state: "closed" }), { kind: "status", status: "todo" }, wf);
    expect(out.status).toBe("todo");
    expect(out.state).toBe("open");
  });
  it("a priority move only changes priority", () => {
    const out = applyMove(mk({ priority: "low", status: "todo" }), { kind: "priority", priority: "high" }, wf);
    expect(out.priority).toBe("high");
    expect(out.status).toBe("todo");
  });
  it("does not mutate the input record", () => {
    const input = mk({ status: "todo", state: "open" });
    applyMove(input, { kind: "status", status: "done" }, wf);
    expect(input.status).toBe("todo");
    expect(input.state).toBe("open");
  });
});

describe("optimisticMove + revertMove", () => {
  const issues = [mk({ url: "a", status: "todo", state: "open" }), mk({ url: "b", status: "in-progress", state: "open" })];

  it("produces a new list with the moved card and returns the original", () => {
    const { next, original } = optimisticMove(issues, "a", { kind: "status", status: "done" }, "status", wf);
    expect(original?.url).toBe("a");
    expect(original?.status).toBe("todo");
    expect(next.find((i) => i.url === "a")?.status).toBe("done");
    expect(next.find((i) => i.url === "a")?.state).toBe("closed");
    // unrelated card untouched
    expect(next.find((i) => i.url === "b")?.status).toBe("in-progress");
  });

  it("is a no-op when the grouped value does not change (same column drop)", () => {
    const { next, original } = optimisticMove(issues, "a", { kind: "status", status: "todo" }, "status", wf);
    expect(original).toBeUndefined();
    expect(next).toBe(issues); // same reference — nothing changed, no spurious "Saving…"
  });

  it("is a no-op for an unknown url", () => {
    const { next, original } = optimisticMove(issues, "missing", { kind: "status", status: "done" }, "status", wf);
    expect(original).toBeUndefined();
    expect(next).toBe(issues);
  });

  it("revertMove restores the original record (revert-on-error)", () => {
    const { next, original } = optimisticMove(issues, "a", { kind: "status", status: "done" }, "status", wf);
    const reverted = revertMove(next, original!);
    expect(reverted.find((i) => i.url === "a")?.status).toBe("todo");
    expect(reverted.find((i) => i.url === "a")?.state).toBe("open");
  });

  it("groupOf reflects the active grouping", () => {
    expect(groupOf(mk({ status: "done", priority: "high" }), "status")).toBe("done");
    expect(groupOf(mk({ status: "done", priority: "high" }), "priority")).toBe("high");
    expect(groupOf(mk({ status: "done" }), "priority")).toBe("none");
  });
});
