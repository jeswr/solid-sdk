// AUTHORED-BY Claude Opus 4.8
//
// Tests for the pure workflow-editor model (#75 P2-5): every editing operation
// (add / rename / remove / reorder / set-terminal / toggle-transition /
// set-initial), the validation rules (≥1 initial non-terminal + ≥1 terminal +
// no removed-state references), and the in-use-state removal guard.

import { describe, it, expect } from "vitest";
import type { WorkflowDef } from "./issue";
import { DEFAULT_WORKFLOW } from "./issue";
import {
  addStatus,
  renameStatus,
  removeStatus,
  setTerminal,
  toggleTransition,
  setInitialStatus,
  moveStatus,
  initialStatus,
  statusSlug,
  cloneWorkflow,
  validateWorkflow,
  isWorkflowValid,
  issuesInState,
  migrationTargets,
  planRemovalMigrations,
  removedStatuses,
  buildIntermediateWorkflow,
} from "./workflow-editor";

/** A custom 4-state workflow with a directed transition graph. */
const CUSTOM: WorkflowDef = {
  statuses: [
    { slug: "backlog", label: "Backlog", terminal: false },
    { slug: "doing", label: "Doing", terminal: false },
    { slug: "review", label: "In Review", terminal: false },
    { slug: "shipped", label: "Shipped", terminal: true },
  ],
  transitions: { backlog: ["doing"], doing: ["review", "backlog"], review: ["shipped", "doing"], shipped: [] },
};

describe("workflow-editor: slugging", () => {
  it("slugifies a display name", () => {
    expect(statusSlug("In Review")).toBe("in-review");
    expect(statusSlug("  Done!  ")).toBe("done");
    expect(statusSlug("QA / Testing")).toBe("qa-testing");
  });
});

describe("workflow-editor: cloneWorkflow", () => {
  it("returns a deep copy that does not alias the input (DEFAULT_WORKFLOW is frozen)", () => {
    const copy = cloneWorkflow(DEFAULT_WORKFLOW);
    expect(copy).toEqual(DEFAULT_WORKFLOW);
    expect(copy.statuses).not.toBe(DEFAULT_WORKFLOW.statuses);
    expect(copy.statuses[0]).not.toBe(DEFAULT_WORKFLOW.statuses[0]);
    // Mutating the copy never touches the (frozen) original.
    copy.statuses[0].label = "Changed";
    expect(DEFAULT_WORKFLOW.statuses[0].label).not.toBe("Changed");
  });

  it("never mutates the input through an operation (frozen DEFAULT_WORKFLOW is safe)", () => {
    const before = JSON.stringify(DEFAULT_WORKFLOW);
    addStatus(DEFAULT_WORKFLOW, "Blocked");
    setTerminal(DEFAULT_WORKFLOW, "todo", true);
    removeStatus(DEFAULT_WORKFLOW, "in-progress");
    expect(JSON.stringify(DEFAULT_WORKFLOW)).toBe(before);
  });
});

describe("workflow-editor: addStatus", () => {
  it("appends a non-terminal status with an empty transition set (never the initial state)", () => {
    const next = addStatus(CUSTOM, "Blocked");
    expect(next.statuses.map((s) => s.slug)).toEqual(["backlog", "doing", "review", "shipped", "blocked"]);
    const added = next.statuses.find((s) => s.slug === "blocked")!;
    expect(added).toEqual({ slug: "blocked", label: "Blocked", terminal: false });
    expect(next.transitions["blocked"]).toEqual([]);
    // Initial state is unchanged.
    expect(initialStatus(next)?.slug).toBe("backlog");
  });

  it("rejects a blank name and a slug collision", () => {
    expect(() => addStatus(CUSTOM, "   ")).toThrow(/name/i);
    expect(() => addStatus(CUSTOM, "!!!")).toThrow(/letter or number/i);
    expect(() => addStatus(CUSTOM, "Backlog")).toThrow(/already exists/i);
    // A different-cased / extra-punctuation label that slugs to an existing slug
    // also collides (both → "backlog").
    expect(() => addStatus(CUSTOM, "  BACKLOG!  ")).toThrow(/already exists/i);
  });
});

describe("workflow-editor: renameStatus", () => {
  it("changes the label but NEVER the slug (so issues' #status- classes stay valid)", () => {
    const next = renameStatus(CUSTOM, "review", "Code Review");
    const status = next.statuses.find((s) => s.slug === "review")!;
    expect(status.label).toBe("Code Review");
    expect(status.slug).toBe("review"); // slug identity preserved
    // The transition graph (keyed by slug) is unchanged.
    expect(next.transitions["review"].sort()).toEqual(["doing", "shipped"]);
  });

  it("never throws on a blank label mid-edit (stores it; validation blocks save)", () => {
    // The rename setter is driven from an input's onChange — backspacing to empty
    // must NOT throw (roborev finding). The blank is stored and caught by validation.
    const cleared = renameStatus(CUSTOM, "review", "");
    expect(cleared.statuses.find((s) => s.slug === "review")?.label).toBe("");
    expect(validateWorkflow(cleared).some((p) => /every status needs a name/i.test(p.message))).toBe(true);
    expect(isWorkflowValid(cleared)).toBe(false);
    // Re-typing a name clears the problem.
    const retyped = renameStatus(cleared, "review", "Reviewing");
    expect(retyped.statuses.find((s) => s.slug === "review")?.label).toBe("Reviewing");
    expect(isWorkflowValid(retyped)).toBe(true);
  });

  it("no-ops an unknown slug", () => {
    expect(renameStatus(CUSTOM, "nope", "X")).toEqual(CUSTOM);
  });
});

describe("workflow-editor: removeStatus", () => {
  it("drops the status and prunes every edge referencing it (no removed-state references)", () => {
    const next = removeStatus(CUSTOM, "doing");
    expect(next.statuses.map((s) => s.slug)).toEqual(["backlog", "review", "shipped"]);
    expect(next.transitions["doing"]).toBeUndefined();
    // backlog → doing pruned; review → doing pruned; review → shipped kept.
    expect(next.transitions["backlog"]).toEqual([]);
    expect(next.transitions["review"]).toEqual(["shipped"]);
    // The resulting workflow references no removed state.
    expect(validateWorkflow(next).some((p) => /removed status/i.test(p.message))).toBe(false);
  });
});

describe("workflow-editor: setTerminal", () => {
  it("flips a status' open/closed disposition", () => {
    const next = setTerminal(CUSTOM, "review", true);
    expect(next.statuses.find((s) => s.slug === "review")?.terminal).toBe(true);
    const back = setTerminal(next, "review", false);
    expect(back.statuses.find((s) => s.slug === "review")?.terminal).toBe(false);
  });
});

describe("workflow-editor: toggleTransition", () => {
  it("adds then removes an edge", () => {
    const added = toggleTransition(CUSTOM, "backlog", "review");
    expect(added.transitions["backlog"].sort()).toEqual(["doing", "review"]);
    const removed = toggleTransition(added, "backlog", "review");
    expect(removed.transitions["backlog"]).toEqual(["doing"]);
  });

  it("ignores a self-edge and an edge to/from an unknown status", () => {
    expect(toggleTransition(CUSTOM, "backlog", "backlog")).toEqual(CUSTOM);
    expect(toggleTransition(CUSTOM, "backlog", "ghost")).toEqual(CUSTOM);
    expect(toggleTransition(CUSTOM, "ghost", "backlog")).toEqual(CUSTOM);
  });
});

describe("workflow-editor: setInitialStatus / moveStatus", () => {
  it("moves a status to the front to make it the initial state", () => {
    const next = setInitialStatus(CUSTOM, "doing");
    expect(next.statuses.map((s) => s.slug)).toEqual(["doing", "backlog", "review", "shipped"]);
    expect(initialStatus(next)?.slug).toBe("doing");
    // No-op for the already-initial status / an unknown slug.
    expect(setInitialStatus(CUSTOM, "backlog")).toEqual(CUSTOM);
    expect(setInitialStatus(CUSTOM, "nope")).toEqual(CUSTOM);
  });

  it("reorders a status up/down, clamping at the ends", () => {
    const down = moveStatus(CUSTOM, "backlog", 1);
    expect(down.statuses.map((s) => s.slug)).toEqual(["doing", "backlog", "review", "shipped"]);
    const up = moveStatus(CUSTOM, "shipped", -1);
    expect(up.statuses.map((s) => s.slug)).toEqual(["backlog", "doing", "shipped", "review"]);
    // Past either end is a no-op.
    expect(moveStatus(CUSTOM, "backlog", -1)).toEqual(CUSTOM);
    expect(moveStatus(CUSTOM, "shipped", 1)).toEqual(CUSTOM);
  });
});

describe("workflow-editor: validateWorkflow", () => {
  it("accepts a well-formed workflow", () => {
    expect(validateWorkflow(CUSTOM)).toEqual([]);
    expect(isWorkflowValid(CUSTOM)).toBe(true);
    expect(isWorkflowValid(DEFAULT_WORKFLOW)).toBe(true);
  });

  it("requires at least one status", () => {
    const empty: WorkflowDef = { statuses: [], transitions: {} };
    expect(validateWorkflow(empty)).toHaveLength(1);
    expect(validateWorkflow(empty)[0].message).toMatch(/at least one status/i);
  });

  it("requires the initial (first) state to be non-terminal", () => {
    // Make the only path start terminal: a single terminal status, or a terminal first.
    const terminalFirst = setTerminal(CUSTOM, "backlog", true);
    const problems = validateWorkflow(terminalFirst);
    expect(problems.some((p) => /initial state/i.test(p.message))).toBe(true);
    expect(isWorkflowValid(terminalFirst)).toBe(false);
  });

  it("requires at least one terminal state", () => {
    const noTerminal = setTerminal(CUSTOM, "shipped", false);
    const problems = validateWorkflow(noTerminal);
    expect(problems.some((p) => /closed \(terminal\)/i.test(p.message))).toBe(true);
    expect(isWorkflowValid(noTerminal)).toBe(false);
  });

  it("flags a transition referencing a status that is not declared", () => {
    // Hand-craft a stale edge (removeStatus would normally prune it).
    const stale: WorkflowDef = {
      statuses: [
        { slug: "open", label: "Open", terminal: false },
        { slug: "done", label: "Done", terminal: true },
      ],
      transitions: { open: ["done", "ghost"], done: [] },
    };
    const problems = validateWorkflow(stale);
    expect(problems.some((p) => /removed status “ghost”/i.test(p.message))).toBe(true);
    expect(isWorkflowValid(stale)).toBe(false);
  });

  it("an add/remove round-trip stays valid", () => {
    const added = addStatus(CUSTOM, "Blocked");
    expect(isWorkflowValid(added)).toBe(true); // initial still backlog (open), shipped still terminal
    const removed = removeStatus(added, "blocked");
    expect(removed).toEqual(CUSTOM);
    expect(isWorkflowValid(removed)).toBe(true);
  });
});

describe("workflow-editor: in-use-state guard", () => {
  const issues = [
    { url: "a", status: "backlog" },
    { url: "b", status: "doing" },
    { url: "c", status: "doing" },
    { url: "d", status: "shipped" },
  ];

  it("finds the issues currently in a state", () => {
    expect(issuesInState(issues, "doing").map((i) => i.url)).toEqual(["b", "c"]);
    expect(issuesInState(issues, "review")).toEqual([]);
  });

  it("offers every OTHER status as a migration target", () => {
    expect(migrationTargets(CUSTOM, "doing").map((s) => s.slug)).toEqual(["backlog", "review", "shipped"]);
    expect(migrationTargets(CUSTOM, "doing").map((s) => s.slug)).not.toContain("doing");
  });
});

describe("workflow-editor: planRemovalMigrations (save-time consistency)", () => {
  // The ORIGINAL workflow had backlog/doing/review/shipped.
  const ORIGINAL: WorkflowDef = {
    statuses: [
      { slug: "backlog", label: "Backlog", terminal: false },
      { slug: "doing", label: "Doing", terminal: false },
      { slug: "review", label: "In Review", terminal: false },
      { slug: "shipped", label: "Shipped", terminal: true },
    ],
    transitions: { backlog: ["doing"], doing: ["review"], review: ["shipped"], shipped: [] },
  };
  // The workflow AFTER a save that removed "review" and "shipped" (keeping backlog,
  // doing + a new terminal "done"). "backlog" is the initial state (the fallback).
  const SAVED: WorkflowDef = {
    statuses: [
      { slug: "backlog", label: "Backlog", terminal: false },
      { slug: "doing", label: "Doing", terminal: false },
      { slug: "done", label: "Done", terminal: true },
    ],
    transitions: { backlog: ["doing"], doing: ["done"], done: [] },
  };
  const REMOVED = removedStatuses(ORIGINAL, SAVED); // ["review", "shipped"]

  it("migrates issues stranded in a removed state to its recorded target", () => {
    const live = [
      { url: "a", status: "backlog" }, // survives — no migration
      { url: "b", status: "review" }, // removed → recorded target "doing"
      { url: "c", status: "review" },
    ];
    const plan = planRemovalMigrations(SAVED, REMOVED, live, { review: "doing" });
    expect(plan).toEqual([{ fromSlug: "review", toSlug: "doing", urls: ["b", "c"] }]);
  });

  it("falls back to the new initial state when a removed state has no recorded target", () => {
    // An issue moved into "review" AFTER the user removed it (no recorded target) —
    // the save-time re-read still catches it and routes it to the initial state.
    const live = [{ url: "x", status: "review" }];
    const plan = planRemovalMigrations(SAVED, REMOVED, live, {});
    expect(plan).toEqual([{ fromSlug: "review", toSlug: "backlog", urls: ["x"] }]);
  });

  it("falls back to the initial state when the recorded target itself was removed", () => {
    // Recorded target "shipped" was also removed in this save → use the initial state.
    const live = [{ url: "y", status: "review" }];
    const plan = planRemovalMigrations(SAVED, REMOVED, live, { review: "shipped" });
    expect(plan).toEqual([{ fromSlug: "review", toSlug: "backlog", urls: ["y"] }]);
  });

  it("plans nothing when every issue is already in a surviving state", () => {
    const live = [
      { url: "a", status: "backlog" },
      { url: "b", status: "doing" },
      { url: "c", status: "done" },
    ];
    expect(planRemovalMigrations(SAVED, REMOVED, live, {})).toEqual([]);
  });

  it("groups multiple removed states, each to its own target", () => {
    const live = [
      { url: "a", status: "review" },
      { url: "b", status: "shipped" },
      { url: "c", status: "review" },
    ];
    const plan = planRemovalMigrations(SAVED, REMOVED, live, { review: "doing", shipped: "done" });
    const byFrom = Object.fromEntries(plan.map((e) => [e.fromSlug, e]));
    expect(byFrom["review"]).toEqual({ fromSlug: "review", toSlug: "doing", urls: ["a", "c"] });
    expect(byFrom["shipped"]).toEqual({ fromSlug: "shipped", toSlug: "done", urls: ["b"] });
  });

  it("LEAVES an unrelated unknown/imported status untouched (only states removed by THIS edit move)", () => {
    // An issue carries a status that was NEVER in the workflow (imported / corrupt /
    // a foreign tracker's slug). A workflow save that did NOT remove it must not
    // silently relocate it (roborev finding).
    const live = [
      { url: "a", status: "review" }, // removed THIS edit → migrates
      { url: "z", status: "legacy-archived" }, // never declared, not removed this edit → left alone
    ];
    const plan = planRemovalMigrations(SAVED, REMOVED, live, { review: "doing" });
    expect(plan).toEqual([{ fromSlug: "review", toSlug: "doing", urls: ["a"] }]);
    expect(plan.some((e) => e.fromSlug === "legacy-archived")).toBe(false);
  });
});

describe("workflow-editor: removedStatuses", () => {
  const A: WorkflowDef = {
    statuses: [
      { slug: "todo", label: "To Do", terminal: false },
      { slug: "doing", label: "Doing", terminal: false },
      { slug: "done", label: "Done", terminal: true },
    ],
    transitions: { todo: ["doing"], doing: ["done"], done: [] },
  };

  it("returns exactly the slugs in the original but not the saved workflow", () => {
    const saved = removeStatus(A, "doing"); // drops "doing"
    expect(removedStatuses(A, saved)).toEqual(["doing"]);
  });

  it("returns [] when nothing was removed (rename/reorder/add only)", () => {
    expect(removedStatuses(A, renameStatus(A, "doing", "Working"))).toEqual([]);
    expect(removedStatuses(A, addStatus(A, "Blocked"))).toEqual([]);
    expect(removedStatuses(A, moveStatus(A, "done", -1))).toEqual([]);
  });
});

describe("workflow-editor: buildIntermediateWorkflow", () => {
  const ORIGINAL: WorkflowDef = {
    statuses: [
      { slug: "backlog", label: "Backlog", terminal: false },
      { slug: "review", label: "In Review", terminal: false },
      { slug: "shipped", label: "Shipped", terminal: true },
    ],
    transitions: { backlog: ["review"], review: ["shipped"], shipped: [] },
  };
  const SAVED: WorkflowDef = {
    statuses: [
      { slug: "backlog", label: "Backlog", terminal: false },
      { slug: "done", label: "Done", terminal: true },
    ],
    transitions: { backlog: ["done"], done: [] },
  };

  it("re-adds the stranded removed source states (from the original) with no transitions", () => {
    const inter = buildIntermediateWorkflow(SAVED, ORIGINAL, ["review"]);
    // Final statuses kept, plus "review" re-added from ORIGINAL (its label/terminal).
    expect(inter.statuses.map((s) => s.slug)).toEqual(["backlog", "done", "review"]);
    expect(inter.statuses.find((s) => s.slug === "review")).toEqual({ slug: "review", label: "In Review", terminal: false });
    expect(inter.transitions["review"]).toEqual([]);
    // Both the source ("review") and the target ("done") columns exist → no orphan.
    const slugs = new Set(inter.statuses.map((s) => s.slug));
    expect(slugs.has("review")).toBe(true);
    expect(slugs.has("done")).toBe(true);
  });

  it("does not re-add a status that survives, nor one absent from the original (corrupt)", () => {
    const inter = buildIntermediateWorkflow(SAVED, ORIGINAL, ["backlog", "ghost-imported"]);
    // "backlog" survives (no dup); "ghost-imported" isn't in the original (never re-added).
    expect(inter.statuses.map((s) => s.slug)).toEqual(["backlog", "done"]);
  });

  it("returns the saved workflow unchanged when nothing needs a temporary column", () => {
    const inter = buildIntermediateWorkflow(SAVED, ORIGINAL, []);
    expect(inter.statuses.map((s) => s.slug)).toEqual(["backlog", "done"]);
  });
});
