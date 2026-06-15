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
