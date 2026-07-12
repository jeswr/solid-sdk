import { describe, it, expect } from "vitest";
import { rollupOf, rollupAll, directChildren, descendantUrlsOf, linksOf } from "./rollups";
import { canNest } from "./issue";
import type { IssueRecord } from "./repository";

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

describe("F6 rollups — subitems / progress", () => {
  it("rolls up direct children: 3/5 done style counts and percent", () => {
    const issues = [
      mk({ url: "p", issueType: "epic" }),
      // Completion is the open/closed state: a "done" status always resolves to
      // state="closed" in real data, and the rollup counts by state, not slug.
      mk({ url: "a", parent: "p", status: "done", state: "closed" }),
      mk({ url: "b", parent: "p", status: "done", state: "closed" }),
      mk({ url: "c", parent: "p", status: "done", state: "closed" }),
      mk({ url: "d", parent: "p", status: "in-progress" }),
      mk({ url: "e", parent: "p", status: "todo" }),
    ];
    const r = rollupOf(issues[0], issues);
    expect(r.childCount).toBe(5);
    expect(r.descendantCount).toBe(5);
    expect(r.done).toBe(3);
    expect(r.total).toBe(5);
    expect(r.percent).toBe(60); // 3/5
  });

  it("counts a custom terminal status (state=closed, slug≠'done') as complete", () => {
    // A custom workflow ships issues to a "shipped" terminal status, written with
    // state="closed". The rollup must count them as done — not just the "done" slug.
    const issues = [
      mk({ url: "p", issueType: "epic" }),
      mk({ url: "a", parent: "p", status: "shipped", state: "closed" }),
      mk({ url: "b", parent: "p", status: "review" }),
    ];
    const r = rollupOf(issues[0], issues);
    expect(r.done).toBe(1); // the shipped (closed) child
    expect(r.total).toBe(2);
    expect(r.percent).toBe(50);
  });

  it("rolls up TRANSITIVELY across multiple levels (grandchildren count)", () => {
    const issues = [
      mk({ url: "epic", issueType: "epic" }),
      mk({ url: "story", parent: "epic", issueType: "story", status: "in-progress" }),
      mk({ url: "t1", parent: "story", status: "done", state: "closed" }),
      mk({ url: "t2", parent: "story", status: "todo" }),
    ];
    const r = rollupOf(issues[0], issues);
    expect(r.childCount).toBe(1); // just the story directly
    expect(r.descendantCount).toBe(3); // story + t1 + t2
    expect(r.done).toBe(1); // only t1
    expect(r.percent).toBe(33); // 1/3
  });

  it("sums descendant estimates and computes min/max due dates (own date folded in)", () => {
    const issues = [
      mk({ url: "p", issueType: "epic", dateDue: new Date("2026-06-15") }),
      mk({ url: "a", parent: "p", estimate: 3, dateDue: new Date("2026-06-10") }),
      mk({ url: "b", parent: "p", estimate: 5, dateDue: new Date("2026-06-20") }),
      mk({ url: "c", parent: "p", estimate: 2 }), // no due date
    ];
    const r = rollupOf(issues[0], issues);
    expect(r.estimate).toBe(10); // 3 + 5 + 2 (own estimate excluded)
    expect(r.earliestDue?.toISOString()).toBe(new Date("2026-06-10").toISOString());
    expect(r.latestDue?.toISOString()).toBe(new Date("2026-06-20").toISOString());
  });

  it("a leaf with no children rolls up to zeros (its own due date surfaces)", () => {
    const leaf = mk({ url: "x", dateDue: new Date("2026-07-01") });
    const r = rollupOf(leaf, [leaf]);
    expect(r.descendantCount).toBe(0);
    expect(r.total).toBe(0);
    expect(r.percent).toBe(0);
    expect(r.estimate).toBe(0);
    expect(r.earliestDue?.toISOString()).toBe(new Date("2026-07-01").toISOString());
  });

  it("is CYCLE-SAFE: A⊂B⊂A is counted once each, no infinite recursion", () => {
    // Malformed pod data: a points to b as parent, b points to a as parent.
    const issues = [
      mk({ url: "a", parent: "b", status: "done", state: "closed" }),
      mk({ url: "b", parent: "a", status: "todo" }),
    ];
    // Must terminate and count each node at most once.
    const ra = rollupOf(issues[0], issues);
    expect(ra.descendantCount).toBe(1); // b is a's only (non-cyclic) descendant
    expect(ra.done).toBe(0); // b is todo
    const rb = rollupOf(issues[1], issues);
    expect(rb.descendantCount).toBe(1); // a is b's only descendant
    expect(rb.done).toBe(1); // a is done
  });

  it("is CYCLE-SAFE for a 3-node loop A→B→C→A", () => {
    const issues = [
      mk({ url: "a", parent: "c" }),
      mk({ url: "b", parent: "a" }),
      mk({ url: "c", parent: "b" }),
    ];
    const r = rollupOf(issues[0], issues);
    // From a: descend to b, then c; c's parent is b (already seen) → stop.
    expect(r.descendantCount).toBe(2);
  });

  it("a node is never its own descendant (self-parent guard)", () => {
    const self = mk({ url: "x", parent: "x" });
    const r = rollupOf(self, [self]);
    expect(r.descendantCount).toBe(0);
    expect(r.childCount).toBe(0);
  });

  it("childCount excludes self even when the issue also has real children (self-parent + real children)", () => {
    // Malformed: "p" lists itself as its own parent AND has two real children.
    // childCount must be 2 (the real children), not 3 (which would include self).
    const issues = [
      mk({ url: "p", parent: "p", issueType: "epic" }),
      mk({ url: "a", parent: "p", status: "done", state: "closed" }),
      mk({ url: "b", parent: "p", status: "todo" }),
    ];
    const r = rollupOf(issues[0], issues);
    expect(r.childCount).toBe(2); // only the two real children
    expect(r.descendantCount).toBe(2);
    expect(r.done).toBe(1);
  });

  it("F4: rolls up logged time across the subtree, INCLUDING the issue's own logged work", () => {
    const issues = [
      mk({ url: "epic", issueType: "epic", loggedSeconds: 600 }), // own time counts
      mk({ url: "story", parent: "epic", issueType: "story", loggedSeconds: 3600 }),
      mk({ url: "t1", parent: "story", loggedSeconds: 1800, state: "closed", status: "done" }),
      mk({ url: "t2", parent: "story", loggedSeconds: 0 }),
    ];
    const r = rollupOf(issues[0], issues);
    // 600 (own) + 3600 (story) + 1800 (t1) + 0 (t2) = 6000s
    expect(r.loggedSeconds).toBe(6000);
  });

  it("F4: a leaf surfaces its OWN logged time even with no children", () => {
    const leaf = mk({ url: "x", loggedSeconds: 2700 });
    const r = rollupOf(leaf, [leaf]);
    expect(r.descendantCount).toBe(0);
    expect(r.loggedSeconds).toBe(2700); // own time still surfaces
  });

  it("F4: a leaf with no logged time and no due date rolls up to zero logged", () => {
    const leaf = mk({ url: "x" });
    expect(rollupOf(leaf, [leaf]).loggedSeconds).toBe(0);
  });

  it("F4: logged-time rollup is CYCLE-SAFE (A⊂B⊂A counts each once)", () => {
    const issues = [
      mk({ url: "a", parent: "b", loggedSeconds: 100 }),
      mk({ url: "b", parent: "a", loggedSeconds: 200 }),
    ];
    // From a: own 100 + descendant b 200 = 300, no infinite loop.
    expect(rollupOf(issues[0], issues).loggedSeconds).toBe(300);
    expect(rollupOf(issues[1], issues).loggedSeconds).toBe(300);
  });

  it("rollupAll keys every issue and matches per-issue rollupOf", () => {
    const issues = [
      mk({ url: "p", issueType: "epic" }),
      mk({ url: "a", parent: "p", status: "done", state: "closed" }),
      mk({ url: "b", parent: "p", status: "todo" }),
    ];
    const all = rollupAll(issues);
    expect(all.size).toBe(3);
    expect(all.get("p")?.done).toBe(1);
    expect(all.get("p")?.total).toBe(2);
    expect(all.get("a")?.descendantCount).toBe(0);
  });

  it("directChildren returns only the immediate level", () => {
    const issues = [
      mk({ url: "epic", issueType: "epic" }),
      mk({ url: "story", parent: "epic" }),
      mk({ url: "task", parent: "story" }),
    ];
    expect(directChildren(issues[0], issues).map((i) => i.url)).toEqual(["story"]);
  });
});

describe("descendantUrlsOf — parent-candidate cycle guard", () => {
  it("returns an empty set for a leaf with no children", () => {
    const leaf = mk({ url: "x" });
    expect(descendantUrlsOf(leaf, [leaf]).size).toBe(0);
  });

  it("returns all transitive descendants, not including the root", () => {
    const issues = [
      mk({ url: "epic", issueType: "epic" }),
      mk({ url: "story", parent: "epic", issueType: "story" }),
      mk({ url: "task1", parent: "story" }),
      mk({ url: "task2", parent: "story" }),
    ];
    const desc = descendantUrlsOf(issues[0], issues);
    expect(desc).toEqual(new Set(["story", "task1", "task2"]));
  });

  it("excludes self — an issue is not a descendant of itself (self-parent guard)", () => {
    const self = mk({ url: "x", parent: "x" });
    const desc = descendantUrlsOf(self, [self]);
    expect(desc.has("x")).toBe(false);
  });

  it("is cycle-safe — a cycle does not cause infinite recursion", () => {
    const issues = [
      mk({ url: "a", parent: "b" }),
      mk({ url: "b", parent: "a" }),
    ];
    const desc = descendantUrlsOf(issues[0], issues);
    // From "a": child is "b"; "b"'s child is "a" (already seen) → stop.
    expect(desc).toEqual(new Set(["b"]));
  });
});

describe("F2 bidirectional links", () => {
  it("blocks / blockedBy are inverses (A requires B ⇒ B blocks A)", () => {
    const issues = [
      mk({ url: "a", blockedBy: ["b"] }),
      mk({ url: "b" }),
    ];
    expect(linksOf(issues[0], issues).blockedBy).toEqual(["b"]);
    expect(linksOf(issues[1], issues).blocks).toEqual(["a"]); // derived inverse
    expect(linksOf(issues[1], issues).blockedBy).toEqual([]);
  });

  it("relates is symmetric: a peer that links back surfaces even without our own link", () => {
    const issues = [
      mk({ url: "a" }), // no outgoing relation
      mk({ url: "b", relatesTo: ["a"] }), // b relates to a
    ];
    // a still shows b as related because b points at it (dct:relation is symmetric).
    expect(linksOf(issues[0], issues).relates).toEqual(["b"]);
    // b shows a (its own outgoing link).
    expect(linksOf(issues[1], issues).relates).toEqual(["a"]);
  });

  it("relates de-duplicates when both sides assert the link", () => {
    const issues = [
      mk({ url: "a", relatesTo: ["b"] }),
      mk({ url: "b", relatesTo: ["a"] }),
    ];
    expect(linksOf(issues[0], issues).relates).toEqual(["b"]); // not ["b","b"]
  });

  it("duplicateOf / duplicatedBy are inverses (supersession)", () => {
    const issues = [
      mk({ url: "dup", duplicateOf: "canonical" }),
      mk({ url: "canonical" }),
    ];
    expect(linksOf(issues[0], issues).duplicateOf).toBe("canonical");
    expect(linksOf(issues[1], issues).duplicatedBy).toEqual(["dup"]); // derived inverse
  });

  it("clonedFrom / clones are inverses (clone v1)", () => {
    const issues = [
      mk({ url: "clone", clonedFrom: "orig" }),
      mk({ url: "orig" }),
    ];
    expect(linksOf(issues[0], issues).clonedFrom).toBe("orig");
    expect(linksOf(issues[1], issues).clones).toEqual(["clone"]); // derived inverse
  });
});

/**
 * Regression: F5 candidate-list split.
 *
 * The parent selector must apply canNest hierarchy filtering; the blocker /
 * relates-to / duplicate-of selectors must NOT — any issue (same-level,
 * finer-grained, or descendant) can block another regardless of type hierarchy.
 *
 * This test models the filtering logic that IssueDetailDialog computes and
 * pins the invariant so a future refactor cannot accidentally re-merge the lists.
 */
describe("F5/F2 candidate-list split — parent vs dependency selectors", () => {
  /**
   * Helper that mirrors the filtering logic in IssueDetailDialog:
   *   parentCandidates  — canNest-filtered + not self + not descendants
   *   dependencyCandidates — not self only
   *   addableBlockers   — dependencyCandidates excluding already-blockers and own parent
   */
  function computeCandidates(self: IssueRecord, allIssues: IssueRecord[]) {
    const selfDescendants = descendantUrlsOf(self, allIssues);
    const parentCandidates = allIssues.filter(
      (i) => i.url !== self.url && !selfDescendants.has(i.url) && canNest(i.issueType, self.issueType),
    );
    const dependencyCandidates = allIssues.filter((i) => i.url !== self.url);
    const addableBlockers = dependencyCandidates.filter(
      (i) => !self.blockedBy.includes(i.url) && i.url !== self.parent,
    );
    const links = linksOf(self, allIssues);
    const addableRelated = dependencyCandidates.filter((i) => !links.relates.includes(i.url));
    return { parentCandidates, dependencyCandidates, addableBlockers, addableRelated };
  }

  it("a same-level issue is NOT a parent candidate but IS an addable blocker", () => {
    // Two stories: "self" is a story and "peer" is another story.
    // canNest("story", "story") === false → peer must be absent from parentCandidates.
    // But "peer" can still block "self" → must appear in addableBlockers.
    const self = mk({ url: "self", issueType: "story" });
    const peer = mk({ url: "peer", issueType: "story" });
    const allIssues = [self, peer];

    const { parentCandidates, addableBlockers } = computeCandidates(self, allIssues);

    expect(parentCandidates.map((i) => i.url)).not.toContain("peer"); // hierarchy rejects it
    expect(addableBlockers.map((i) => i.url)).toContain("peer");      // dependency allows it
  });

  it("a finer-grained (child-level) issue is NOT a parent candidate but IS an addable blocker", () => {
    // self = epic; "task" is a task (finer).
    // canNest("task", "epic") === false → task is not a valid parent of epic.
    // But a task can still block an epic.
    const self = mk({ url: "epic", issueType: "epic" });
    const task = mk({ url: "task1", issueType: "task" });
    const allIssues = [self, task];

    const { parentCandidates, addableBlockers } = computeCandidates(self, allIssues);

    expect(parentCandidates.map((i) => i.url)).not.toContain("task1");
    expect(addableBlockers.map((i) => i.url)).toContain("task1");
  });

  it("a descendant (child in the tree) is NOT a parent candidate but IS an addable blocker", () => {
    // self = epic; story is a direct child in the hierarchy tree.
    // Cannot be set as parent of epic (would create a cycle) BUT can block the epic.
    const self = mk({ url: "epic", issueType: "epic" });
    const story = mk({ url: "story1", parent: "epic", issueType: "story" });
    const allIssues = [self, story];

    const { parentCandidates, addableBlockers } = computeCandidates(self, allIssues);

    // story is a descendant → excluded from parentCandidates (cycle guard)
    expect(parentCandidates.map((i) => i.url)).not.toContain("story1");
    // but the dependency link is independent — story can block epic
    expect(addableBlockers.map((i) => i.url)).toContain("story1");
  });

  it("a coarser-level issue IS both a parent candidate and an addable blocker when not already linked", () => {
    // self = story; initiative is strictly coarser → valid parent AND valid blocker.
    const self = mk({ url: "story1", issueType: "story" });
    const initiative = mk({ url: "init", issueType: "initiative" });
    const allIssues = [self, initiative];

    const { parentCandidates, addableBlockers } = computeCandidates(self, allIssues);

    expect(parentCandidates.map((i) => i.url)).toContain("init");
    expect(addableBlockers.map((i) => i.url)).toContain("init");
  });

  it("an already-blocked issue is absent from addableBlockers but still in dependencyCandidates", () => {
    const self = mk({ url: "self", issueType: "task", blockedBy: ["other"] });
    const other = mk({ url: "other", issueType: "task" });
    const allIssues = [self, other];

    const { dependencyCandidates, addableBlockers } = computeCandidates(self, allIssues);

    expect(dependencyCandidates.map((i) => i.url)).toContain("other"); // raw list has it
    expect(addableBlockers.map((i) => i.url)).not.toContain("other");  // already a blocker
  });

  it("self is excluded from all candidate lists", () => {
    const self = mk({ url: "self", issueType: "story" });
    const allIssues = [self];

    const { parentCandidates, dependencyCandidates, addableBlockers } = computeCandidates(self, allIssues);

    expect(parentCandidates.map((i) => i.url)).not.toContain("self");
    expect(dependencyCandidates.map((i) => i.url)).not.toContain("self");
    expect(addableBlockers.map((i) => i.url)).not.toContain("self");
  });
});
