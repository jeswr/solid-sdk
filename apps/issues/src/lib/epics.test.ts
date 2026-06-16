import { describe, it, expect } from "vitest";
import { groupByEpic, epicAncestorOf } from "./epics";
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

describe("groupByEpic", () => {
  it("rolls up children progress per epic and keeps the rest unassigned", () => {
    const issues = [
      mk({ url: "e1", title: "Auth epic", issueType: "epic", created: new Date("2026-06-01") }),
      mk({ url: "a", parent: "e1", status: "done", state: "closed" }),
      mk({ url: "b", parent: "e1", status: "in-progress" }),
      mk({ url: "c", parent: "e1", status: "todo" }),
      mk({ url: "loose" }),
      mk({ url: "subtask", parent: "loose" }), // parent is not an epic → unassigned
    ];
    const { epics, unassigned } = groupByEpic(issues);
    expect(epics).toHaveLength(1);
    expect(epics[0].total).toBe(3);
    expect(epics[0].done).toBe(1);
    expect(epics[0].percent).toBe(33);
    expect(unassigned.map((i) => i.url).sort()).toEqual(["loose", "subtask"]);
  });

  it("an epic with no children reports 0%", () => {
    const { epics } = groupByEpic([mk({ url: "e", issueType: "epic" })]);
    expect(epics[0].percent).toBe(0);
    expect(epics[0].total).toBe(0);
  });
});

describe("epicAncestorOf — nearest epic up the hierarchy (Initiative→Epic→Feature→Story→Task)", () => {
  const epic = mk({ url: "epic", issueType: "epic" });
  const feature = mk({ url: "feature", issueType: "feature", parent: "epic" });
  const story = mk({ url: "story", issueType: "story", parent: "feature" });
  const task = mk({ url: "task", issueType: "task", parent: "story" });
  const all = [epic, feature, story, task];

  it("returns the epic ANCESTOR, not the direct parent (a Story under a Feature)", () => {
    // task.parent is the story, story.parent is the feature, feature.parent is the
    // epic — walking up lands on the epic, not the intermediate feature/story.
    expect(epicAncestorOf(task, all)).toBe("epic");
    expect(epicAncestorOf(story, all)).toBe("epic");
    expect(epicAncestorOf(feature, all)).toBe("epic");
  });

  it("maps an epic to itself", () => {
    expect(epicAncestorOf(epic, all)).toBe("epic");
  });

  it("returns undefined when there is no epic ancestor", () => {
    const loose = mk({ url: "loose", issueType: "task" });
    const child = mk({ url: "c", issueType: "task", parent: "loose" });
    expect(epicAncestorOf(loose, [loose, child])).toBeUndefined();
    expect(epicAncestorOf(child, [loose, child])).toBeUndefined();
  });

  it("is cycle-safe and tolerant of a dangling parent", () => {
    const a = mk({ url: "a", issueType: "task", parent: "b" });
    const b = mk({ url: "b", issueType: "task", parent: "a" }); // cycle
    expect(epicAncestorOf(a, [a, b])).toBeUndefined();
    const dangling = mk({ url: "d", issueType: "task", parent: "missing" });
    expect(epicAncestorOf(dangling, [dangling])).toBeUndefined();
  });
});
