import type { IssueRecord } from "./repository";
import type { IssueType, Priority, StatusSlug } from "./issue";
import { ISSUE_TYPES, STATUSES } from "./issue";
import type { SortDir, SortKey, StateFilter } from "./filter";
import { startOfUtcDay } from "./dates";

/**
 * A JQL-style structured query parsed from the search box. Tokens are
 * `key:value` (quoted values allowed); everything else is free text. All
 * conditions AND together; repeating a key ORs its values (except `label:`,
 * which ANDs — "carries both labels" is the useful reading).
 */
export interface StructuredQuery {
  text: string[];
  state?: StateFilter;
  statuses: StatusSlug[];
  priorities: (Priority | "none")[];
  labels: string[];
  types: IssueType[];
  /** Assignee substrings; `none` means unassigned. */
  assignees: string[];
  due?: { op: "<" | ">" | "none" | "overdue"; date?: Date };
  points?: { op: "<" | ">" | "="; value: number } | { op: "none" };
  has: string[];
  sort?: { key: SortKey; dir: SortDir };
}

const STATUS_SLUGS = new Set<string>(STATUSES.map((s) => s.slug));
const TYPE_SLUGS = new Set<string>(ISSUE_TYPES.map((t) => t.slug));
const PRIORITY_VALUES = new Set(["high", "medium", "low", "none"]);
const STATE_VALUES = new Set(["open", "closed", "all"]);
const SORT_KEYS = new Set(["created", "updated", "due", "priority", "title"]);
const HAS_FACETS = new Set(["comments", "attachments", "due", "points", "parent", "blockers", "description"]);

const KEY_TOKEN = /^([a-z]+):(.+)$/i;

/** Whether the input contains at least one recognised `key:` token. */
export function hasStructuredTokens(input: string): boolean {
  return tokenize(input).some((t) => {
    const m = KEY_TOKEN.exec(t);
    return m !== null && KNOWN_KEYS.has(m[1].toLowerCase());
  });
}

const KNOWN_KEYS = new Set([
  "is", "state", "status", "priority", "p", "label", "tag", "type",
  "assignee", "a", "due", "points", "estimate", "has", "sort",
]);

/** Split on whitespace, keeping `key:"quoted value"` together. */
function tokenize(input: string): string[] {
  return input.match(/(?:[^\s"]+(?:"[^"]*")?|"[^"]*")+/g) ?? [];
}

const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);

export function parseQuery(input: string): StructuredQuery {
  const q: StructuredQuery = { text: [], statuses: [], priorities: [], labels: [], types: [], assignees: [], has: [] };

  for (const token of tokenize(input)) {
    const m = KEY_TOKEN.exec(token);
    const key = m?.[1].toLowerCase();
    // The whole query language is case-insensitive: p:High === p:high.
    const value = m ? unquote(m[2]).toLowerCase() : "";
    // Unknown keys (including pasted URLs, where "https" looks like a key)
    // and malformed values fall through to free text.
    const asText = () => q.text.push(token.toLowerCase());

    if (!m || !KNOWN_KEYS.has(key!)) {
      q.text.push(token.toLowerCase());
      continue;
    }
    switch (key) {
      case "is":
      case "state":
        if (STATE_VALUES.has(value)) q.state = value as StateFilter;
        else asText();
        break;
      case "status":
        if (STATUS_SLUGS.has(value)) q.statuses.push(value as StatusSlug);
        else asText();
        break;
      case "priority":
      case "p":
        if (PRIORITY_VALUES.has(value)) q.priorities.push(value as Priority | "none");
        else asText();
        break;
      case "label":
      case "tag":
        q.labels.push(value);
        break;
      case "type":
        if (TYPE_SLUGS.has(value)) q.types.push(value as IssueType);
        else asText();
        break;
      case "assignee":
      case "a":
        q.assignees.push(value);
        break;
      case "due": {
        if (value === "none" || value === "overdue") {
          q.due = { op: value };
          break;
        }
        const cmp = /^([<>])(.+)$/.exec(value);
        const date = cmp ? new Date(cmp[2]) : undefined;
        if (cmp && date !== undefined && !Number.isNaN(date.getTime())) q.due = { op: cmp[1] as "<" | ">", date };
        else asText();
        break;
      }
      case "points":
      case "estimate": {
        if (value === "none") {
          q.points = { op: "none" };
          break;
        }
        const cmp = /^([<>=])(\d+(?:\.\d+)?)$/.exec(value);
        if (cmp) q.points = { op: cmp[1] as "<" | ">" | "=", value: Number(cmp[2]) };
        else asText();
        break;
      }
      case "has":
        if (HAS_FACETS.has(value)) q.has.push(value);
        else asText();
        break;
      case "sort": {
        const dir: SortDir = value.startsWith("-") ? "desc" : "asc";
        const k = value.replace(/^-/, "");
        if (SORT_KEYS.has(k)) q.sort = { key: k as SortKey, dir };
        else asText();
        break;
      }
    }
  }
  return q;
}

/** Case-insensitive free-text match over the issue's searchable haystack. */
export function matchesFreeText(issue: IssueRecord, needle: string): boolean {
  return (
    issue.title.toLowerCase().includes(needle) ||
    (issue.description?.toLowerCase().includes(needle) ?? false) ||
    issue.labels.some((l) => l.toLowerCase().includes(needle)) ||
    (issue.assignee?.toLowerCase().includes(needle) ?? false) ||
    issue.comments.some((c) => c.content.toLowerCase().includes(needle))
  );
}

const hasFacet = (issue: IssueRecord, facet: string): boolean => {
  switch (facet) {
    case "comments":
      return issue.comments.length > 0;
    case "attachments":
      return issue.attachments.length > 0;
    case "due":
      return issue.dateDue !== undefined;
    case "points":
      return issue.estimate !== undefined;
    case "parent":
      return issue.parent !== undefined;
    case "blockers":
      return issue.blockedBy.length > 0;
    case "description":
      return !!issue.description;
    default:
      return true;
  }
};

export function matchesQuery(issue: IssueRecord, q: StructuredQuery, now = new Date()): boolean {
  if (q.state && q.state !== "all" && issue.state !== q.state) return false;
  if (q.statuses.length && !q.statuses.includes(issue.status)) return false;
  if (q.priorities.length && !q.priorities.includes(issue.priority ?? "none")) return false;
  if (q.types.length && !q.types.includes(issue.issueType)) return false;
  // Labels AND: the issue must carry every requested label.
  const labels = issue.labels.map((l) => l.toLowerCase());
  if (q.labels.length && !q.labels.every((l) => labels.includes(l))) return false;
  if (q.assignees.length) {
    const ok = q.assignees.some((a) =>
      a === "none" || a === "unassigned"
        ? issue.assignee === undefined
        : (issue.assignee?.toLowerCase().includes(a) ?? false),
    );
    if (!ok) return false;
  }
  if (q.due) {
    const t = issue.dateDue?.getTime();
    if (q.due.op === "none" && t !== undefined) return false;
    if (q.due.op === "overdue" && !(t !== undefined && t < startOfUtcDay(now).getTime() && issue.state === "open"))
      return false;
    if (q.due.op === "<" && !(t !== undefined && t < q.due.date!.getTime())) return false;
    if (q.due.op === ">" && !(t !== undefined && t > q.due.date!.getTime())) return false;
  }
  if (q.points) {
    const p = issue.estimate;
    if (q.points.op === "none") {
      if (p !== undefined) return false;
    } else {
      if (p === undefined) return false;
      if (q.points.op === "<" && !(p < q.points.value)) return false;
      if (q.points.op === ">" && !(p > q.points.value)) return false;
      if (q.points.op === "=" && p !== q.points.value) return false;
    }
  }
  if (!q.has.every((f) => hasFacet(issue, f))) return false;
  return q.text.every((term) => matchesFreeText(issue, term));
}
