import { describe, it, expect } from "vitest";
import {
  computeBurndown,
  computeControlChart,
  computeCumulativeFlow,
  computeCumulativeFlowBands,
  computeStats,
  computeVelocity,
  computeWorkload,
  controlChartRows,
  median,
  percentile,
  statusSlugFromClass,
  type StatusTransition,
} from "./stats";
import { DEFAULT_WORKFLOW, type WorkflowDef } from "./issue";
import type { IssueRecord, SprintRecord } from "./repository";

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

describe("computeWorkload", () => {
  // NOW is Wed 2026-06-10; the current ISO week runs Mon 08 – Sun 14.
  it("buckets open work per assignee into overdue / weeks / later / unscheduled", () => {
    const issues = [
      mk({ url: "1", assignee: "http://a", estimate: 3, dateDue: new Date("2026-06-01") }), // overdue
      mk({ url: "2", assignee: "http://a", estimate: 5, dateDue: new Date("2026-06-12") }), // this week
      mk({ url: "3", assignee: "http://a", dateDue: new Date("2026-06-17") }), // next week, unestimated → 1pt
      mk({ url: "4", assignee: "http://b", estimate: 8, dateDue: new Date("2026-09-01") }), // later
      mk({ url: "5", assignee: "http://b", estimate: 2 }), // unscheduled
      mk({ url: "6", assignee: "http://a", estimate: 13, state: "closed", status: "done" }), // closed: excluded
    ];
    const w = computeWorkload(issues, NOW, 2);
    expect(w.bucketLabels).toHaveLength(2 + 3); // overdue + 2 weeks + later + no date
    expect(w.bucketLabels[0]).toBe("Overdue");
    expect(w.bucketLabels.at(-2)).toBe("Later");
    expect(w.bucketLabels.at(-1)).toBe("No date");

    const a = w.rows.find((r) => r.assignee === "http://a")!;
    expect(a.count).toBe(3);
    expect(a.points).toBe(9);
    expect(a.buckets.map((b) => b.points)).toEqual([3, 5, 1, 0, 0]);

    const b = w.rows.find((r) => r.assignee === "http://b")!;
    expect(b.buckets.map((b2) => b2.points)).toEqual([0, 0, 0, 8, 2]);
    // heaviest row first
    expect(w.rows[0].assignee).toBe("http://b");
  });

  it("an issue due today is current-week load, not overdue", () => {
    // NOW is mid-day Jun 10; the date-only due value parses to midnight.
    const w = computeWorkload([mk({ url: "1", estimate: 4, dateDue: new Date("2026-06-10") })], NOW, 2);
    expect(w.rows[0].buckets.map((b) => b.points)).toEqual([0, 4, 0, 0, 0]);
    expect(computeStats([mk({ url: "1", dateDue: new Date("2026-06-10") })], NOW).overdue).toBe(0);
  });

  it("buckets unassigned open work under assignee undefined", () => {
    const w = computeWorkload([mk({ url: "1", estimate: 4 })], NOW, 4);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0].assignee).toBeUndefined();
    expect(w.rows[0].points).toBe(4);
  });
});

describe("computeBurndown", () => {
  const sprint: SprintRecord = {
    iri: "s1",
    title: "Sprint 1",
    state: "active",
    startDate: new Date("2026-06-08"),
    endDate: new Date("2026-06-12"),
    taskUrls: ["a", "b", "c"],
  };

  it("burns points down by completion day against an ideal line", () => {
    const issues = [
      mk({ url: "a", estimate: 5, status: "done", state: "closed", endedAt: new Date("2026-06-09T15:00:00Z") }),
      mk({ url: "b", estimate: 3 }),
      mk({ url: "c" }), // unestimated: not in the points scope (like velocity)
    ];
    // NOW is Jun 10: remaining is known for Jun 8–10, ideal spans all 5 days.
    const points = computeBurndown(sprint, issues, NOW);
    expect(points).toHaveLength(5);
    expect(points[0]).toMatchObject({ remaining: 8, ideal: 8 });
    expect(points[1].remaining).toBe(3); // a (5pts) done on Jun 9
    expect(points[2].remaining).toBe(3);
    expect(points[3].remaining).toBeUndefined(); // the future has no data
    expect(points[4].ideal).toBe(0);
  });

  it("uses the committed-points snapshot for completed sprints (released work stays remaining)", () => {
    // Completing the sprint released b (3pts unfinished) — taskUrls keep only a.
    const done: SprintRecord = { ...sprint, state: "done", taskUrls: ["a"], committedPoints: 8 };
    const issues = [mk({ url: "a", estimate: 5, status: "done", state: "closed", endedAt: new Date("2026-06-09T15:00:00Z") })];
    const points = computeBurndown(done, issues, NOW);
    expect(points[0].remaining).toBe(8);
    expect(points[1].remaining).toBe(3); // released work never burns down
    expect(points[2].remaining).toBe(3);
  });

  it("returns no points without sprint dates", () => {
    expect(computeBurndown({ ...sprint, startDate: undefined }, [], NOW)).toEqual([]);
  });
});

describe("computeCumulativeFlow", () => {
  it("accumulates created vs done counts per day", () => {
    const issues = [
      mk({ url: "1", created: new Date("2026-06-08T09:00:00Z") }),
      mk({ url: "2", created: new Date("2026-06-08T15:00:00Z"), state: "closed", status: "done", endedAt: new Date("2026-06-09T11:00:00Z") }),
      mk({ url: "3", created: new Date("2026-06-10T08:00:00Z") }),
      mk({ url: "4" }), // no created date: excluded
    ];
    const flow = computeCumulativeFlow(issues, NOW);
    expect(flow).toHaveLength(3); // Jun 8 → Jun 10
    expect(flow[0]).toMatchObject({ open: 2, done: 0 });
    expect(flow[1]).toMatchObject({ open: 1, done: 1 });
    expect(flow[2]).toMatchObject({ open: 2, done: 1 });
  });

  it("clamps the window to the most recent days", () => {
    const issues = [
      mk({ url: "1", created: new Date("2026-01-01") }),
      mk({ url: "2", created: new Date("2026-06-09") }),
    ];
    const flow = computeCumulativeFlow(issues, NOW, 7);
    expect(flow).toHaveLength(7);
    expect(flow[0].open).toBe(1); // the January issue is already in the baseline
    expect(flow.at(-1)!.open).toBe(2);
  });

  it("is empty when no issue has a created date", () => {
    expect(computeCumulativeFlow([mk({ url: "1" })], NOW)).toEqual([]);
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

describe("statusSlugFromClass", () => {
  it("extracts the slug after #status-", () => {
    expect(statusSlugFromClass("https://pod.example/tracker.ttl#status-in-progress")).toBe("in-progress");
    expect(statusSlugFromClass("https://pod.example/tracker.ttl#status-done")).toBe("done");
  });
  it("returns undefined for a non-status IRI or missing value", () => {
    expect(statusSlugFromClass("https://pod.example/tracker.ttl#priority-high")).toBeUndefined();
    expect(statusSlugFromClass(undefined)).toBeUndefined();
  });
});

describe("computeCumulativeFlowBands", () => {
  // A status transition into `to` at `at`.
  const tx = (to: string, iso: string): StatusTransition => ({ to, at: new Date(iso) });

  it("replays the activity log into not-started / in-progress / done bands per day", () => {
    // Issue 1: created Jun 8 (todo), → in-progress Jun 9, → done Jun 10.
    // Issue 2: created Jun 8 (todo), → in-progress Jun 10 (still open at NOW).
    // Issue 3: created Jun 9 (todo), no transitions (stays not-started).
    const issues = [
      mk({ url: "1", created: new Date("2026-06-08T09:00:00Z"), state: "closed", status: "done" }),
      mk({ url: "2", created: new Date("2026-06-08T09:00:00Z"), state: "open", status: "in-progress" }),
      mk({ url: "3", created: new Date("2026-06-09T09:00:00Z"), state: "open", status: "todo" }),
    ];
    const history = new Map<string, StatusTransition[]>([
      ["1", [tx("in-progress", "2026-06-09T10:00:00Z"), tx("done", "2026-06-10T10:00:00Z")]],
      ["2", [tx("in-progress", "2026-06-10T08:00:00Z")]],
      ["3", []],
    ]);
    const flow = computeCumulativeFlowBands(issues, history, DEFAULT_WORKFLOW, NOW);
    expect(flow).toHaveLength(3); // Jun 8 → Jun 10
    // Jun 8: only 1 & 2 exist, both still at todo → not-started.
    expect(flow[0]).toMatchObject({ notStarted: 2, inProgress: 0, done: 0 });
    // Jun 9: 3 created (todo); 1 moved to in-progress; 2 still todo.
    expect(flow[1]).toMatchObject({ notStarted: 2, inProgress: 1, done: 0 });
    // Jun 10: 1 done; 2 in-progress; 3 still not-started.
    expect(flow[2]).toMatchObject({ notStarted: 1, inProgress: 1, done: 1 });
  });

  it("shows no in-progress day for an issue that went straight open→closed", () => {
    // Created Jun 8 (todo), closed Jun 9 directly (todo → done, no in-progress).
    const issues = [mk({ url: "1", created: new Date("2026-06-08T09:00:00Z"), state: "closed", status: "done" })];
    const history = new Map<string, StatusTransition[]>([["1", [tx("done", "2026-06-09T10:00:00Z")]]]);
    const flow = computeCumulativeFlowBands(issues, history, DEFAULT_WORKFLOW, NOW);
    expect(flow.map((f) => f.inProgress)).toEqual([0, 0, 0]); // never in-progress
    expect(flow[0]).toMatchObject({ notStarted: 1, done: 0 });
    expect(flow[1]).toMatchObject({ notStarted: 0, done: 1 });
    expect(flow[2]).toMatchObject({ notStarted: 0, done: 1 });
  });

  it("is workflow-correct for a custom workflow (custom in-progress = open past initial)", () => {
    // Triage → Building → Shipped(terminal). Building is a custom in-progress.
    const custom: WorkflowDef = {
      statuses: [
        { slug: "triage", label: "Triage", terminal: false },
        { slug: "building", label: "Building", terminal: false },
        { slug: "shipped", label: "Shipped", terminal: true },
      ],
      transitions: { triage: ["building"], building: ["shipped"], shipped: [] },
    };
    const issues = [mk({ url: "1", created: new Date("2026-06-08T09:00:00Z"), state: "open", status: "building" })];
    const history = new Map<string, StatusTransition[]>([["1", [tx("building", "2026-06-09T10:00:00Z")]]]);
    const flow = computeCumulativeFlowBands(issues, history, custom, NOW);
    // Jun 8 at triage (initial) → not-started; Jun 9+ moved to building → in-progress.
    expect(flow[0]).toMatchObject({ notStarted: 1, inProgress: 0, done: 0 });
    expect(flow[1]).toMatchObject({ notStarted: 0, inProgress: 1, done: 0 });
    expect(flow[2]).toMatchObject({ notStarted: 0, inProgress: 1, done: 0 });
  });

  it("falls back to the current record when an issue has no recorded history", () => {
    // No history entries: an open in-progress record reads from its current status;
    // a closed record with an endedAt reads as done from that day.
    const issues = [
      mk({ url: "1", created: new Date("2026-06-08T09:00:00Z"), state: "open", status: "in-progress" }),
      mk({ url: "2", created: new Date("2026-06-08T09:00:00Z"), state: "closed", status: "done", endedAt: new Date("2026-06-09T10:00:00Z") }),
    ];
    const flow = computeCumulativeFlowBands(issues, new Map(), DEFAULT_WORKFLOW, NOW);
    // Issue 1's current status is in-progress for every day it exists (no history
    // to time-resolve). Issue 2 is closed but only counts done from its endedAt
    // day onward — before that, with no timeline, it reads as not-started rather
    // than falsely closed.
    expect(flow[0]).toMatchObject({ inProgress: 1, notStarted: 1, done: 0 });
    expect(flow[1]).toMatchObject({ inProgress: 1, notStarted: 0, done: 1 });
    expect(flow[2]).toMatchObject({ inProgress: 1, notStarted: 0, done: 1 });
  });

  it("is empty when no issue has a created date", () => {
    expect(computeCumulativeFlowBands([mk({ url: "1" })], new Map(), DEFAULT_WORKFLOW, NOW)).toEqual([]);
  });

  it("clamps the window to the most recent days", () => {
    const issues = [
      mk({ url: "1", created: new Date("2026-01-01"), state: "open", status: "todo" }),
      mk({ url: "2", created: new Date("2026-06-09"), state: "open", status: "todo" }),
    ];
    const flow = computeCumulativeFlowBands(issues, new Map(), DEFAULT_WORKFLOW, NOW, 7);
    expect(flow).toHaveLength(7);
    expect(flow[0].notStarted).toBe(1); // the January issue is already in the baseline
    expect(flow.at(-1)!.notStarted).toBe(2);
  });

  it("reconciles partial log with current record so recent done/reopen past the page cap shows correctly", () => {
    // Simulates an issue with many activity pages where only the OLDEST pages
    // were read (pages 0..3, the default cap). The read pages show it going
    // in-progress on Jun 8 — but the issue's current record shows it was marked
    // done on Jun 10 (a transition that lived on a later page that was not read).
    // Without reconciliation the CFD would wrongly show it as in-progress on
    // Jun 10 (the replayed log's last known state). With reconciliation the
    // current record is injected as an anchor, so Jun 10 correctly shows as done.
    const issues = [
      mk({
        url: "1",
        created: new Date("2026-06-08T09:00:00Z"),
        state: "closed",
        status: "done",
        // modified reflects the time of the latest status change (Jun 10)
        modified: new Date("2026-06-10T08:00:00Z"),
        endedAt: new Date("2026-06-10T08:00:00Z"),
      }),
    ];
    // The truncated log only has the in-progress transition (oldest page).
    // The done transition lives on a later page that was NOT read.
    const truncatedHistory = new Map<string, StatusTransition[]>([
      ["1", [tx("in-progress", "2026-06-08T10:00:00Z")]],
    ]);
    const flow = computeCumulativeFlowBands(issues, truncatedHistory, DEFAULT_WORKFLOW, NOW);
    // Jun 8: only created today; moved to in-progress (log replay).
    expect(flow[0]).toMatchObject({ notStarted: 0, inProgress: 1, done: 0 });
    // Jun 9: still in-progress per log; anchor not yet (anchor is Jun 10).
    expect(flow[1]).toMatchObject({ notStarted: 0, inProgress: 1, done: 0 });
    // Jun 10: anchor transition (current record: done, Jun 10) fires → done.
    // Without the anchor this would wrongly remain in-progress.
    expect(flow[2]).toMatchObject({ notStarted: 0, inProgress: 0, done: 1 });
  });

  it("does not corrupt historical bands when the anchor is in the past", () => {
    // An issue that was closed months ago, with a full transition log available.
    // The anchor (current record: done, modified=Jun 8) must not affect days
    // before Jun 8; the log replay drives those.
    const issues = [
      mk({
        url: "1",
        created: new Date("2026-06-08T09:00:00Z"),
        state: "closed",
        status: "done",
        modified: new Date("2026-06-09T10:00:00Z"),
        endedAt: new Date("2026-06-09T10:00:00Z"),
      }),
    ];
    // Full log: in-progress Jun 8, done Jun 9.
    const fullHistory = new Map<string, StatusTransition[]>([
      ["1", [tx("in-progress", "2026-06-08T10:00:00Z"), tx("done", "2026-06-09T10:00:00Z")]],
    ]);
    const flow = computeCumulativeFlowBands(issues, fullHistory, DEFAULT_WORKFLOW, NOW);
    // Jun 8: in-progress (log replay; anchor at Jun 9 has no effect on this day).
    expect(flow[0]).toMatchObject({ notStarted: 0, inProgress: 1, done: 0 });
    // Jun 9+: done (log replay + anchor agree).
    expect(flow[1]).toMatchObject({ notStarted: 0, inProgress: 0, done: 1 });
    expect(flow[2]).toMatchObject({ notStarted: 0, inProgress: 0, done: 1 });
  });

  it("reconciles a recently reopened issue (done→in-progress) that lives past the page cap", () => {
    // An issue went todo→in-progress→done on older pages, then was reopened
    // (done→in-progress) on a page past the cap. The current record shows
    // in-progress. The truncated log only shows todo→in-progress→done.
    // The anchor (current record: in-progress, modified=Jun 10) must override
    // the stale done state for Jun 10.
    const issues = [
      mk({
        url: "1",
        created: new Date("2026-06-08T09:00:00Z"),
        state: "open",
        status: "in-progress",
        modified: new Date("2026-06-10T08:00:00Z"),
      }),
    ];
    // Truncated log: only the todo→in-progress→done transitions (oldest pages).
    const truncatedHistory = new Map<string, StatusTransition[]>([
      [
        "1",
        [tx("in-progress", "2026-06-08T10:00:00Z"), tx("done", "2026-06-09T08:00:00Z")],
      ],
    ]);
    const flow = computeCumulativeFlowBands(issues, truncatedHistory, DEFAULT_WORKFLOW, NOW);
    // Jun 8: in-progress.
    expect(flow[0]).toMatchObject({ notStarted: 0, inProgress: 1, done: 0 });
    // Jun 9: log says done (transition fired at Jun 9 08:00; anchor is Jun 10).
    expect(flow[1]).toMatchObject({ notStarted: 0, inProgress: 0, done: 1 });
    // Jun 10: anchor fires (in-progress, Jun 10) → overrides the stale done state.
    expect(flow[2]).toMatchObject({ notStarted: 0, inProgress: 1, done: 0 });
  });

  it("MEDIUM 1 — empty history array is treated the same as absent history (no synthetic anchor injected)", () => {
    // An issue whose history entry is an empty array `[]` must use the no-history
    // fallback path, not inject a synthetic anchor. Before the fix, `!logged` was
    // false for `[]` (truthy), so the issue got an anchor to its current status at
    // `now`, misclassifying it as having real history.
    //
    // Here: issue 1 is closed with no log entries (empty array). The no-history
    // fallback for a closed issue uses `endedAt` — so it should count as done only
    // from Jun 9, not from its current status at `now`.
    const issues = [
      mk({
        url: "1",
        created: new Date("2026-06-08T09:00:00Z"),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-09T10:00:00Z"),
      }),
    ];
    // Explicitly mapped to an empty array — no real transitions recorded.
    const flow = computeCumulativeFlowBands(issues, new Map([["1", []]]), DEFAULT_WORKFLOW, NOW);
    // Jun 8: closed issue, no log, endedAt is Jun 9 → before Jun 9 it reads as not-started.
    expect(flow[0]).toMatchObject({ notStarted: 1, inProgress: 0, done: 0 });
    // Jun 9: endedAt fires → done.
    expect(flow[1]).toMatchObject({ notStarted: 0, inProgress: 0, done: 1 });
    // Jun 10: still done.
    expect(flow[2]).toMatchObject({ notStarted: 0, inProgress: 0, done: 1 });
  });

  it("MEDIUM 2 — closed issue anchor uses endedAt (not modified) when endedAt precedes a later non-status edit", () => {
    // An issue was done on Jun 8 but had a comment/label edit on Jun 10 that bumped
    // `modified`. Before the fix the anchor timestamp was `modified` (Jun 10), so the
    // CFD showed the issue as in-progress between Jun 8 and Jun 9 even though it was
    // already done. With the fix the anchor uses `endedAt` (Jun 8) so the done band
    // starts correctly.
    const issues = [
      mk({
        url: "1",
        created: new Date("2026-06-08T09:00:00Z"),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-08T12:00:00Z"), // actual completion
        modified: new Date("2026-06-10T09:00:00Z"), // later non-status edit
      }),
    ];
    // Truncated log: only the in-progress transition; the done transition was on a
    // later (unread) page. The anchor must land at endedAt (Jun 8), not modified (Jun 10).
    const truncatedHistory = new Map<string, StatusTransition[]>([
      ["1", [tx("in-progress", "2026-06-08T10:00:00Z")]],
    ]);
    const flow = computeCumulativeFlowBands(issues, truncatedHistory, DEFAULT_WORKFLOW, NOW);
    // Jun 8: created and in-progress per log; anchor is ALSO Jun 8 (endedAt) → done wins.
    expect(flow[0]).toMatchObject({ notStarted: 0, inProgress: 0, done: 1 });
    // Jun 9 & 10: still done (anchor fired on Jun 8).
    expect(flow[1]).toMatchObject({ notStarted: 0, inProgress: 0, done: 1 });
    expect(flow[2]).toMatchObject({ notStarted: 0, inProgress: 0, done: 1 });
  });
});

describe("percentile / median", () => {
  it("interpolates linearly between nearest ranks (PERCENTILE.INC)", () => {
    const v = [1, 2, 3, 4];
    // p50 of [1,2,3,4]: rank = 0.5*3 = 1.5 → between 2 and 3 → 2.5.
    expect(percentile(v, 0.5)).toBe(2.5);
    expect(median(v)).toBe(2.5);
    // p85: rank = 0.85*3 = 2.55 → 3 + 0.55*(4-3) = 3.55.
    expect(percentile(v, 0.85)).toBeCloseTo(3.55, 10);
  });

  it("median of an odd sample is the middle value", () => {
    expect(median([5, 1, 3])).toBe(3); // sorted [1,3,5] → 3
  });

  it("handles boundary p values and single/empty samples", () => {
    expect(percentile([10, 20, 30], 0)).toBe(10);
    expect(percentile([10, 20, 30], 1)).toBe(30);
    expect(percentile([7], 0.85)).toBe(7);
    expect(percentile([], 0.5)).toBeUndefined();
    expect(median([])).toBeUndefined();
  });

  it("does not mutate the input array", () => {
    const v = [3, 1, 2];
    percentile(v, 0.5);
    expect(v).toEqual([3, 1, 2]);
  });

  it("clamps out-of-range p into [0,1]", () => {
    expect(percentile([1, 2, 3], -1)).toBe(1);
    expect(percentile([1, 2, 3], 2)).toBe(3);
  });
});

describe("computeControlChart", () => {
  const tx = (to: string, iso: string): StatusTransition => ({ to, at: new Date(iso) });

  it("computes cycle (in-progress→closed) and lead (created→closed) per closed issue", () => {
    // Issue 1: created Jun 1, in-progress Jun 3, done Jun 8 → cycle 5d, lead 7d.
    // Issue 2: created Jun 2, in-progress Jun 4, done Jun 6 → cycle 2d, lead 4d.
    // Open issue 3 is excluded (no completion).
    const issues = [
      mk({
        url: "1",
        title: "One",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-08T00:00:00Z"),
      }),
      mk({
        url: "2",
        title: "Two",
        created: new Date("2026-06-02T00:00:00Z"),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-06T00:00:00Z"),
      }),
      mk({ url: "3", title: "Open", created: new Date("2026-06-03T00:00:00Z"), state: "open", status: "in-progress" }),
    ];
    const history = new Map<string, StatusTransition[]>([
      ["1", [tx("in-progress", "2026-06-03T00:00:00Z"), tx("done", "2026-06-08T00:00:00Z")]],
      ["2", [tx("in-progress", "2026-06-04T00:00:00Z"), tx("done", "2026-06-06T00:00:00Z")]],
    ]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    expect(cc.points).toHaveLength(2);
    // Ascending by completion date: Two (Jun 6) before One (Jun 8).
    expect(cc.points.map((p) => p.url)).toEqual(["2", "1"]);
    expect(cc.points.find((p) => p.url === "1")).toMatchObject({ cycleDays: 5, leadDays: 7 });
    expect(cc.points.find((p) => p.url === "2")).toMatchObject({ cycleDays: 2, leadDays: 4 });
  });

  it("an issue closed without ever being in-progress has cycle time 0 but a real lead time", () => {
    // Created Jun 1, went straight todo→done Jun 5 (no in-progress transition).
    const issues = [
      mk({
        url: "1",
        title: "Quick",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-05T00:00:00Z"),
      }),
    ];
    const history = new Map<string, StatusTransition[]>([["1", [tx("done", "2026-06-05T00:00:00Z")]]]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    expect(cc.points).toHaveLength(1);
    expect(cc.points[0]).toMatchObject({ cycleDays: 0, leadDays: 4 });
  });

  it("falls back to the current record's endedAt when no log transitions exist", () => {
    // No recorded history at all: completion comes from endedAt (anchor); no
    // in-progress transition → cycle 0; lead from created.
    const issues = [
      mk({
        url: "1",
        title: "Legacy",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-04T00:00:00Z"),
      }),
    ];
    const cc = computeControlChart(issues, new Map(), DEFAULT_WORKFLOW);
    expect(cc.points[0]).toMatchObject({ url: "1", cycleDays: 0, leadDays: 3 });
  });

  it("reconciles a completion past the log page cap via the endedAt anchor", () => {
    // The truncated log only has the in-progress transition (oldest page); the
    // done transition lived on an unread page. The endedAt anchor (Jun 9) recovers
    // the completion → cycle = Jun 5 → Jun 9 = 4d.
    const issues = [
      mk({
        url: "1",
        title: "Capped",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-09T00:00:00Z"),
      }),
    ];
    const history = new Map<string, StatusTransition[]>([["1", [tx("in-progress", "2026-06-05T00:00:00Z")]]]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    expect(cc.points[0]).toMatchObject({ cycleDays: 4, leadDays: 8 });
  });

  it("omits a lead time when the issue has no created date", () => {
    const issues = [
      mk({ url: "1", title: "Undated", state: "closed", status: "done", endedAt: new Date("2026-06-05T00:00:00Z") }),
    ];
    const history = new Map<string, StatusTransition[]>([["1", [tx("in-progress", "2026-06-03T00:00:00Z"), tx("done", "2026-06-05T00:00:00Z")]]]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    expect(cc.points[0].cycleDays).toBe(2);
    expect(cc.points[0].leadDays).toBeUndefined();
    expect(cc.medianLead).toBeUndefined();
  });

  it("skips a closed issue with no recoverable completion timestamp", () => {
    // Closed by status but no endedAt, no modified, and no closing transition in
    // the log → no completion time → not plotted.
    const issues = [mk({ url: "1", title: "No stamp", created: new Date("2026-06-01T00:00:00Z"), state: "closed", status: "done" })];
    const cc = computeControlChart(issues, new Map(), DEFAULT_WORKFLOW);
    expect(cc.points).toHaveLength(0);
  });

  it("is workflow-correct for a custom workflow (custom in-progress = open past initial)", () => {
    // Triage(initial) → Building(in-progress) → Shipped(terminal).
    const custom: WorkflowDef = {
      statuses: [
        { slug: "triage", label: "Triage", terminal: false },
        { slug: "building", label: "Building", terminal: false },
        { slug: "shipped", label: "Shipped", terminal: true },
      ],
      transitions: { triage: ["building"], building: ["shipped"], shipped: [] },
    };
    const issues = [
      mk({
        url: "1",
        title: "Custom",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "shipped",
        endedAt: new Date("2026-06-07T00:00:00Z"),
      }),
    ];
    const history = new Map<string, StatusTransition[]>([["1", [tx("building", "2026-06-04T00:00:00Z"), tx("shipped", "2026-06-07T00:00:00Z")]]]);
    const cc = computeControlChart(issues, history, custom);
    // Building (Jun 4) is the in-progress start; shipped (Jun 7) the completion.
    expect(cc.points[0]).toMatchObject({ cycleDays: 3, leadDays: 6 });
  });

  it("computes median and 85th-percentile cycle and lead summary stats", () => {
    // Four closed issues with cycle times 1,2,3,4 and lead times 2,4,6,8.
    const mkClosed = (url: string, cycle: number, lead: number): IssueRecord =>
      mk({
        url,
        title: url,
        created: new Date(Date.UTC(2026, 5, 10 - lead, 0, 0, 0)),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-10T00:00:00Z"),
        modified: new Date("2026-06-10T00:00:00Z"),
      });
    const issues = [mkClosed("a", 1, 2), mkClosed("b", 2, 4), mkClosed("c", 3, 6), mkClosed("d", 4, 8)];
    const history = new Map<string, StatusTransition[]>([
      ["a", [tx("in-progress", "2026-06-09T00:00:00Z"), tx("done", "2026-06-10T00:00:00Z")]],
      ["b", [tx("in-progress", "2026-06-08T00:00:00Z"), tx("done", "2026-06-10T00:00:00Z")]],
      ["c", [tx("in-progress", "2026-06-07T00:00:00Z"), tx("done", "2026-06-10T00:00:00Z")]],
      ["d", [tx("in-progress", "2026-06-06T00:00:00Z"), tx("done", "2026-06-10T00:00:00Z")]],
    ]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    expect(cc.points.map((p) => p.cycleDays)).toEqual([1, 2, 3, 4]);
    expect(cc.medianCycle).toBe(2.5);
    expect(cc.p85Cycle).toBeCloseTo(3.55, 10);
    expect(cc.medianLead).toBe(5);
    expect(cc.p85Lead).toBeCloseTo(7.1, 10);
  });

  it("returns empty stats with no closed issues", () => {
    const cc = computeControlChart([mk({ url: "1", state: "open", status: "todo" })], new Map(), DEFAULT_WORKFLOW);
    expect(cc.points).toEqual([]);
    expect(cc.medianCycle).toBeUndefined();
    expect(cc.p85Cycle).toBeUndefined();
  });

  it("measures a reopened issue against its FINAL closure, not the first (roborev MEDIUM)", () => {
    // Reopened-and-reclosed: in-progress Jun 2 → done Jun 4 → in-progress Jun 7 → done Jun 10.
    // The control chart must measure the CURRENT (final) cycle: started Jun 7, completed
    // Jun 10 → cycle 3d; lead = created Jun 1 → final completion Jun 10 = 9d. Measuring the
    // first closure (Jun 4) would wrongly give cycle 2d / lead 3d and the wrong completion date.
    const issues = [
      mk({
        url: "1",
        title: "Reopened",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-10T00:00:00Z"),
        modified: new Date("2026-06-10T00:00:00Z"),
      }),
    ];
    const history = new Map<string, StatusTransition[]>([
      [
        "1",
        [
          tx("in-progress", "2026-06-02T00:00:00Z"),
          tx("done", "2026-06-04T00:00:00Z"),
          tx("in-progress", "2026-06-07T00:00:00Z"),
          tx("done", "2026-06-10T00:00:00Z"),
        ],
      ],
    ]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    expect(cc.points).toHaveLength(1);
    expect(cc.points[0]).toMatchObject({ cycleDays: 3, leadDays: 9 });
    expect(cc.points[0].completedAt.toISOString()).toBe("2026-06-10T00:00:00.000Z");
  });

  it("a later non-status edit (modified) never inflates completion past a logged closure (roborev MEDIUM)", () => {
    // No endedAt; the log carries a real done transition on Jun 5, but `modified`
    // was bumped to Jun 10 by a comment/label edit AFTER closing. The completion
    // must stay at the logged closure (Jun 5), NOT the modified anchor (Jun 10) —
    // otherwise cycle (Jun 3 → ?) and lead inflate and the sort key is wrong.
    const issues = [
      mk({
        url: "1",
        title: "Edited after close",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "done",
        modified: new Date("2026-06-10T00:00:00Z"), // later non-status edit, no endedAt
      }),
    ];
    const history = new Map<string, StatusTransition[]>([
      ["1", [tx("in-progress", "2026-06-03T00:00:00Z"), tx("done", "2026-06-05T00:00:00Z")]],
    ]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    // Completion = Jun 5 (logged), cycle = Jun 3 → Jun 5 = 2d, lead = Jun 1 → Jun 5 = 4d.
    expect(cc.points[0]).toMatchObject({ cycleDays: 2, leadDays: 4 });
    expect(cc.points[0].completedAt.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });

  it("marks the cycle UNKNOWN (not 0) when a reopen's restart is lost to the page cap (roborev MEDIUM)", () => {
    // statusHistory reads OLDEST pages first. Visible pages end at a STALE closure
    // (in-progress Jun 3 → done Jun 5), but endedAt shows a LATER completion (Jun 12):
    // the issue was reopened AND reclosed in the unread gap, so its restart is
    // unrecoverable. Plotting cycle 0 would misreport a real reopened cycle, so the
    // cycle is UNKNOWN (undefined) — but the lead time (created → Jun 12) is still valid.
    const issues = [
      mk({
        url: "1",
        title: "Truncated reopen",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-12T00:00:00Z"), // final completion, past the cap
      }),
    ];
    const history = new Map<string, StatusTransition[]>([
      ["1", [tx("in-progress", "2026-06-03T00:00:00Z"), tx("done", "2026-06-05T00:00:00Z")]],
    ]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    expect(cc.points).toHaveLength(1);
    expect(cc.points[0].cycleDays).toBeUndefined(); // restart lost to truncation
    expect(cc.points[0].leadDays).toBe(11); // Jun 1 → Jun 12
    expect(cc.points[0].completedAt.toISOString()).toBe("2026-06-12T00:00:00.000Z");
    // Cycle stats exclude the unknown-cycle point; lead stats still include it.
    expect(cc.medianCycle).toBeUndefined();
    expect(cc.p85Cycle).toBeUndefined();
    expect(cc.medianLead).toBe(11);
    // The row carries no scatter cycle / rolling for the truncated point.
    const rows = controlChartRows(cc.points);
    expect(rows[0].cycle).toBeUndefined();
    expect(rows[0].rolling).toBeUndefined();
    expect(rows[0].lead).toBe(11);
  });

  it("marks the cycle UNKNOWN when the last logged state is a reopen-to-initial and the final close is recovered (roborev MEDIUM)", () => {
    // Visible log ends at a reopen to the initial status: in-progress Jun 3 →
    // done Jun 5 → todo Jun 7, and `endedAt` (Jun 12) is LATER than the last logged
    // `todo`. The final close — and any in-progress restart between Jun 7 and Jun 12
    // — lived in the unread page-cap gap, so the final cycle is UNKNOWN, not a
    // spurious 0 (the issue may well have been worked on in that gap).
    const issues = [
      mk({
        url: "1",
        title: "Truncated reopen-to-initial",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-12T00:00:00Z"), // final close, past the cap
      }),
    ];
    const history = new Map<string, StatusTransition[]>([
      [
        "1",
        [
          tx("in-progress", "2026-06-03T00:00:00Z"),
          tx("done", "2026-06-05T00:00:00Z"),
          tx("todo", "2026-06-07T00:00:00Z"),
        ],
      ],
    ]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    expect(cc.points[0].cycleDays).toBeUndefined(); // restart/close lost to the cap
    expect(cc.points[0].leadDays).toBe(11); // Jun 1 → Jun 12 still valid
  });

  it("a fully-logged reopen-to-initial is cycle 0, NOT unknown (the final done is in the log)", () => {
    // Same as the reopen-to-initial case but emphasising it is NOT truncated: the
    // final done IS a logged transition (the anchor coincides, not strictly after
    // the last logged state), so the cycle is a genuine 0, never undefined.
    const issues = [
      mk({
        url: "1",
        title: "Fully logged reopen",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-10T00:00:00Z"),
      }),
    ];
    const history = new Map<string, StatusTransition[]>([
      [
        "1",
        [
          tx("in-progress", "2026-06-02T00:00:00Z"),
          tx("done", "2026-06-04T00:00:00Z"),
          tx("todo", "2026-06-07T00:00:00Z"),
          tx("done", "2026-06-10T00:00:00Z"),
        ],
      ],
    ]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    expect(cc.points[0].cycleDays).toBe(0); // genuine no-WIP final cycle, not unknown
  });

  it("recovers a capped reopen's final closure from modified even when a STALE logged closure exists (roborev MEDIUM)", () => {
    // Page-capped reopen with no endedAt: log shows in-progress Jun 3 → done Jun 5
    // (an EARLIER cycle) → in-progress Jun 7, but the FINAL done lived past the cap.
    // The current record is closed with modified Jun 12. Because the log's LAST state
    // is in-progress (not closed), the modified anchor must recover the current
    // completion (Jun 12) rather than reporting the stale Jun 5 closure.
    const issues = [
      mk({
        url: "1",
        title: "Capped reopen",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "done",
        modified: new Date("2026-06-12T00:00:00Z"), // current close (real close past the cap)
      }),
    ];
    const history = new Map<string, StatusTransition[]>([
      [
        "1",
        [
          tx("in-progress", "2026-06-03T00:00:00Z"),
          tx("done", "2026-06-05T00:00:00Z"),
          tx("in-progress", "2026-06-07T00:00:00Z"),
        ],
      ],
    ]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    // Completion = Jun 12 (recovered); current active spell started Jun 7 (after the
    // stale Jun 5 closure) → cycle = Jun 7 → Jun 12 = 5d; lead = Jun 1 → Jun 12 = 11d.
    expect(cc.points[0]).toMatchObject({ cycleDays: 5, leadDays: 11 });
    expect(cc.points[0].completedAt.toISOString()).toBe("2026-06-12T00:00:00.000Z");
  });

  it("uses modified as a completion fallback only when no logged closure and no endedAt exist", () => {
    // No endedAt and the log has NO closed transition (only an in-progress on a
    // read page; the real closure lived past the page cap). `modified` then
    // recovers the completion date so the closed issue is still plotted.
    const issues = [
      mk({
        url: "1",
        title: "Capped, no endedAt",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "done",
        modified: new Date("2026-06-08T00:00:00Z"),
      }),
    ];
    const history = new Map<string, StatusTransition[]>([["1", [tx("in-progress", "2026-06-04T00:00:00Z")]]]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    expect(cc.points[0]).toMatchObject({ cycleDays: 4, leadDays: 7 }); // Jun 4→8 = 4, Jun 1→8 = 7
  });

  it("a reopen to the initial status with no fresh in-progress move yields cycle 0 for the final cycle", () => {
    // in-progress Jun 2 → done Jun 4 → todo Jun 7 (reopened to initial) → done Jun 10.
    // No in-progress entry exists after the reopen, so the FINAL cycle spent no time in
    // active work → cycle 0; lead = created Jun 1 → final completion Jun 10 = 9d. The OLD
    // pre-reopen active spell (Jun 2–4) must NOT be charged to this cycle.
    const issues = [
      mk({
        url: "1",
        title: "Reopened to todo",
        created: new Date("2026-06-01T00:00:00Z"),
        state: "closed",
        status: "done",
        endedAt: new Date("2026-06-10T00:00:00Z"),
      }),
    ];
    const history = new Map<string, StatusTransition[]>([
      [
        "1",
        [
          tx("in-progress", "2026-06-02T00:00:00Z"),
          tx("done", "2026-06-04T00:00:00Z"),
          tx("todo", "2026-06-07T00:00:00Z"),
          tx("done", "2026-06-10T00:00:00Z"),
        ],
      ],
    ]);
    const cc = computeControlChart(issues, history, DEFAULT_WORKFLOW);
    expect(cc.points[0]).toMatchObject({ cycleDays: 0, leadDays: 9 });
  });
});

describe("controlChartRows", () => {
  it("formats points and computes a trailing rolling average of cycle time", () => {
    const points = [
      { url: "1", title: "A", completedAt: new Date("2026-06-01T00:00:00Z"), cycleDays: 2, leadDays: 4 },
      { url: "2", title: "B", completedAt: new Date("2026-06-02T00:00:00Z"), cycleDays: 4, leadDays: 6 },
      { url: "3", title: "C", completedAt: new Date("2026-06-03T00:00:00Z"), cycleDays: 6, leadDays: undefined },
    ];
    const rows = controlChartRows(points, 2);
    // Labels are locale-formatted month+day (matching the rest of the dashboard).
    // Assert against the SAME formatter (locale-agnostic) rather than an English
    // month string, and that they are non-empty and distinct.
    const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
    const expected = points.map((p) => fmt.format(p.completedAt));
    expect(rows.map((r) => r.completed)).toEqual(expected);
    expect(new Set(rows.map((r) => r.completed)).size).toBe(3);
    for (const r of rows) expect(r.completed.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.cycle)).toEqual([2, 4, 6]);
    // Rolling avg over a window of 2: [2], [2,4]→3, [4,6]→5.
    expect(rows.map((r) => r.rolling)).toEqual([2, 3, 5]);
    expect(rows[2].lead).toBeUndefined();
    expect(rows[0].lead).toBe(4);
  });

  it("skips unknown-cycle points in the rolling window (they do not consume a slot) (roborev MEDIUM)", () => {
    // window 2 over cycles [2, undefined, 6]: the unknown middle point must NOT
    // consume a window slot, so the third row averages the last two KNOWN values
    // [2, 6] = 4, not just [6]. The unknown row itself carries the previous rolling
    // (only the known value 2 has been seen) and no scatter cycle.
    const points = [
      { url: "1", title: "A", completedAt: new Date("2026-06-01T00:00:00Z"), cycleDays: 2, leadDays: 4 },
      { url: "2", title: "B", completedAt: new Date("2026-06-02T00:00:00Z"), cycleDays: undefined, leadDays: 6 },
      { url: "3", title: "C", completedAt: new Date("2026-06-03T00:00:00Z"), cycleDays: 6, leadDays: 8 },
    ];
    const rows = controlChartRows(points, 2);
    expect(rows[0]).toMatchObject({ cycle: 2, rolling: 2 });
    // The unknown-cycle row carries NEITHER a scatter cycle NOR a rolling value, so
    // the average line gaps over its completion date rather than crossing an
    // explicitly-unknown x.
    expect(rows[1].cycle).toBeUndefined();
    expect(rows[1].rolling).toBeUndefined();
    // The third row's rolling is the last two KNOWN cycles [2, 6] = 4 (NOT [6] = 6) —
    // the unknown middle row did not consume a window slot.
    expect(rows[2]).toMatchObject({ cycle: 6, rolling: 4 });
  });

  it("a leading unknown-cycle point yields an undefined rolling until a known cycle is seen", () => {
    const points = [
      { url: "1", title: "A", completedAt: new Date("2026-06-01T00:00:00Z"), cycleDays: undefined, leadDays: 3 },
      { url: "2", title: "B", completedAt: new Date("2026-06-02T00:00:00Z"), cycleDays: 4, leadDays: 6 },
    ];
    const rows = controlChartRows(points, 5);
    expect(rows[0].rolling).toBeUndefined();
    expect(rows[0].cycle).toBeUndefined();
    expect(rows[1]).toMatchObject({ cycle: 4, rolling: 4 });
  });

  it("rounds cycle, lead, and rolling to one decimal", () => {
    const points = [
      { url: "1", title: "A", completedAt: new Date("2026-06-01T12:00:00Z"), cycleDays: 1.25, leadDays: 2.349 },
    ];
    const rows = controlChartRows(points, 5);
    expect(rows[0].cycle).toBe(1.3);
    expect(rows[0].lead).toBe(2.3);
    expect(rows[0].rolling).toBe(1.3);
  });
});
