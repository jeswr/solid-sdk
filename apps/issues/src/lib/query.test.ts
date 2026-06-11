import { describe, it, expect } from "vitest";
import { hasStructuredTokens, parseQuery, matchesQuery } from "./query";
import { filterAndSort, DEFAULT_QUERY } from "./filter";
import type { IssueRecord } from "./repository";

const base: IssueRecord = {
  url: "http://localhost:3000/alice/issue-tracker/issues/a.ttl#this",
  title: "Fix login",
  state: "open",
  status: "todo",
  issueType: "task",
  labels: [],
  blockedBy: [],
  attachments: [],
  comments: [],
  fields: {},
  canWrite: true,
};
const issue = (over: Partial<IssueRecord>): IssueRecord => ({ ...base, ...over });

describe("hasStructuredTokens", () => {
  it("detects key:value tokens, not plain text or URLs", () => {
    expect(hasStructuredTokens("status:done")).toBe(true);
    expect(hasStructuredTokens("login p:high")).toBe(true);
    expect(hasStructuredTokens("plain text search")).toBe(false);
    expect(hasStructuredTokens("")).toBe(false);
    // A pasted URL is text, not a "https" filter key.
    expect(hasStructuredTokens("https://example.org/x")).toBe(false);
  });
});

describe("parseQuery", () => {
  it("splits free text from key:value tokens", () => {
    const q = parseQuery("login status:done p:high popup");
    expect(q.text).toEqual(["login", "popup"]);
    expect(q.statuses).toEqual(["done"]);
    expect(q.priorities).toEqual(["high"]);
  });

  it("supports quoted values", () => {
    const q = parseQuery('label:"needs design" type:bug');
    expect(q.labels).toEqual(["needs design"]);
    expect(q.types).toEqual(["bug"]);
  });

  it("parses due and points comparators and sort", () => {
    const q = parseQuery("due:<2026-07-01 points:>3 sort:-due");
    expect(q.due).toEqual({ op: "<", date: new Date("2026-07-01") });
    expect(q.points).toEqual({ op: ">", value: 3 });
    expect(q.sort).toEqual({ key: "due", dir: "desc" });
  });

  it("normalises value case before validating (p:High is still a token)", () => {
    const q = parseQuery("is:Closed status:Done p:High type:Bug has:Comments sort:-Due");
    expect(q.text).toEqual([]);
    expect(q.state).toBe("closed");
    expect(q.statuses).toEqual(["done"]);
    expect(q.priorities).toEqual(["high"]);
    expect(q.types).toEqual(["bug"]);
    expect(q.has).toEqual(["comments"]);
    expect(q.sort).toEqual({ key: "due", dir: "desc" });
  });

  it("treats unknown keys and malformed values as free text", () => {
    const q = parseQuery("nonsense:thing due:whenever");
    expect(q.text).toEqual(["nonsense:thing", "due:whenever"]);
    expect(q.due).toBeUndefined();
  });
});

describe("matchesQuery", () => {
  it("matches status, priority, type, and state", () => {
    const q = parseQuery("is:closed status:done priority:high type:bug");
    expect(
      matchesQuery(issue({ state: "closed", status: "done", priority: "high", issueType: "bug" }), q),
    ).toBe(true);
    expect(matchesQuery(issue({ state: "closed", status: "done", priority: "low", issueType: "bug" }), q)).toBe(false);
  });

  it("ANDs multiple labels (unlike the OR of the filter menu)", () => {
    const q = parseQuery("label:auth label:design");
    expect(matchesQuery(issue({ labels: ["auth", "design", "x"] }), q)).toBe(true);
    expect(matchesQuery(issue({ labels: ["auth"] }), q)).toBe(false);
  });

  it("matches assignee by substring and assignee:none", () => {
    const bob = issue({ assignee: "http://localhost:3000/bob/profile/card#me" });
    expect(matchesQuery(bob, parseQuery("assignee:bob"))).toBe(true);
    expect(matchesQuery(bob, parseQuery("assignee:none"))).toBe(false);
    expect(matchesQuery(issue({}), parseQuery("assignee:none"))).toBe(true);
  });

  it("matches due windows, due:none and due:overdue", () => {
    const due = issue({ dateDue: new Date("2026-06-01") });
    expect(matchesQuery(due, parseQuery("due:<2026-07-01"))).toBe(true);
    expect(matchesQuery(due, parseQuery("due:>2026-07-01"))).toBe(false);
    expect(matchesQuery(due, parseQuery("due:overdue"))).toBe(true); // open + past
    expect(matchesQuery(issue({}), parseQuery("due:none"))).toBe(true);
    expect(matchesQuery(due, parseQuery("due:none"))).toBe(false);
  });

  it("due:overdue excludes issues due today (date-only dates parse to midnight)", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    expect(matchesQuery(issue({ dateDue: new Date("2026-06-10") }), parseQuery("due:overdue"), now)).toBe(false);
    expect(matchesQuery(issue({ dateDue: new Date("2026-06-09") }), parseQuery("due:overdue"), now)).toBe(true);
  });

  it("matches points comparators and has: facets", () => {
    const pointed = issue({ estimate: 5, parent: "x", attachments: ["f"], blockedBy: ["b"] });
    expect(matchesQuery(pointed, parseQuery("points:>3"))).toBe(true);
    expect(matchesQuery(pointed, parseQuery("points:<3"))).toBe(false);
    expect(matchesQuery(pointed, parseQuery("points:=5"))).toBe(true);
    expect(matchesQuery(issue({}), parseQuery("points:none"))).toBe(true);
    expect(matchesQuery(pointed, parseQuery("has:parent has:attachments has:blockers"))).toBe(true);
    expect(matchesQuery(issue({}), parseQuery("has:attachments"))).toBe(false);
  });

  it("free-text terms must all match", () => {
    const i = issue({ title: "Fix login popup", description: "Safari only" });
    expect(matchesQuery(i, parseQuery("login safari"))).toBe(true);
    expect(matchesQuery(i, parseQuery("login chrome"))).toBe(false);
  });
});

describe("filterAndSort integration", () => {
  const issues = [
    issue({ url: "u1", title: "A", status: "done", state: "closed", priority: "high" }),
    issue({ url: "u2", title: "B", status: "todo", priority: "high", dateDue: new Date("2026-08-01") }),
    issue({ url: "u3", title: "C", status: "todo", dateDue: new Date("2026-06-01") }),
  ];

  it("structured text upgrades the search box", () => {
    const out = filterAndSort(issues, { ...DEFAULT_QUERY, state: "all", text: "status:todo priority:high" });
    expect(out.map((i) => i.url)).toEqual(["u2"]);
  });

  it("sort: token overrides the query sort", () => {
    const out = filterAndSort(issues, { ...DEFAULT_QUERY, state: "all", text: "status:todo sort:due" });
    expect(out.map((i) => i.url)).toEqual(["u3", "u2"]);
  });

  it("plain text behaves exactly as before", () => {
    const out = filterAndSort(issues, { ...DEFAULT_QUERY, state: "all", text: "A" });
    expect(out.map((i) => i.url)).toEqual(["u1"]);
  });
});
