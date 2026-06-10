import { describe, it, expect } from "vitest";
import { computeStats } from "./stats";
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
};
const mk = (p: Partial<IssueRecord>): IssueRecord => ({ ...base, ...p });
const NOW = new Date("2026-06-10T12:00:00Z");

describe("computeStats", () => {
  it("aggregates status/type/priority/assignee/overdue", () => {
    const issues = [
      mk({ url: "1", status: "todo", issueType: "bug", priority: "high", assignee: "http://a", dateDue: new Date("2026-06-01") }),
      mk({ url: "2", status: "in-progress", issueType: "story", assignee: "http://a" }),
      mk({ url: "3", status: "done", state: "closed", issueType: "task", assignee: "http://b" }),
      mk({ url: "4", status: "todo", issueType: "epic" }),
    ];
    const s = computeStats(issues, NOW);
    expect(s.total).toBe(4);
    expect(s.byStatus.find((x) => x.status === "todo")?.count).toBe(2);
    expect(s.byStatus.find((x) => x.status === "done")?.count).toBe(1);
    expect(s.byType.find((x) => x.type === "bug")?.count).toBe(1);
    expect(s.byPriority.find((x) => x.priority === "none")?.count).toBe(3);
    // workload counts open issues only: a=2, unassigned=1; b's is closed.
    expect(s.byAssignee.find((x) => x.assignee === "http://a")?.count).toBe(2);
    expect(s.byAssignee.find((x) => x.assignee === "http://b")).toBeUndefined();
    expect(s.overdue).toBe(1);
  });

  it("buckets created dates into ISO weeks", () => {
    const s = computeStats(
      [
        mk({ url: "1", created: new Date("2026-06-01T10:00:00Z") }), // Mon of W23
        mk({ url: "2", created: new Date("2026-06-03T10:00:00Z") }), // same week
        mk({ url: "3", created: new Date("2026-06-08T10:00:00Z") }), // W24
      ],
      NOW,
    );
    expect(s.createdPerWeek).toEqual([
      { week: "2026-W23", count: 2 },
      { week: "2026-W24", count: 1 },
    ]);
  });
});
