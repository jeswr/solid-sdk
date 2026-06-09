import { describe, it, expect } from "vitest";
import { filterAndSort, facets, DEFAULT_QUERY, type IssueQuery } from "./filter";
import type { IssueRecord } from "./repository";

const base: IssueRecord = {
  url: "",
  title: "",
  state: "open",
  labels: [],
  comments: [],
  canWrite: true,
};
const mk = (p: Partial<IssueRecord>): IssueRecord => ({ ...base, ...p });

const ALICE = "http://localhost:3000/alice/profile/card#me";
const BOB = "http://localhost:3000/bob/profile/card#me";

const issues: IssueRecord[] = [
  mk({ url: "1", title: "Login crashes", priority: "high", labels: ["bug"], assignee: ALICE, state: "open", created: new Date("2026-06-01"), dateDue: new Date("2026-06-20") }),
  mk({ url: "2", title: "Add dark mode", priority: "low", labels: ["ui", "feature"], assignee: BOB, state: "open", created: new Date("2026-06-05") }),
  mk({ url: "3", title: "Fix typo", priority: "medium", labels: ["ui"], state: "closed", created: new Date("2026-06-03"), dateDue: new Date("2026-06-10") }),
];

const q = (over: Partial<IssueQuery>): IssueQuery => ({ ...DEFAULT_QUERY, ...over });

describe("filterAndSort", () => {
  it("filters by state (open by default)", () => {
    expect(filterAndSort(issues, q({})).map((i) => i.url)).toEqual(["2", "1"]); // open, newest-first
    expect(filterAndSort(issues, q({ state: "closed" })).map((i) => i.url)).toEqual(["3"]);
    expect(filterAndSort(issues, q({ state: "all" })).length).toBe(3);
  });

  it("text search spans title, labels, assignee", () => {
    expect(filterAndSort(issues, q({ state: "all", text: "dark" })).map((i) => i.url)).toEqual(["2"]);
    expect(filterAndSort(issues, q({ state: "all", text: "bug" })).map((i) => i.url)).toEqual(["1"]);
    expect(filterAndSort(issues, q({ state: "all", text: "bob" })).map((i) => i.url)).toEqual(["2"]);
  });

  it("filters by priority, label, assignee facets", () => {
    expect(filterAndSort(issues, q({ state: "all", priorities: ["high"] })).map((i) => i.url)).toEqual(["1"]);
    expect(filterAndSort(issues, q({ state: "all", labels: ["ui"] })).map((i) => i.url).sort()).toEqual(["2", "3"]);
    expect(filterAndSort(issues, q({ state: "all", assignees: [ALICE] })).map((i) => i.url)).toEqual(["1"]);
  });

  it("sorts by priority, title, due", () => {
    expect(filterAndSort(issues, q({ state: "all", sort: "priority", sortDir: "desc" })).map((i) => i.url)).toEqual(["1", "3", "2"]);
    expect(filterAndSort(issues, q({ state: "all", sort: "title", sortDir: "asc" })).map((i) => i.title)).toEqual(["Add dark mode", "Fix typo", "Login crashes"]);
    // due: dated issues first (1 due 6-20, 3 due 6-10), undated (2) last
    expect(filterAndSort(issues, q({ state: "all", sort: "due", sortDir: "asc" })).map((i) => i.url)).toEqual(["3", "1", "2"]);
  });

  it("collects facets", () => {
    const f = facets(issues);
    expect(f.labels).toEqual(["bug", "feature", "ui"]);
    expect(f.assignees.sort()).toEqual([ALICE, BOB].sort());
  });
});
