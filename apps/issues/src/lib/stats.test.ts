import { describe, it, expect } from "vitest";
import {
  computeBurndown,
  computeCumulativeFlow,
  computeCumulativeFlowBands,
  computeStats,
  computeVelocity,
  computeWorkload,
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
