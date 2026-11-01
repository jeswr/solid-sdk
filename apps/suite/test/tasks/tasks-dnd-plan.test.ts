// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  cancelMessage,
  dropMessage,
  failedMessage,
  movingMessage,
  overMessage,
  pickupMessage,
  projectNames,
  sectionLabel,
  sectionToast,
} from "../../src/apps/tasks/lib/dnd/announce";
import { dropPriority, placementFor, sameContainer } from "../../src/apps/tasks/lib/dnd/placement";
import {
  canNest,
  effectiveParent,
  nestCandidates,
  planDrop,
  planMove,
  planNest,
  planPromote,
  planToSection,
  renumberWriteOrder,
  sortedTarget,
  visibleTasks,
} from "../../src/apps/tasks/lib/dnd/plan";
import type { DropContainer, DropPlan, ProjectName } from "../../src/apps/tasks/lib/dnd/types";
import type { TaskView } from "../../src/apps/tasks/lib/views/types";
import { project, view } from "./tasks-views-fixtures";

const home = project("Home");
const P = home.url;
const OTHER = project("Work").url;
const S1 = `${P}#section-doing`;
const S2 = `${P}#section-done`;
const top: DropContainer = { kind: "section", projectUrl: P };
const doing: DropContainer = { kind: "section", projectUrl: P, sectionId: S1 };

function fixture() {
  const a = view("a", { position: 1 });
  const b = view("b", { position: 2 });
  const c = view("c", { position: 3 });
  const parent = view("parent", { position: 4 });
  const k1 = view("k1", { position: 1, parentId: parent.id });
  const k2 = view("k2", { position: 2, parentId: parent.id, sectionId: S2 });
  const d = view("d", { position: 1, sectionId: S1 });
  const e = view("e", { position: 2, sectionId: S1 });
  const closed = view("closed", { position: 0.5, state: "closed" });
  const views = [a, b, c, parent, k1, k2, d, e];
  return { a, b, c, parent, k1, k2, d, e, closed, views };
}

const position = (plan: DropPlan) => {
  if (plan.kind !== "position") throw new Error(`Expected a position plan, got ${plan.kind}`);
  return plan;
};

describe("visible tasks and nesting rules", () => {
  it("counts closed rows only when the listing shows them", () => {
    const { a, closed } = fixture();
    expect(visibleTasks([a, closed], false)).toEqual([a]);
    expect(visibleTasks([a, closed], true)).toEqual([a, closed]);
  });

  it("resolves the rendered parent: open, top-level and in the same project", () => {
    const { a, parent, k1, views } = fixture();
    expect(effectiveParent(a, views)).toBeUndefined();
    expect(effectiveParent(k1, views)).toBe(parent);
    expect(effectiveParent(k1, [k1, { ...parent, state: "closed" }])).toBeUndefined();
    expect(effectiveParent(k1, [k1, { ...parent, projectUrl: OTHER }])).toBeUndefined();
    expect(effectiveParent(k1, [k1, { ...parent, parentId: "x" }])).toBeUndefined();
  });

  it("allows one nesting level only", () => {
    const { a, b, parent, k1, views } = fixture();
    expect(canNest(a, b, views)).toBe(true);
    expect(canNest(a, a, views)).toBe(false);
    expect(canNest(a, { ...b, projectUrl: OTHER }, views)).toBe(false);
    expect(canNest(a, { ...b, state: "closed" }, views)).toBe(false);
    expect(canNest(a, k1, views)).toBe(false);
    expect(canNest(parent, a, views)).toBe(false);
    expect(nestCandidates(k1, views).map((task) => task.title)).toEqual(["a", "d", "b", "e", "c"]);
    expect(nestCandidates(parent, views)).toEqual([]);
  });

  it("counts completed sub-tasks the visible rows hide: their parent never nests", () => {
    const { a, b, c, views } = fixture();
    const done = view("done", { position: 1, parentId: a.id, state: "closed" });
    const visible = visibleTasks([...views, done], false);
    const all = [...views, done];
    // The visible rows alone would allow a three-level chain a → b.
    expect(canNest(a, b, visible)).toBe(true);
    expect(canNest(a, b, all)).toBe(false);
    expect(nestCandidates(a, visible, all)).toEqual([]);
    expect(planNest(a, b, visible, { all })).toEqual({ kind: "none" });
    const child = { kind: "task", url: b.url, container: top, placement: "child" } as const;
    // A child-half drop falls back to a reorder after b, staying top-level.
    const plan = position(planDrop(a, child, visible, { all }));
    expect([plan.parentId, plan.parentChanged]).toEqual([undefined, false]);
    // Dropped among another parent's children, a parent lands after that parent instead.
    const kid = view("kid", { position: 1, parentId: c.id });
    const among = position(
      planDrop(
        a,
        { kind: "task", url: kid.url, container: top, placement: "before" },
        [...visible, kid],
        { all: [...all, kid] },
      ),
    );
    expect([among.parentId, among.parentChanged]).toEqual([undefined, false]);
  });
});

describe("planDrop", () => {
  it("moves to another project, never to its own", () => {
    const { a, views } = fixture();
    expect(planDrop(a, { kind: "project", projectUrl: P }, views)).toEqual({ kind: "none" });
    expect(planDrop(a, { kind: "project", projectUrl: OTHER }, views)).toEqual({
      kind: "project",
      url: a.url,
      projectUrl: OTHER,
    });
  });

  it("reschedules onto another day only", () => {
    const due = view("due", { allDay: "2026-11-04" });
    expect(planDrop(due, { kind: "day", dayKey: "2026-11-04" }, [due])).toEqual({ kind: "none" });
    expect(planDrop(due, { kind: "day", dayKey: "2026-11-05" }, [due])).toEqual({
      kind: "reschedule",
      url: due.url,
      dayKey: "2026-11-05",
    });
    const other = view("other");
    expect(
      planDrop(
        due,
        { kind: "task", url: other.url, container: { kind: "day" }, placement: "after" },
        [due, other],
      ),
    ).toEqual({ kind: "none" });
    expect(
      planDrop(
        due,
        {
          kind: "task",
          url: other.url,
          container: { kind: "day", dayKey: "2026-11-06" },
          placement: "before",
        },
        [due, other],
      ),
    ).toEqual({ kind: "reschedule", url: due.url, dayKey: "2026-11-06" });
  });

  it("changes section at the header (start) or the add row (end)", () => {
    const { a, d, e, views } = fixture();
    expect(
      position(planDrop(a, { kind: "section", projectUrl: P, sectionId: S1, at: "start" }, views)),
    ).toEqual({
      kind: "position",
      url: a.url,
      projectUrl: P,
      sectionId: S1,
      parentId: undefined,
      sectionChanged: true,
      parentChanged: false,
      position: 0,
      renumber: [],
      index: 1,
    });
    const end = position(
      planDrop(a, { kind: "section", projectUrl: P, sectionId: S1, at: "end" }, views),
    );
    expect([end.position, end.index]).toEqual([3, 3]);
    expect(
      planDrop(a, { kind: "section", projectUrl: OTHER, sectionId: S1, at: "end" }, views),
    ).toEqual({ kind: "none" });
    // Already the last row of Doing: no write.
    expect(
      planDrop(e, { kind: "section", projectUrl: P, sectionId: S1, at: "end" }, views),
    ).toEqual({ kind: "none" });
    expect(
      planDrop(d, { kind: "section", projectUrl: P, sectionId: S1, at: "start" }, views),
    ).toEqual({ kind: "none" });
  });

  it("reorders before/after a row with the mean of its neighbours", () => {
    const { a, b, c, views } = fixture();
    const after = position(
      planDrop(a, { kind: "task", url: b.url, container: top, placement: "after" }, views),
    );
    expect([after.position, after.index, after.sectionChanged, after.parentChanged]).toEqual([
      2.5,
      2,
      false,
      false,
    ]);
    const before = position(
      planDrop(c, { kind: "task", url: a.url, container: top, placement: "before" }, views),
    );
    expect([before.position, before.index]).toEqual([0, 1]);
    // Dropping right where it already is writes nothing.
    expect(
      planDrop(b, { kind: "task", url: a.url, container: top, placement: "after" }, views),
    ).toEqual({ kind: "none" });
    expect(
      planDrop(a, { kind: "task", url: a.url, container: top, placement: "after" }, views),
    ).toEqual({ kind: "none" });
  });

  it("renumbers the section 1.0…n.0 when a gap falls below 1e-6", () => {
    const a = view("a", { position: 1 });
    const b = view("b", { position: 1 + 1e-9 });
    const c = view("c", { position: 2 });
    const plan = position(
      planDrop(c, { kind: "task", url: a.url, container: top, placement: "after" }, [a, b, c]),
    );
    expect(plan.renumber).toEqual([
      { url: a.url, position: 1 },
      { url: b.url, position: 2 },
    ]);
    expect(plan.position).toBe(1.5);
  });

  it("moves into another section by dropping on one of its rows", () => {
    const { a, d, views } = fixture();
    const plan = position(
      planDrop(a, { kind: "task", url: d.url, container: doing, placement: "after" }, views),
    );
    expect([plan.sectionId, plan.sectionChanged, plan.position, plan.index]).toEqual([
      S1,
      true,
      1.5,
      2,
    ]);
  });

  it("nests on a row's right half and falls back to reorder when it cannot", () => {
    const { a, b, parent, views } = fixture();
    const nest = position(
      planDrop(a, { kind: "task", url: b.url, container: top, placement: "child" }, views),
    );
    expect([nest.parentId, nest.parentChanged, nest.sectionChanged, nest.index]).toEqual([
      b.id,
      true,
      false,
      1,
    ]);
    // Nesting under a parent appends after its existing children.
    const last = position(
      planDrop(a, { kind: "task", url: parent.url, container: top, placement: "child" }, views),
    );
    expect([last.parentId, last.position, last.index]).toEqual([parent.id, 3, 3]);
    // A parent cannot become a child: the drop reorders after the row instead.
    const fallback = position(
      planDrop(parent, { kind: "task", url: a.url, container: top, placement: "child" }, views),
    );
    expect([fallback.parentId, fallback.index]).toEqual([undefined, 2]);
  });

  it("joins a parent's children, never its own, and keeps parents top-level", () => {
    const { a, parent, k1, k2, views } = fixture();
    const child = position(
      planDrop(a, { kind: "task", url: k1.url, container: top, placement: "after" }, views),
    );
    expect([child.parentId, child.parentChanged, child.sectionChanged, child.index]).toEqual([
      parent.id,
      true,
      false,
      2,
    ]);
    expect(
      planDrop(parent, { kind: "task", url: k1.url, container: top, placement: "after" }, views),
    ).toEqual({ kind: "none" });
    const withChildren = view("other-parent", { position: 0 });
    const kid = view("kid", { parentId: withChildren.id });
    const all = [...views, withChildren, kid];
    const anchored = position(
      planDrop(
        withChildren,
        { kind: "task", url: k2.url, container: top, placement: "before" },
        all,
      ),
    );
    // Anchored after the parent row, at the top level.
    expect([anchored.parentId, anchored.index]).toEqual([undefined, 5]);
  });

  it("ignores unknown rows and rows of other projects", () => {
    const { a, views } = fixture();
    const foreign = view("foreign", { projectUrl: OTHER });
    expect(
      planDrop(a, { kind: "task", url: "missing", container: top, placement: "after" }, views),
    ).toEqual({ kind: "none" });
    expect(
      planDrop(a, { kind: "task", url: foreign.url, container: top, placement: "after" }, [
        ...views,
        foreign,
      ]),
    ).toEqual({ kind: "none" });
  });
});

describe("renumber write order", () => {
  /** Siblings in manual order (unranked last), renumbered 1…n as positionForDrop does. */
  const check = (ranks: (number | undefined)[]) => {
    const rank = new Map(ranks.map((value, at) => [`t${at}`, value]));
    const patches = ranks.map((_, at) => ({ url: `t${at}`, position: at + 1 }));
    const order = renumberWriteOrder(patches, (url) => rank.get(url));
    const current = new Map(rank);
    const sorted = () =>
      ranks
        .map((_, at) => `t${at}`)
        .toSorted(
          (a, b) =>
            (current.get(a) ?? Infinity) - (current.get(b) ?? Infinity) ||
            Number(a.slice(1)) - Number(b.slice(1)),
        );
    const expected = ranks.map((_, at) => `t${at}`);
    expect(sorted()).toEqual(expected);
    // Every prefix of the writes (a failure or closed tab) keeps the siblings' order.
    for (const patch of order) {
      current.set(patch.url, patch.position);
      expect(sorted()).toEqual(expected);
    }
    for (const patch of patches) expect(current.get(patch.url)).toBe(patch.position);
    return order.map((patch) => patch.url);
  };

  it("writes falling ranks ascending, then rising ranks descending, skipping settled rows", () => {
    expect(check([0.5, 0.5 + 1e-9, 0.5 + 2e-9])).toEqual(["t2", "t1", "t0"]);
    expect(check([5, 5 + 1e-9, 6])).toEqual(["t0", "t1", "t2"]);
    expect(check([1, 1 + 1e-9, 4])).toEqual(["t2", "t1"]);
    expect(check([-4, 2, 2 + 1e-9, 10, undefined, undefined])).toEqual([
      "t3",
      "t4",
      "t5",
      "t2",
      "t0",
    ]);
  });

  it("keeps the order through every prefix for many cramped layouts", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let run = 0; run < 200; run++) {
      const count = 1 + Math.floor(random() * 7);
      let value = random() * 10 - 5;
      const ranks: (number | undefined)[] = [];
      for (let at = 0; at < count; at++) {
        value += random() < 0.4 ? 1e-9 : random() * 3;
        ranks.push(random() < 0.15 ? undefined : value);
      }
      // Unranked rows sort last.
      check(ranks.toSorted((a, b) => (a ?? Infinity) - (b ?? Infinity)));
    }
  });
});

describe("sorted lists", () => {
  const sorted = { manual: false } as const;

  it("maps a row in a section container onto its section; other targets stay", () => {
    const row = { kind: "task", url: "x", container: doing, placement: "before" } as const;
    expect(sortedTarget(row)).toEqual({
      kind: "section",
      projectUrl: P,
      sectionId: S1,
      at: "end",
    });
    const day = { ...row, container: { kind: "day", dayKey: "2026-11-04" } } as const;
    expect(sortedTarget(day)).toBe(day);
    const project = { kind: "project", projectUrl: OTHER } as const;
    expect(sortedTarget(project)).toBe(project);
  });

  it("allows only section and project moves: rows never reorder or nest", () => {
    const { a, b, d, k1, views } = fixture();
    for (const placement of ["before", "after", "child"] as const) {
      // Same section: re-ranking would change nothing the list shows.
      expect(
        planDrop(a, { kind: "task", url: b.url, container: top, placement }, views, sorted),
      ).toEqual({ kind: "none" });
      // Another section: appended there, announced without a position.
      const plan = position(
        planDrop(a, { kind: "task", url: d.url, container: doing, placement }, views, sorted),
      );
      expect([plan.sectionId, plan.sectionChanged, plan.parentId, plan.index]).toEqual([
        S1,
        true,
        undefined,
        3,
      ]);
    }
    expect(planDrop(a, { kind: "section", projectUrl: P, at: "start" }, views, sorted)).toEqual({
      kind: "none",
    });
    // A child stays put on its parent's own section.
    expect(planDrop(k1, { kind: "section", projectUrl: P, at: "end" }, views, sorted)).toEqual({
      kind: "none",
    });
    expect(
      position(planDrop(d, { kind: "section", projectUrl: P, at: "start" }, views, sorted))
        .sectionChanged,
    ).toBe(true);
    expect(planDrop(a, { kind: "project", projectUrl: OTHER }, views, sorted).kind).toBe("project");
    expect(position(planToSection(a, S1, views, sorted)).sectionId).toBe(S1);
    expect(planToSection(a, undefined, views, sorted)).toEqual({ kind: "none" });
  });

  it("offers no Move up/down, but still nests from the menu", () => {
    const { a, b, views } = fixture();
    expect(planMove(b, -1, views, sorted)).toEqual({ kind: "none" });
    expect(planMove(b, 1, views, sorted)).toEqual({ kind: "none" });
    expect(position(planNest(a, b, views, sorted)).parentId).toBe(b.id);
  });
});

describe("keyboard equivalents", () => {
  it("moves up and down within the rendered level, stopping at the edges", () => {
    const { a, b, parent, k1, k2, views } = fixture();
    expect(planMove(a, -1, views)).toEqual({ kind: "none" });
    expect(position(planMove(a, 1, views)).position).toBe(2.5);
    expect(position(planMove(b, -1, views)).position).toBe(0);
    expect(planMove(parent, 1, views)).toEqual({ kind: "none" });
    expect(position(planMove(k2, -1, views)).position).toBe(0);
    expect(planMove(k1, -1, views)).toEqual({ kind: "none" });
  });

  it("moves to a section, nests and promotes", () => {
    const { a, b, d, parent, k1, k2, views } = fixture();
    expect(position(planToSection(d, undefined, views)).sectionChanged).toBe(true);
    expect(planNest(parent, a, views)).toEqual({ kind: "none" });
    expect(position(planNest(a, b, views)).parentId).toBe(b.id);
    expect(planPromote(a, views)).toEqual({ kind: "none" });
    const promoted = position(planPromote(k1, views));
    expect([promoted.parentId, promoted.parentChanged, promoted.sectionChanged]).toEqual([
      undefined,
      true,
      false,
    ]);
    expect(promoted.index).toBe(5);
    // A child carrying another section class is promoted into its parent's section.
    expect(position(planPromote(k2, views)).sectionChanged).toBe(true);
  });
});

describe("placement", () => {
  const over = { left: 0, top: 100, width: 400, height: 40 };
  it("reads the pointer against the row halves", () => {
    const base = { over, movingDown: true, sameContainer: true, allowChild: true };
    expect(placementFor({ ...base, pointer: { x: 300, y: 110 } })).toBe("child");
    expect(placementFor({ ...base, pointer: { x: 100, y: 110 } })).toBe("before");
    expect(placementFor({ ...base, pointer: { x: 100, y: 130 } })).toBe("after");
    expect(placementFor({ ...base, allowChild: false, pointer: { x: 300, y: 110 } })).toBe(
      "before",
    );
  });

  it("uses array-move semantics for keyboard drags", () => {
    const base = { over, allowChild: true };
    expect(placementFor({ ...base, movingDown: true, sameContainer: true })).toBe("after");
    expect(placementFor({ ...base, movingDown: false, sameContainer: true })).toBe("before");
    expect(placementFor({ ...base, movingDown: true, sameContainer: false })).toBe("before");
    expect(placementFor({ ...base, movingDown: false, sameContainer: false })).toBe("after");
  });

  it("prefers rows over the zones around them and compares containers", () => {
    expect(dropPriority("task")).toBe(0);
    expect(dropPriority("section-end")).toBe(1);
    expect(dropPriority(undefined)).toBe(1);
    expect(sameContainer(top, { kind: "section", projectUrl: P })).toBe(true);
    expect(sameContainer(top, doing)).toBe(false);
    expect(sameContainer(top, { kind: "day" })).toBe(false);
    expect(sameContainer({ kind: "day", dayKey: "2026-11-04" }, { kind: "day" })).toBe(false);
    expect(sameContainer({ kind: "day" }, { kind: "day" })).toBe(true);
    expect(sameContainer({ kind: "day" }, top)).toBe(false);
  });
});

describe("announcements", () => {
  const names: ProjectName[] = [
    { url: P, title: "Home", sections: [{ id: S1, name: "Doing" }] },
    { url: OTHER, title: "", sections: [] },
  ];
  const task = view("Pay rent");
  const other = view("Water plants");
  const views: TaskView[] = [task, other];

  it("names projects and sections, defaulting to No section", () => {
    expect(projectNames([home])).toEqual([{ url: P, title: "Home", sections: [] }]);
    expect(
      projectNames([{ url: P, tracker: { title: undefined, sections: [] } } as never]),
    ).toEqual([{ url: P, title: "", sections: [] }]);
    expect(sectionLabel(names, P, S1)).toBe("Doing");
    expect(sectionLabel(names, P, undefined)).toBe("No section");
    expect(sectionLabel(names, "missing", S1)).toBe("No section");
  });

  it("announces pick-up, every hover target and cancel", () => {
    expect(pickupMessage(task)).toBe("Picked up 'Pay rent'.");
    expect(cancelMessage(task)).toBe("Cancelled moving 'Pay rent'.");
    expect(overMessage(task, undefined, views, names)).toBe(
      "'Pay rent' is not over a drop target.",
    );
    expect(overMessage(task, { kind: "project", projectUrl: P }, views, names)).toBe(
      "'Pay rent' is over Home.",
    );
    expect(overMessage(task, { kind: "project", projectUrl: OTHER }, views, names)).toBe(
      "'Pay rent' is over Project.",
    );
    expect(overMessage(task, { kind: "day", dayKey: "2026-11-04" }, views, names)).toBe(
      "'Pay rent' is over Wed 4 Nov.",
    );
    expect(
      overMessage(
        task,
        { kind: "section", projectUrl: P, sectionId: S1, at: "start" },
        views,
        names,
      ),
    ).toBe("'Pay rent' is over Doing.");
    const onRow = (container: DropContainer, placement: "before" | "after" | "child") =>
      overMessage(task, { kind: "task", url: other.url, container, placement }, views, names);
    expect(onRow({ kind: "day", dayKey: "2026-11-05" }, "after")).toBe(
      "'Pay rent' is over Thu 5 Nov.",
    );
    expect(onRow({ kind: "day" }, "after")).toBe("'Pay rent' is not over a drop target.");
    expect(onRow(top, "before")).toBe("'Pay rent' is before 'Water plants'.");
    expect(onRow(top, "after")).toBe("'Pay rent' is after 'Water plants'.");
    expect(onRow(top, "child")).toBe("'Pay rent' would become a sub-task of 'Water plants'.");
    expect(
      overMessage(
        task,
        { kind: "task", url: "missing", container: top, placement: "after" },
        views,
        names,
      ),
    ).toBe("'Pay rent' is after 'a task'.");
  });

  it("announces the result of every drop", () => {
    const moved = {
      kind: "position",
      url: task.url,
      projectUrl: P,
      sectionId: S1,
      parentId: undefined,
      sectionChanged: true,
      parentChanged: false,
      position: 2,
      renumber: [],
      index: 2,
    } as const;
    expect(dropMessage(task, { kind: "none" }, views, names)).toBe(
      "'Pay rent' was dropped in its original place.",
    );
    expect(dropMessage(task, moved, views, names)).toBe("Moved 'Pay rent' to Doing, position 2.");
    // A sorted list shows no manual position.
    expect(dropMessage(task, moved, views, names, false)).toBe("Moved 'Pay rent' to Doing.");
    expect(movingMessage(task)).toBe("Moving 'Pay rent'…");
    expect(failedMessage(task)).toBe("Couldn't move 'Pay rent'.");
    expect(
      dropMessage(task, { ...moved, parentId: other.id, parentChanged: true }, views, names),
    ).toBe("Made 'Pay rent' a sub-task of 'Water plants'.");
    expect(dropMessage(task, { ...moved, parentId: other.id }, views, names)).toBe(
      "Moved 'Pay rent' to position 2 under 'Water plants'.",
    );
    expect(
      dropMessage(task, { kind: "reschedule", url: task.url, dayKey: "2026-11-04" }, views, names),
    ).toBe("Moved 'Pay rent' to Wed 4 Nov.");
    expect(dropMessage(task, { kind: "project", url: task.url, projectUrl: P }, views, names)).toBe(
      "Moved 'Pay rent' to Home.",
    );
    expect(sectionToast(moved, names)).toBe("Moved to Doing");
    expect(sectionToast({ ...moved, sectionChanged: false }, names)).toBeUndefined();
    expect(sectionToast({ kind: "none" }, names)).toBeUndefined();
  });
});
