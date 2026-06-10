import type { IssueRecord } from "@/lib/repository";

export interface EpicGroup {
  epic: IssueRecord;
  children: IssueRecord[];
  done: number;
  total: number;
  /** 0–100 completion across children (done = status "done"). */
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
      const done = children.filter((c) => c.status === "done").length;
      const total = children.length;
      return { epic, children, done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
    })
    .sort((a, b) => (b.epic.created?.getTime() ?? 0) - (a.epic.created?.getTime() ?? 0));

  const unassigned = issues.filter(
    (i) => i.issueType !== "epic" && (!i.parent || !epicUrls.has(i.parent)),
  );
  return { epics, unassigned };
}
