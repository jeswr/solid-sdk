import type { IssueRecord, SprintRecord } from "./repository";
import { ISSUE_TYPES, STATUSES, type IssueType, type StatusSlug } from "./issue";
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
 * creation and completion timestamps, so it has no in-progress band. The F3
 * provenance log (`prov:Activity`, see `Repository.activityLog`) now records
 * per-status transitions, which a future three-band CFD can replay to split the
 * in-progress band out — that consumer is tracked separately (it needs to fan out
 * a log read per issue). Spans first creation → today, clamped to `maxDays`.
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
