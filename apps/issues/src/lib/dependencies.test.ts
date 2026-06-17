// AUTHORED-BY Claude Opus 4.8
import { describe, it, expect } from "vitest";
import {
  dependencyWarning,
  openBlockersOf,
  isGuardedTransition,
  NO_WARNING,
} from "./dependencies";
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

// The default workflow: todo (initial) → in-progress → done (terminal).
const WF = DEFAULT_WORKFLOW;

describe("dependency enforcement (#75 P1-4)", () => {
  describe("openBlockersOf", () => {
    it("reports a blocker that is OPEN", () => {
      const blocker = mk({ url: "b", title: "Blocker", status: "in-progress", state: "open" });
      const issue = mk({ url: "a", blockedBy: ["b"] });
      const open = openBlockersOf(issue, [issue, blocker]);
      expect(open).toEqual([{ url: "b", title: "Blocker", status: "in-progress" }]);
    });

    it("does NOT report a blocker that is CLOSED", () => {
      const blocker = mk({ url: "b", title: "Blocker", status: "done", state: "closed" });
      const issue = mk({ url: "a", blockedBy: ["b"] });
      expect(openBlockersOf(issue, [issue, blocker])).toEqual([]);
    });

    it("returns nothing when there are NO blockers", () => {
      const issue = mk({ url: "a" });
      expect(openBlockersOf(issue, [issue])).toEqual([]);
    });

    it("fails open: an unresolvable blocker (not in the list) is not reported", () => {
      const issue = mk({ url: "a", blockedBy: ["gone"] });
      expect(openBlockersOf(issue, [issue])).toEqual([]);
    });

    it("preserves the stored blockedBy order and reports only the open ones", () => {
      const b1 = mk({ url: "b1", title: "One", state: "open" });
      const b2 = mk({ url: "b2", title: "Two", state: "closed" });
      const b3 = mk({ url: "b3", title: "Three", state: "open" });
      const issue = mk({ url: "a", blockedBy: ["b1", "b2", "b3"] });
      const open = openBlockersOf(issue, [issue, b1, b2, b3]);
      expect(open.map((b) => b.url)).toEqual(["b1", "b3"]);
    });
  });

  describe("isGuardedTransition", () => {
    it("guards starting work (todo → in-progress)", () => {
      expect(isGuardedTransition("todo", "in-progress", WF)).toBe(true);
    });

    it("guards completing work (in-progress → done)", () => {
      expect(isGuardedTransition("in-progress", "done", WF)).toBe(true);
    });

    it("guards starting straight from todo → done", () => {
      expect(isGuardedTransition("todo", "done", WF)).toBe(true);
    });

    it("does NOT guard a no-op re-assert (same status)", () => {
      expect(isGuardedTransition("in-progress", "in-progress", WF)).toBe(false);
    });

    it("does NOT guard moving back to the initial state (un-starting / reopening)", () => {
      expect(isGuardedTransition("in-progress", "todo", WF)).toBe(false);
      expect(isGuardedTransition("done", "todo", WF)).toBe(false);
    });

    it("treats a custom workflow's terminal status as completion (no slug names)", () => {
      const custom: WorkflowDef = {
        statuses: [
          { slug: "backlog", label: "Backlog", terminal: false },
          { slug: "active", label: "Active", terminal: false },
          { slug: "shipped", label: "Shipped", terminal: true },
        ],
        transitions: { backlog: ["active"], active: ["shipped"], shipped: [] },
      };
      expect(isGuardedTransition("active", "shipped", custom)).toBe(true); // completion
      expect(isGuardedTransition("backlog", "active", custom)).toBe(true); // started
      expect(isGuardedTransition("active", "backlog", custom)).toBe(false); // back to initial
    });
  });

  describe("dependencyWarning", () => {
    it("warns (and still allows) when a guarded transition has an OPEN blocker", () => {
      const blocker = mk({ url: "b", title: "Blocker", state: "open", status: "todo" });
      const issue = mk({ url: "a", status: "todo", blockedBy: ["b"] });
      const w = dependencyWarning(issue, "in-progress", [issue, blocker], WF);
      expect(w.blocked).toBe(true);
      expect(w.blockers).toEqual([{ url: "b", title: "Blocker", status: "todo" }]);
    });

    it("does NOT warn when all blockers are CLOSED", () => {
      const blocker = mk({ url: "b", title: "Blocker", state: "closed", status: "done" });
      const issue = mk({ url: "a", status: "todo", blockedBy: ["b"] });
      expect(dependencyWarning(issue, "done", [issue, blocker], WF)).toBe(NO_WARNING);
    });

    it("does NOT warn when there are NO blockers", () => {
      const issue = mk({ url: "a", status: "todo" });
      expect(dependencyWarning(issue, "in-progress", [issue], WF)).toBe(NO_WARNING);
    });

    it("does NOT warn for a non-guarded transition even with an open blocker", () => {
      const blocker = mk({ url: "b", title: "Blocker", state: "open" });
      const issue = mk({ url: "a", status: "in-progress", blockedBy: ["b"] });
      // in-progress → todo is moving back to the initial state: not guarded.
      expect(dependencyWarning(issue, "todo", [issue, blocker], WF)).toBe(NO_WARNING);
    });
  });
});
