import type { IssueRecord, SprintRecord } from "./repository";
import {
  DEFAULT_WORKFLOW,
  ISSUE_TYPES,
  STATUSES,
  statusState,
  type IssueType,
  type StatusSlug,
  type WorkflowDef,
} from "./issue";
import { startOfUtcDay } from "./dates";

export interface TrackerStats {
  total: number;
  byStatus: { status: StatusSlug; label: string; count: number }[];
  byType: { type: IssueType; label: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  /** Per-assignee open workload (WebID; unassigned bucketed as undefined). */
  byAssignee: { assignee?: string; count: number }[];
  overdue: number;
  /** Issues created per ISO week (yyyy-Www), oldest→newest, last 8 weeks with data. */
  createdPerWeek: { week: string; count: number }[];
}

const isoWeek = (d: Date): string => {
  // ISO-8601 week number (Thursday rule).
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

/** Aggregate dashboard stats from the loaded issues (pure). */
export function computeStats(issues: IssueRecord[], now = new Date()): TrackerStats {
  const count = <K>(keys: K[], of: (i: IssueRecord) => K) =>
    keys.map((k) => ({ key: k, count: issues.filter((i) => of(i) === k).length }));

  const byStatus = STATUSES.map((s) => ({
    status: s.slug,
    label: s.label,
    count: issues.filter((i) => i.status === s.slug).length,
  }));
  const byType = ISSUE_TYPES.map((t) => ({
    type: t.slug,
    label: t.label,
    count: issues.filter((i) => i.issueType === t.slug).length,
  }));
  const byPriority = count(["high", "medium", "low", "none"], (i) => i.priority ?? "none").map(
    ({ key, count }) => ({ priority: key, count }),
  );

  const assignees = new Map<string | undefined, number>();
  for (const i of issues) {
    if (i.state === "closed") continue; // workload = open work
    assignees.set(i.assignee, (assignees.get(i.assignee) ?? 0) + 1);
  }
  const byAssignee = [...assignees]
    .map(([assignee, count]) => ({ assignee, count }))
    .sort((a, b) => b.count - a.count);

  const today = startOfUtcDay(now).getTime();
  const overdue = issues.filter(
    (i) => i.state === "open" && i.dateDue !== undefined && i.dateDue.getTime() < today,
  ).length;

  const weeks = new Map<string, number>();
  for (const i of issues) {
    if (!i.created) continue;
    const w = isoWeek(i.created);
    weeks.set(w, (weeks.get(w) ?? 0) + 1);
  }
  const createdPerWeek = [...weeks]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([week, count]) => ({ week, count }));

  return { total: issues.length, byStatus, byType, byPriority, byAssignee, overdue, createdPerWeek };
}

export interface WorkloadBucket {
  label: string;
  points: number;
  count: number;
}

export interface WorkloadRow {
  /** Assignee WebID; undefined = unassigned. */
  assignee?: string;
  count: number;
  points: number;
  buckets: WorkloadBucket[];
}

export interface Workload {
  /** Overdue · one per week (labelled by its Monday) · Later · No date. */
  bucketLabels: string[];
  /** Heaviest row (most points) first. */
  rows: WorkloadRow[];
}

/**
 * Monday-style workload: open work per assignee, bucketed by due week.
 * Unestimated issues weigh 1 point so they still register as load.
 */
export function computeWorkload(issues: IssueRecord[], now = new Date(), weeks = 4): Workload {
  // Everything in UTC days: due dates are date-only values at UTC midnight.
  const today = startOfUtcDay(now);
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const weekStarts = Array.from({ length: weeks + 1 }, (_, k) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + 7 * k);
    return d;
  });
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const bucketLabels = ["Overdue", ...weekStarts.slice(0, weeks).map((d) => fmt.format(d)), "Later", "No date"];

  const bucketOf = (i: IssueRecord): number => {
    const t = i.dateDue?.getTime();
    if (t === undefined) return bucketLabels.length - 1;
    if (t < today.getTime()) return 0;
    for (let k = 0; k < weeks; k++) if (t < weekStarts[k + 1].getTime()) return k + 1;
    return bucketLabels.length - 2;
  };

  const rows = new Map<string | undefined, WorkloadRow>();
  for (const i of issues) {
    if (i.state === "closed") continue;
    let row = rows.get(i.assignee);
    if (!row) {
      row = { assignee: i.assignee, count: 0, points: 0, buckets: bucketLabels.map((label) => ({ label, points: 0, count: 0 })) };
      rows.set(i.assignee, row);
    }
    const pts = i.estimate ?? 1;
    const bucket = row.buckets[bucketOf(i)];
    bucket.points += pts;
    bucket.count += 1;
    row.count += 1;
    row.points += pts;
  }
  return { bucketLabels, rows: [...rows.values()].sort((a, b) => b.points - a.points) };
}

export interface BurndownPoint {
  /** UTC day label, e.g. "Jun 8". */
  day: string;
  /** Points still open at that day's close; undefined for future days. */
  remaining?: number;
  /** Linear reference from full scope to zero across the sprint. */
  ideal: number;
}

/**
 * Sprint burndown from completion stamps (`endedAt`): remaining points per
 * sprint day vs the ideal line. Estimated points only (`estimate ?? 0`),
 * matching velocity and the committed-points snapshot. Returns [] when the
 * sprint has no date range.
 */
export function computeBurndown(sprint: SprintRecord, issues: IssueRecord[], now = new Date()): BurndownPoint[] {
  if (!sprint.startDate || !sprint.endDate) return [];
  const start = startOfUtcDay(sprint.startDate);
  const end = startOfUtcDay(sprint.endDate);
  if (end.getTime() < start.getTime()) return [];

  const byUrl = new Map(issues.map((i) => [i.url, i]));
  const members = sprint.taskUrls.map((u) => byUrl.get(u)).filter((i): i is IssueRecord => !!i);
  const pts = (i: IssueRecord) => i.estimate ?? 0;
  // Completing a sprint releases unfinished tasks from taskUrls, so a live
  // member sum would understate a done sprint's scope — prefer the snapshot.
  const scope = sprint.committedPoints ?? members.reduce((sum, i) => sum + pts(i), 0);

  const today = startOfUtcDay(now).getTime();
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

  return Array.from({ length: days }, (_, k) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + k);
    const doneBy = members
      .filter((i) => i.endedAt !== undefined && startOfUtcDay(i.endedAt).getTime() <= day.getTime())
      .reduce((sum, i) => sum + pts(i), 0);
    return {
      day: fmt.format(day),
      remaining: day.getTime() <= today ? scope - doneBy : undefined,
      ideal: days === 1 ? 0 : Math.round(((scope * (days - 1 - k)) / (days - 1)) * 10) / 10,
    };
  });
}

export interface FlowPoint {
  /** UTC day label, e.g. "Jun 8". */
  day: string;
  /** Issues existing and still open at that day's close. */
  open: number;
  /** Issues completed by that day's close. */
  done: number;
}

/**
 * Two-band cumulative flow from creation and completion stamps: per day, how
 * many issues existed (split open vs done) — the open/done gap is the WIP. This
 * snapshot operates on the loaded {@link IssueRecord}s, which carry only the
 * creation and completion timestamps, so it has no in-progress band. For the true
 * three-band CFD that splits in-progress out, see {@link computeCumulativeFlowBands},
 * which replays the F3 provenance log (`prov:Activity` status transitions, see
 * `Repository.statusHistory`). Spans first creation → today, clamped to `maxDays`.
 */
export function computeCumulativeFlow(issues: IssueRecord[], now = new Date(), maxDays = 56): FlowPoint[] {
  const dated = issues.filter((i) => i.created !== undefined);
  if (dated.length === 0) return [];

  const today = startOfUtcDay(now);
  const first = startOfUtcDay(new Date(Math.min(...dated.map((i) => i.created!.getTime()))));
  const span = Math.round((today.getTime() - first.getTime()) / 86_400_000) + 1;
  const days = Math.max(1, Math.min(span, maxDays));
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

  return Array.from({ length: days }, (_, k) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + k);
    const end = day.getTime() + 86_400_000;
    const existing = dated.filter((i) => i.created!.getTime() < end);
    const done = existing.filter((i) => i.endedAt !== undefined && i.endedAt.getTime() < end).length;
    return { day: fmt.format(day), open: existing.length - done, done };
  });
}

/** One recorded status change to replay: the slug it moved *to*, and when. */
export interface StatusTransition {
  /** The status slug the issue moved into (`prov:generated`, after `#status-`). */
  to: StatusSlug;
  /** When the move happened (`prov:startedAtTime`). */
  at: Date;
}

export interface FlowBandPoint {
  /** UTC day label, e.g. "Jun 8". */
  day: string;
  /** Open issues still at the initial status (never moved past it). */
  notStarted: number;
  /** Open issues that have moved away from the initial status at least once. */
  inProgress: number;
  /** Issues whose status resolved to closed by that day's close. */
  done: number;
}

/** Extract a status slug from a `#status-<slug>` class IRI; undefined otherwise. */
export function statusSlugFromClass(iri: string | undefined): StatusSlug | undefined {
  if (!iri) return undefined;
  const marker = "#status-";
  const at = iri.lastIndexOf(marker);
  return at === -1 ? undefined : iri.slice(at + marker.length);
}

/**
 * True three-band cumulative flow, reconstructed by REPLAYING the F3 provenance
 * activity log (`prov:Activity` status transitions) per issue. Where the two-band
 * {@link computeCumulativeFlow} can only split existing-vs-done from the creation
 * and completion stamps on the loaded record, this replays each issue's recorded
 * status history to recover, for every day in the window, how many issues were
 * not-started / in-progress / done.
 *
 * Banding at a given day's close, for every issue that existed by then:
 *  - **done** — its status at that point resolves to *closed* (terminal status, per
 *    {@link statusState}; custom terminal statuses count). The current record's
 *    `endedAt`/closed state is a fallback for issues with no recorded history.
 *  - **in-progress** — *open* AND it has at least one recorded transition away from
 *    the workflow's initial status by then (its replayed status ≠ the initial slug).
 *  - **not-started** — *open* AND still at the initial status (no move past it yet).
 *
 * This is workflow-correct: a custom in-progress status is just "open but past
 * initial", and an issue that went straight open→closed never shows an
 * in-progress day. Spans first creation → today, clamped to `maxDays`.
 *
 * @param statusHistory per-issue ascending-or-unsorted list of status transitions
 *   (each `{ to, at }`), keyed by issue URL. Read via the typed store layer
 *   ({@link Repository.statusHistory}); a missing/empty entry means no recorded
 *   transitions, in which case the issue's current record drives its banding.
 *   When the log is read with a page cap (see `Repository.statusHistory`), only
 *   early pages are fetched and recent transitions can be missing. To keep the
 *   present-day band always correct, the issue's current record (`status`,
 *   `modified`, `endedAt`) is injected as a synthetic anchor transition: it is
 *   appended after the log entries and participates in the ascending sort, so
 *   it dominates for every day at or after its timestamp while the older log
 *   entries still drive the historical bands correctly.
 */
export function computeCumulativeFlowBands(
  issues: IssueRecord[],
  statusHistory: ReadonlyMap<string, StatusTransition[]>,
  workflow: WorkflowDef = DEFAULT_WORKFLOW,
  now = new Date(),
  maxDays = 56,
): FlowBandPoint[] {
  const dated = issues.filter((i) => i.created !== undefined);
  if (dated.length === 0) return [];

  const initial = workflow.statuses[0]?.slug ?? "todo";

  // Per issue, an ascending status timeline to replay: the initial status, then
  // every recorded transition in time order. The slug "at time T" is the last
  // segment whose timestamp is strictly before the day's close.
  //
  // When recorded history exists and is non-empty, we also inject the current
  // record's status as a synthetic anchor transition so that days at or after
  // the issue's last modification always reflect the correct current state,
  // regardless of whether the log was read with a page cap. An absent OR empty
  // history both fall through to the no-history path (see below).
  //
  // The anchor timestamp: for a closed status, prefer `endedAt` (the actual
  // completion stamp) over `modified` (which is bumped by non-status edits),
  // then fall back to `now`. For an open status, prefer `modified`, then `now`.
  const timelines = dated.map((issue) => {
    const logged = statusHistory.get(issue.url);
    // Treat an absent OR empty history the same way: fall through to the no-history
    // path. An empty array `[]` is truthy, so an explicit `!logged` check would
    // incorrectly inject a synthetic anchor for issues with inaccessible / zero-entry
    // logs, misclassifying them as having real history. (MEDIUM 1 fix.)
    if (!logged || logged.length === 0) return { issue, transitions: [] as StatusTransition[] };

    // For a closed status, prefer `endedAt` over `modified` as the anchor timestamp.
    // `modified` is bumped by non-status edits and comments, so using it for a closed
    // issue delays the synthetic done transition to the time of the last edit rather
    // than the real completion time — making the CFD wrong between completion and
    // the edit. `endedAt` is the actual completion stamp. (MEDIUM 2 fix.)
    const isClosed = statusState(workflow, issue.status) === "closed";
    const anchorAt = (isClosed ? (issue.endedAt ?? issue.modified) : issue.modified) ?? now;
    const anchor: StatusTransition = { to: issue.status, at: anchorAt };
    const transitions = [...logged, anchor]
      .filter((t) => t.at !== undefined)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    return { issue, transitions };
  });

  const today = startOfUtcDay(now);
  const first = startOfUtcDay(new Date(Math.min(...dated.map((i) => i.created!.getTime()))));
  const span = Math.round((today.getTime() - first.getTime()) / 86_400_000) + 1;
  const days = Math.max(1, Math.min(span, maxDays));
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

  return Array.from({ length: days }, (_, k) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + k);
    const end = day.getTime() + 86_400_000;

    let notStarted = 0;
    let inProgress = 0;
    let done = 0;

    for (const { issue, transitions } of timelines) {
      if (issue.created!.getTime() >= end) continue; // not created yet

      let slug: StatusSlug;
      let moved: boolean;
      if (transitions.length > 0) {
        // Has recorded history: replay it. Before the first transition the issue
        // sits at the workflow's initial status; thereafter the latest transition
        // strictly before this day's close wins. A day before any transition is
        // therefore correctly "not started" (still at initial), NOT the current
        // record's status.
        slug = initial;
        for (const t of transitions) {
          if (t.at.getTime() >= end) break;
          slug = t.to;
        }
        moved = slug !== initial;
      } else {
        // No recorded history → fall back to the current record (best effort for
        // legacy/unlogged data). With no timeline we cannot recover past states,
        // so a record whose current status resolves to *closed* counts as done
        // only from its completion stamp (`endedAt`) onward — before that it reads
        // as not-started, never falsely closed. An open record uses its current
        // status to split not-started vs in-progress for every day it exists.
        if (statusState(workflow, issue.status) === "closed") {
          if (issue.endedAt !== undefined && issue.endedAt.getTime() < end) done += 1;
          else notStarted += 1;
          continue;
        }
        slug = issue.status;
        moved = slug !== initial;
      }

      if (statusState(workflow, slug) === "closed") done += 1;
      else if (moved) inProgress += 1;
      else notStarted += 1;
    }

    return { day: fmt.format(day), notStarted, inProgress, done };
  });
}

/** One closed issue's flow times, in whole days. */
export interface ControlPoint {
  /** Issue URL (stable key). */
  url: string;
  /** Issue title (for the tooltip). */
  title: string;
  /** When the issue resolved to closed (its completion date) — the chart's x. */
  completedAt: Date;
  /**
   * Cycle time in days: first move INTO an in-progress state (open, past the
   * workflow's initial status) within the issue's current active spell → the move
   * into a closed state.
   *  - **0** — the issue went straight from the initial status to closed without
   *    ever being in-progress (no WIP); still plotted as the floor.
   *  - **undefined** — the cycle is UNKNOWN because the start of the final active
   *    spell was lost to the status-log page cap: the read pages end at a stale
   *    closure but the `endedAt` anchor shows a LATER completion, so the issue was
   *    reopened+reclosed in the unread gap and its restart is unrecoverable.
   *    Plotting 0 there would be misleading, so such a point is omitted from the
   *    cycle scatter / rolling average / percentiles (its lead time, which needs
   *    only created → completion, is still valid and summarised).
   */
  cycleDays?: number;
  /** Lead time in days: `dct:created` → closed. Undefined when `created` is absent. */
  leadDays?: number;
}

export interface ControlChartStats {
  /** Per-closed-issue points, ascending by completion date (ties by URL). */
  points: ControlPoint[];
  /** Median cycle time (days) across the plotted points; undefined when empty. */
  medianCycle?: number;
  /** 85th-percentile cycle time (days) — the SLE the chart's band targets. */
  p85Cycle?: number;
  /** Median lead time (days) across points that have a lead time. */
  medianLead?: number;
  /** 85th-percentile lead time (days). */
  p85Lead?: number;
}

/**
 * The percentile of a numeric sample using linear interpolation between the two
 * nearest ranks (the same "C = 1 / inclusive" method as spreadsheets'
 * PERCENTILE.INC and numpy's default). `p` is in [0, 1]. Returns undefined for an
 * empty sample. The input need not be sorted — it is copied and sorted here, so
 * callers never have their array mutated.
 */
export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const clamped = Math.min(1, Math.max(0, p));
  const rank = clamped * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/** Median (50th percentile) of a numeric sample; undefined when empty. */
export function median(values: number[]): number | undefined {
  return percentile(values, 0.5);
}

/** Whole UTC-day count from `from` → `to`, floored at 0 (a same-or-earlier `to` ⇒ 0). */
function dayDelta(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Control-chart data (P2-2): per **closed** issue, its cycle time and lead time,
 * reconstructed by REPLAYING the SAME F3 provenance status-transition log the
 * three-band CFD uses ({@link computeCumulativeFlowBands}). This is purely the
 * same replay technique applied per issue rather than per day — no new vocab, no
 * writes.
 *
 * For each issue whose current status resolves to *closed* (custom terminal
 * statuses count, per {@link statusState}):
 *  - **completed at** — the first recorded transition INTO a closed status; the
 *    issue's `endedAt` (or, absent both, `modified`) is injected as an anchor
 *    transition so a completion that lived past the log's page cap is still
 *    counted (the SAME reconciliation the CFD does). An issue with no closed
 *    timestamp at all (no log, no `endedAt`/`modified`) is skipped.
 *  - **cycle time** — `completedAt − startedAt`, where `startedAt` is the FIRST
 *    transition into an in-progress status (open AND past the workflow's initial
 *    status). If the issue never recorded such a transition (e.g. it went straight
 *    initial→closed, or has no log), `startedAt` is taken as the completion time,
 *    giving a cycle time of **0** (documented on {@link ControlPoint.cycleDays}).
 *  - **lead time** — `completedAt − created` (undefined when `created` is absent).
 *
 * Points are ascending by completion date (ties by URL) so a rolling average over
 * the returned order is chronological. Summary stats (median + 85th-percentile
 * cycle and lead time) are computed over the plotted points.
 *
 * @param statusHistory per-issue status transitions keyed by URL — the SAME map
 *   {@link computeCumulativeFlowBands} consumes (read via
 *   `Repository.dashboardStatusHistory`). A missing/empty entry means no recorded
 *   transitions; the issue's current record then drives its timestamps.
 */
export function computeControlChart(
  issues: IssueRecord[],
  statusHistory: ReadonlyMap<string, StatusTransition[]>,
  workflow: WorkflowDef = DEFAULT_WORKFLOW,
): ControlChartStats {
  const initial = workflow.statuses[0]?.slug ?? "todo";
  const isClosedSlug = (slug: StatusSlug): boolean => statusState(workflow, slug) === "closed";

  const points: ControlPoint[] = [];
  for (const issue of issues) {
    // Only closed issues have a completed cycle/lead time to plot.
    if (statusState(workflow, issue.status) !== "closed") continue;

    const logged = [...(statusHistory.get(issue.url) ?? [])]
      .filter((t) => t.at !== undefined)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    // Reconcile the (possibly page-capped) log with the current record by appending
    // an anchor transition at the issue's completion stamp — the SAME technique the
    // CFD uses. The anchor only ever RECOVERS a completion the log is missing (a
    // closure on an unread page); it must never OVERRIDE a real logged closure:
    //  - `endedAt` is the true completion stamp (cleared on reopen, re-stamped on
    //    re-close), so it is safe to inject always — for a logged closure it lands
    //    at the same time, and for a page-capped one it recovers the date.
    //  - `modified` is bumped by non-status edits (comments/labels), so it is NOT a
    //    reliable completion time. Inject it ONLY when the log's CURRENT state is not
    //    already closed — i.e. the latest logged transition is non-closed (the issue
    //    was reopened after its last logged closure, OR never logged a closure) yet
    //    the record's current status is closed, meaning the real final closure lives
    //    past the page cap. Keying off the LAST logged state (not "any closure
    //    exists") matters for a capped reopen like `in-progress → done →
    //    in-progress`: a stale pre-reopen closure must NOT suppress the recovery, and
    //    a genuinely-logged final closure must NOT be inflated by a post-close edit.
    const lastLogged = logged.at(-1);
    const logCurrentlyClosed = lastLogged !== undefined && isClosedSlug(lastLogged.to);
    const transitions = [...logged];
    if (issue.endedAt !== undefined) {
      transitions.push({ to: issue.status, at: issue.endedAt });
    } else if (issue.modified !== undefined && !logCurrentlyClosed) {
      transitions.push({ to: issue.status, at: issue.modified });
    }
    const ordered = transitions.sort((a, b) => a.at.getTime() - b.at.getTime());

    // Find the FINAL/current closure, not the first. The default workflow allows
    // reopening (done → todo/in-progress), so a `done → in-progress → done` issue
    // must be measured against its *latest* completion — measuring the first
    // closure would underreport cycle/lead time, sort the point on the wrong date,
    // and skew the percentiles. The `endedAt` anchor (the current completion stamp,
    // cleared on reopen) participates in the ordered timeline, so the last closed
    // transition is the current one. (roborev MEDIUM fix.)
    let completedAt: Date | undefined;
    for (let k = ordered.length - 1; k >= 0; k--) {
      if (isClosedSlug(ordered[k].to)) {
        completedAt = ordered[k].at;
        break;
      }
    }

    if (completedAt === undefined) continue; // no recoverable completion time → skip

    // The start of active work for THIS (final) cycle is the FIRST move into an
    // in-progress status (open AND past initial) within the issue's current active
    // spell — i.e. since the last closure preceding the final one (or since
    // creation if it was never reopened). Crossing a closed transition resets the
    // candidate so an OLD pre-reopen active spell is never charged to this cycle:
    // e.g. a fully-logged `in-progress → done → todo → done` has NO in-progress
    // entry after the reopen, so its final cycle is 0, not the stale first spell.
    let startedAt: Date | undefined;
    for (const t of ordered) {
      if (t.at.getTime() >= completedAt.getTime()) break; // only entries before this closure
      if (isClosedSlug(t.to)) {
        startedAt = undefined; // a closure ends the prior active spell
      } else if (t.to !== initial && startedAt === undefined) {
        startedAt = t.at; // first in-progress move of the current spell
      }
    }

    // Whether the final completion was RECOVERED from the anchor rather than read
    // from the log: it lands strictly AFTER the last logged transition (so the final
    // closure itself is NOT in the log — it lived past the page cap). When the
    // completion is recovered, the whole final spell — including any in-progress
    // restart — is in the unread gap, so a missing start is genuinely unknowable. An
    // empty log (lastLogged undefined) is NOT "recovered": there is no log to be
    // strictly after, and an unlogged closed issue falls back to the cycle-0 best
    // effort (matching legacy/unlogged data).
    const completionRecovered = lastLogged !== undefined && completedAt.getTime() > lastLogged.at.getTime();

    // Resolve the cycle time three ways:
    //  - start found → the active-spell duration (start → completion).
    //  - no start, but the completion was RECOVERED (final closure past the page
    //    cap) → UNKNOWN (undefined): the final spell's content, including any
    //    restart, is unreadable, so plotting 0 would misreport a real reopened
    //    cycle. The point is dropped from the cycle scatter/percentiles, but its lead
    //    time (created → completion) is still valid and summarised. This covers BOTH
    //    a last-logged closure AND a last-logged reopen (todo/in-progress) before the
    //    recovered close. (roborev MEDIUM fix.)
    //  - no start, completion is LOGGED (or there is no log) → genuinely never
    //    in-progress in the visible final spell: cycle 0 (the WIP floor), plotted.
    let cycleDays: number | undefined;
    if (startedAt !== undefined && startedAt.getTime() <= completedAt.getTime()) {
      cycleDays = dayDelta(startedAt, completedAt);
    } else if (completionRecovered) {
      cycleDays = undefined;
    } else {
      cycleDays = 0;
    }
    const leadDays = issue.created !== undefined ? dayDelta(issue.created, completedAt) : undefined;

    points.push({ url: issue.url, title: issue.title, completedAt, cycleDays, leadDays });
  }

  points.sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime() || a.url.localeCompare(b.url));

  // Cycle stats over points with a KNOWN cycle only (a truncated reopen contributes
  // its lead time but no cycle); lead stats over points with a known lead time.
  const cycles = points.map((p) => p.cycleDays).filter((d): d is number => d !== undefined);
  const leads = points.map((p) => p.leadDays).filter((d): d is number => d !== undefined);
  return {
    points,
    medianCycle: median(cycles),
    p85Cycle: percentile(cycles, 0.85),
    medianLead: median(leads),
    p85Lead: percentile(leads, 0.85),
  };
}

/**
 * A control-chart scatter point enriched with a trailing rolling average of cycle
 * time — the chart row shape. `completed` is the formatted completion-date label
 * (chart x), `cycle` the y. `rolling` is the mean cycle time over the trailing
 * `window` points (inclusive of this one), so the chart's average line tracks
 * recent flow rather than the all-time mean.
 */
export interface ControlChartRow {
  url: string;
  title: string;
  /** Completion-date label (e.g. "Jun 8"). */
  completed: string;
  /** Cycle time in days (the scatter y); undefined for a truncated-cycle point. */
  cycle?: number;
  /** Lead time in days, if known. */
  lead?: number;
  /** Trailing rolling-average cycle time (days), rounded to one decimal; undefined until a known cycle has been seen. */
  rolling?: number;
}

/**
 * Shape {@link computeControlChart} points into recharts rows with a trailing
 * rolling average of cycle time over the last `window` points WITH A KNOWN CYCLE.
 * The points are already ascending by completion date, so the window is
 * chronological. A point whose cycle is unknown (a page-cap-truncated reopen) has
 * no scatter `cycle` and does not contribute to the rolling average; the average
 * is undefined until at least one known-cycle point has been seen.
 */
export function controlChartRows(points: ControlPoint[], window = 5): ControlChartRow[] {
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const size = Math.max(1, window);
  // Running queue of the last `size` KNOWN cycle values. Unknown-cycle points
  // (page-cap-truncated reopens) are skipped entirely — they must NOT consume a
  // window slot, or the rolling line would jump exactly in the truncated cases this
  // feature handles (e.g. window 2 over [2, undefined, 6] must average the last two
  // KNOWN points [2, 6] = 4, not just [6]). The average is undefined for a row until
  // at least one known-cycle point (this row or an earlier one) has been seen.
  const recent: number[] = [];
  return points.map((p) => {
    if (p.cycleDays !== undefined) {
      recent.push(p.cycleDays);
      if (recent.length > size) recent.shift();
    }
    // The rolling value is only meaningful AT a known-cycle point: an unknown-cycle
    // row carries NO rolling, so the average line skips that completion date (a gap)
    // rather than being drawn across an x whose cycle is explicitly unknown.
    const rolling =
      p.cycleDays === undefined || recent.length === 0
        ? undefined
        : recent.reduce((sum, d) => sum + d, 0) / recent.length;
    return {
      url: p.url,
      title: p.title,
      completed: fmt.format(p.completedAt),
      cycle: p.cycleDays === undefined ? undefined : Math.round(p.cycleDays * 10) / 10,
      lead: p.leadDays === undefined ? undefined : Math.round(p.leadDays * 10) / 10,
      rolling: rolling === undefined ? undefined : Math.round(rolling * 10) / 10,
    };
  });
}

export interface VelocityPoint {
  sprint: string;
  /** Story points completed (done members) in the sprint. */
  done: number;
  /** Total points committed to the sprint. */
  committed: number;
}

/** Velocity per completed sprint (oldest first, by end date). */
export function computeVelocity(sprints: SprintRecord[], issues: IssueRecord[]): VelocityPoint[] {
  const byUrl = new Map(issues.map((i) => [i.url, i]));
  return sprints
    .filter((s) => s.state === "done")
    .sort((a, b) => (a.endDate?.getTime() ?? 0) - (b.endDate?.getTime() ?? 0))
    .map((s) => {
      const members = s.taskUrls.map((u) => byUrl.get(u)).filter((i): i is IssueRecord => !!i);
      const pts = (list: IssueRecord[]) => list.reduce((sum, i) => sum + (i.estimate ?? 0), 0);
      // Completing a sprint releases unfinished tasks, so current membership
      // underreports the commitment — prefer the snapshot taken at completion.
      // Completion is the open/closed state (custom terminal statuses count), not
      // the literal "done" slug.
      return { sprint: s.title, done: pts(members.filter((i) => i.state === "closed")), committed: s.committedPoints ?? pts(members) };
    });
}
