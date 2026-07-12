import type { IssueRecord } from "@/lib/repository";
import type { Priority } from "@/lib/issue";
import { hasStructuredTokens, matchesFreeText, matchesQuery, parseQuery, type StructuredQuery } from "./query";

export type StateFilter = "open" | "closed" | "all";
export type SortKey = "created" | "updated" | "due" | "priority" | "title";
export type SortDir = "asc" | "desc";

/** A view query over the loaded issues — all client-side. */
export interface IssueQuery {
  text: string;
  state: StateFilter;
  priorities: Priority[]; // empty ⇒ any
  labels: string[]; // empty ⇒ any (issue must carry at least one of these)
  components: string[]; // empty ⇒ any (issue must carry at least one of these)
  versions: string[]; // empty ⇒ any (issue's affects- OR fix-version must be one of these)
  assignees: string[]; // empty ⇒ any
  sort: SortKey;
  sortDir: SortDir;
}

export const DEFAULT_QUERY: IssueQuery = {
  text: "",
  state: "open",
  priorities: [],
  labels: [],
  components: [],
  versions: [],
  assignees: [],
  sort: "created",
  sortDir: "desc",
};

const PRIORITY_RANK: Record<Priority | "none", number> = { high: 3, medium: 2, low: 1, none: 0 };
const time = (d?: Date) => d?.getTime() ?? 0;

function matches(issue: IssueRecord, q: IssueQuery, structured?: StructuredQuery): boolean {
  // The structured query's own is:/state: token overrides the state tab.
  const state = structured?.state ?? q.state;
  if (state !== "all" && issue.state !== state) return false;
  if (q.priorities.length && !(issue.priority && q.priorities.includes(issue.priority))) return false;
  if (q.labels.length && !issue.labels.some((l) => q.labels.includes(l))) return false;
  if (q.components.length && !issue.components.some((c) => q.components.includes(c))) return false;
  // A version filter matches an issue whose affects- OR fix-version is selected.
  if (q.versions.length && !((issue.affectsVersion && q.versions.includes(issue.affectsVersion)) || (issue.fixVersion && q.versions.includes(issue.fixVersion)))) return false;
  if (q.assignees.length && !(issue.assignee && q.assignees.includes(issue.assignee))) return false;
  if (structured) return matchesQuery(issue, { ...structured, state: undefined });
  return q.text ? matchesFreeText(issue, q.text.toLowerCase()) : true;
}

function compare(a: IssueRecord, b: IssueRecord, sort: SortKey): number {
  switch (sort) {
    case "created":
      return time(a.created) - time(b.created);
    case "updated":
      return time(a.modified) - time(b.modified);
    case "due":
      // issues with no due date sort last regardless of direction
      return (time(a.dateDue) || Infinity) - (time(b.dateDue) || Infinity);
    case "priority":
      return PRIORITY_RANK[a.priority ?? "none"] - PRIORITY_RANK[b.priority ?? "none"];
    case "title":
      return a.title.localeCompare(b.title);
  }
}

/**
 * Filter then sort a list of issues by the given query (pure). When the text
 * contains `key:value` tokens (JQL-style) they are parsed and ANDed with the
 * menu filters; a `sort:` token overrides the sort dropdown.
 */
export function filterAndSort(issues: IssueRecord[], q: IssueQuery): IssueRecord[] {
  const structured = hasStructuredTokens(q.text) ? parseQuery(q.text) : undefined;
  const filtered = issues.filter((i) => matches(i, q, structured));
  const sort = structured?.sort?.key ?? q.sort;
  const sortDir = structured?.sort?.dir ?? q.sortDir;
  const dir = sortDir === "asc" ? 1 : -1;
  // "due" with no date always trails; otherwise honour direction.
  return filtered.sort((a, b) => {
    const c = compare(a, b, sort);
    if (sort === "due") {
      const aHas = !!a.dateDue;
      const bHas = !!b.dateDue;
      if (aHas !== bHas) return aHas ? -1 : 1; // dated first, both directions
      return c * (sortDir === "asc" ? 1 : -1);
    }
    return c * dir;
  });
}

/** Distinct labels / components / versions / assignees present across the issues, for filter menus. */
export function facets(issues: IssueRecord[]): { labels: string[]; components: string[]; versions: string[]; assignees: string[] } {
  const labels = new Set<string>();
  const components = new Set<string>();
  const versions = new Set<string>();
  const assignees = new Set<string>();
  for (const i of issues) {
    i.labels.forEach((l) => labels.add(l));
    i.components.forEach((c) => components.add(c));
    if (i.affectsVersion) versions.add(i.affectsVersion);
    if (i.fixVersion) versions.add(i.fixVersion);
    if (i.assignee) assignees.add(i.assignee);
  }
  return {
    labels: [...labels].sort(),
    components: [...components].sort(),
    versions: [...versions].sort(),
    assignees: [...assignees].sort(),
  };
}
