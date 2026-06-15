import { describe, it, expect } from "vitest";
import { groupByEpic } from "./epics";
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
