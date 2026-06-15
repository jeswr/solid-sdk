import { describe, it, expect } from "vitest";
import {
  applyMove,
  boardColumns,
  boardIssues,
  groupOf,
  moveForColumn,
  optimisticMove,
  revertMove,
  revertMoveIfCurrent,
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

  it("keeps done (closed) cards visible even with the OPEN state filter (status grouping)", () => {
    const result = boardIssues([todo, wip, done], wf, "open", "status").map((i) => i.url);
    expect(result).toContain("d"); // the bug: previously dropped, leaving Done empty
    expect(result).toEqual(["t", "w", "d"]);
  });

  it("shows only closed cards with the CLOSED filter", () => {
    expect(boardIssues([todo, wip, done], wf, "closed", "status").map((i) => i.url)).toEqual(["d"]);
  });

  it("shows everything with the ALL filter", () => {
    expect(boardIssues([todo, wip, done], wf, "all", "status").map((i) => i.url)).toEqual(["t", "w", "d"]);
  });

  it("excludes archived cards from the board", () => {
    const archived = new Set(["d"]);
    expect(boardIssues([todo, wip, done], wf, "open", "status", archived).map((i) => i.url)).toEqual(["t", "w"]);
    // even with the ALL filter, an archived card stays off the board
    expect(boardIssues([todo, wip, done], wf, "all", "status", archived).map((i) => i.url)).toEqual(["t", "w"]);
  });
});

describe("boardIssues — terminal-visible exception is status-grouping only", () => {
  const todo = mk({ url: "t", status: "todo", state: "open", priority: "high" });
  const wip = mk({ url: "w", status: "in-progress", state: "open", priority: "medium" });
  // A Done (closed) card that still carries a priority.
  const done = mk({ url: "d", status: "done", state: "closed", priority: "high" });

  it("priority grouping + OPEN filter DROPS closed Done cards (no Done column to keep them)", () => {
    // The bug: a priority-grouped board showed the closed Done card inside the
    // High priority column. With groupBy honoured, the open filter excludes it.
    const result = boardIssues([todo, wip, done], wf, "open", "priority").map((i) => i.url);
    expect(result).toEqual(["t", "w"]);
    expect(result).not.toContain("d");
  });

  it("priority grouping still shows closed cards under the CLOSED / ALL filters", () => {
    expect(boardIssues([todo, wip, done], wf, "closed", "priority").map((i) => i.url)).toEqual(["d"]);
    expect(boardIssues([todo, wip, done], wf, "all", "priority").map((i) => i.url)).toEqual(["t", "w", "d"]);
  });

  it("status grouping (same data) DOES keep the Done card on the OPEN filter", () => {
    expect(boardIssues([todo, wip, done], wf, "open", "status").map((i) => i.url)).toEqual(["t", "w", "d"]);
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

describe("revertMoveIfCurrent — a stale failure never clobbers a newer move", () => {
  const move = (status: string) => ({ kind: "status", status } as const);

  it("reverts when the card still sits at the failed move's optimistic state", () => {
    // Move A: todo → in-progress, optimistic applied, save then fails.
    const original = mk({ url: "a", status: "todo", state: "open" });
    const optimistic = applyMove(original, move("in-progress"), wf); // status in-progress
    const list = [optimistic, mk({ url: "b", status: "todo", state: "open" })];
    const reverted = revertMoveIfCurrent(list, original, optimistic, move("in-progress"));
    expect(reverted.find((i) => i.url === "a")?.status).toBe("todo"); // rolled back
  });

  it("move A→B (pending), move B→C, then A→B's save fails → card stays at C", () => {
    // First move: todo (A) → in-progress (B). Its save is in flight.
    const original = mk({ url: "card", status: "todo", state: "open" });
    const optimisticB = applyMove(original, move("in-progress"), wf);
    // While pending, the user moves the SAME card B → done (C). Current list has C.
    const optimisticC = applyMove(optimisticB, move("done"), wf);
    const list = [optimisticC];
    // Now the FIRST move's save fails. The stale revert must NOT pull the card back.
    const result = revertMoveIfCurrent(list, original, optimisticB, move("in-progress"));
    expect(result).toBe(list); // unchanged — newer move owns the state
    expect(result.find((i) => i.url === "card")?.status).toBe("done"); // stays at C
  });

  it("does nothing when the card has been removed from the list", () => {
    const original = mk({ url: "gone", status: "todo", state: "open" });
    const optimistic = applyMove(original, move("done"), wf);
    const list = [mk({ url: "other", status: "todo", state: "open" })];
    expect(revertMoveIfCurrent(list, original, optimistic, move("done"))).toBe(list);
  });

  it("guards priority moves on the priority dimension", () => {
    const original = mk({ url: "p", priority: "low", status: "todo" });
    const optimisticHigh = applyMove(original, { kind: "priority", priority: "high" }, wf);
    // A newer priority move to medium supersedes the pending high move.
    const optimisticMedium = applyMove(optimisticHigh, { kind: "priority", priority: "medium" }, wf);
    const list = [optimisticMedium];
    const result = revertMoveIfCurrent(list, original, optimisticHigh, { kind: "priority", priority: "high" });
    expect(result).toBe(list); // stale failure dropped
    expect(result[0].priority).toBe("medium");
    // But if it still sits at high, the revert applies.
    const stillHigh = [optimisticHigh];
    const reverted = revertMoveIfCurrent(stillHigh, original, optimisticHigh, { kind: "priority", priority: "high" });
    expect(reverted[0].priority).toBe("low");
  });

  it("reverts ONLY the status dimension — a concurrent title edit is preserved", () => {
    // Move A: todo → in-progress, save in flight.
    const original = mk({ url: "a", title: "Old title", status: "todo", state: "open" });
    const optimistic = applyMove(original, move("in-progress"), wf); // status in-progress, title unchanged
    // While the move's write was pending, the user renamed the SAME card. The
    // current local record has the new title but still the optimistic status.
    const edited = { ...optimistic, title: "New title" };
    const list = [edited, mk({ url: "b", status: "todo", state: "open" })];
    const reverted = revertMoveIfCurrent(list, original, optimistic, move("in-progress"));
    const card = reverted.find((i) => i.url === "a");
    expect(card?.status).toBe("todo"); // status rolled back to original
    expect(card?.state).toBe("open"); // state rolled back too
    expect(card?.title).toBe("New title"); // the concurrent edit survives
  });

  it("reverts ONLY the priority dimension — a concurrent assignee edit is preserved", () => {
    const original = mk({ url: "p", priority: "low", status: "todo", assignee: "alice" });
    const optimisticHigh = applyMove(original, { kind: "priority", priority: "high" }, wf);
    // Concurrent edit: reassigned while the priority write was pending.
    const edited = { ...optimisticHigh, assignee: "bob" };
    const list = [edited];
    const reverted = revertMoveIfCurrent(list, original, optimisticHigh, { kind: "priority", priority: "high" });
    expect(reverted[0].priority).toBe("low"); // priority rolled back
    expect(reverted[0].status).toBe("todo"); // status untouched by a priority revert
    expect(reverted[0].assignee).toBe("bob"); // the concurrent reassignment survives
  });
});
