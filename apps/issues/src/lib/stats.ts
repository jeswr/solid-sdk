import type { IssueRecord, SprintRecord } from "./repository";
import { ISSUE_TYPES, STATUSES, type IssueType, type StatusSlug } from "./issue";

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

  const overdue = issues.filter(
    (i) => i.state === "open" && i.dateDue !== undefined && i.dateDue.getTime() < now.getTime(),
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
      return { sprint: s.title, done: pts(members.filter((i) => i.status === "done")), committed: s.committedPoints ?? pts(members) };
    });
}
