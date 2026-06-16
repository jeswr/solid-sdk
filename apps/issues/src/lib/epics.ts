import type { IssueRecord } from "./repository";

export interface EpicGroup {
  epic: IssueRecord;
  children: IssueRecord[];
  done: number;
  total: number;
  /** 0–100 completion across children (done = a closed/terminal state). */
  percent: number;
}

/**
 * Group issues by epic (children link via `parent` to the epic's URL) and roll up
 * progress, Jira-style. Issues whose parent is not an epic (plain sub-tasks) stay
 * in `unassigned`; epics sort newest-first.
 */
export function groupByEpic(issues: IssueRecord[]): { epics: EpicGroup[]; unassigned: IssueRecord[] } {
  const epicUrls = new Set(issues.filter((i) => i.issueType === "epic").map((i) => i.url));
  const epics: EpicGroup[] = issues
    .filter((i) => i.issueType === "epic")
    .map((epic) => {
      const children = issues.filter((c) => c.parent === epic.url && c.url !== epic.url);
      // Completion is the open/closed resolution (custom terminal statuses count),
      // not the literal "done" slug.
      const done = children.filter((c) => c.state === "closed").length;
      const total = children.length;
      return { epic, children, done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
    })
    .sort((a, b) => (b.epic.created?.getTime() ?? 0) - (a.epic.created?.getTime() ?? 0));

  const unassigned = issues.filter(
    (i) => i.issueType !== "epic" && (!i.parent || !epicUrls.has(i.parent)),
  );
  return { epics, unassigned };
}

/**
 * Resolve an issue's nearest EPIC ancestor URL by walking the `parent` chain,
 * for board swimlanes. The hierarchy is Initiative → Epic → Feature → Story →
 * Task/Bug, so an issue's direct `parent` is often a Feature/Story, NOT the epic
 * — walking up returns the first ancestor that is itself an epic. An epic maps to
 * itself; an issue with no epic ancestor returns undefined (the "No epic" lane).
 *
 * Cycle-safe (a malformed parent loop is bounded by a visited set), and tolerant
 * of dangling parents (a parent not in `issues` simply ends the walk).
 */
export function epicAncestorOf(issue: IssueRecord, issues: IssueRecord[]): string | undefined {
  const byUrl = new Map(issues.map((i) => [i.url, i]));
  const seen = new Set<string>();
  let current: IssueRecord | undefined = issue;
  while (current && !seen.has(current.url)) {
    if (current.issueType === "epic") return current.url;
    seen.add(current.url);
    current = current.parent ? byUrl.get(current.parent) : undefined;
  }
  return undefined;
}
