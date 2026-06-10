import { describe, it, expect } from "vitest";
import { computeStats, computeVelocity } from "./stats";
import type { IssueRecord, SprintRecord } from "./repository";

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
  fields: {},
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

describe("computeVelocity", () => {
  it("sums done vs committed points per completed sprint, oldest first", () => {
    const issues = [
      mk({ url: "a", estimate: 3, status: "done", state: "closed" }),
      mk({ url: "b", estimate: 5 }),
      mk({ url: "c", estimate: 2, status: "done", state: "closed" }),
    ];
    const sprints: SprintRecord[] = [
      { iri: "s2", title: "Sprint 2", state: "done", endDate: new Date("2026-06-08"), taskUrls: ["c"] },
      { iri: "s1", title: "Sprint 1", state: "done", endDate: new Date("2026-06-01"), taskUrls: ["a", "b"] },
      { iri: "s3", title: "Active", state: "active", taskUrls: [] },
    ];
    expect(computeVelocity(sprints, issues)).toEqual([
      { sprint: "Sprint 1", done: 3, committed: 8 },
      { sprint: "Sprint 2", done: 2, committed: 2 },
    ]);
  });

  it("prefers the committed-points snapshot over current membership", () => {
    // Completing a sprint releases unfinished tasks, so current taskUrls only
    // hold the finished ones — the snapshot must carry the original commitment.
    const issues = [mk({ url: "a", estimate: 3, status: "done", state: "closed" })];
    const sprints: SprintRecord[] = [
      { iri: "s1", title: "Sprint 1", state: "done", endDate: new Date("2026-06-01"), taskUrls: ["a"], committedPoints: 8 },
    ];
    expect(computeVelocity(sprints, issues)).toEqual([{ sprint: "Sprint 1", done: 3, committed: 8 }]);
  });
});
