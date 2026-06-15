import { describe, it, expect } from "vitest";
import { rollupOf, rollupAll, directChildren, descendantUrlsOf, linksOf } from "./rollups";
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
  canWrite: true,
  fields: {},
};
const mk = (p: Partial<IssueRecord>): IssueRecord => ({ ...base, ...p });

describe("F6 rollups — subitems / progress", () => {
  it("rolls up direct children: 3/5 done style counts and percent", () => {
    const issues = [
      mk({ url: "p", issueType: "epic" }),
      mk({ url: "a", parent: "p", status: "done" }),
      mk({ url: "b", parent: "p", status: "done" }),
      mk({ url: "c", parent: "p", status: "done" }),
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

  it("rolls up TRANSITIVELY across multiple levels (grandchildren count)", () => {
    const issues = [
      mk({ url: "epic", issueType: "epic" }),
      mk({ url: "story", parent: "epic", issueType: "story", status: "in-progress" }),
      mk({ url: "t1", parent: "story", status: "done" }),
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
      mk({ url: "a", parent: "b", status: "done" }),
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
      mk({ url: "a", parent: "p", status: "done" }),
      mk({ url: "b", parent: "p", status: "todo" }),
    ];
    const r = rollupOf(issues[0], issues);
    expect(r.childCount).toBe(2); // only the two real children
    expect(r.descendantCount).toBe(2);
    expect(r.done).toBe(1);
  });

  it("rollupAll keys every issue and matches per-issue rollupOf", () => {
    const issues = [
      mk({ url: "p", issueType: "epic" }),
      mk({ url: "a", parent: "p", status: "done" }),
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
