// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { defaultSearchFilters, filterSearchResults } from "../src/shell/lib/search-filters";
import {
  groupSearchResults,
  readRecentSearches,
  type SearchResult,
  updateRecentSearches,
} from "../src/shell/lib/search-results";
import { createLocalSearchSource } from "../src/shell/search/local-source";

const result = (id: string, rest: Partial<SearchResult> = {}): SearchResult => ({
  id,
  title: `Project ${id}`,
  type: "file",
  app: "drive",
  href: `/drive/${id}`,
  ...rest,
});
describe("search result ordering", () => {
  it("groups by the documented type order and caps at five without changing relevance", () => {
    const files = Array.from({ length: 8 }, (_, i) => result(String(i)));
    const groups = groupSearchResults([
      result("data", { type: "data" }),
      result("person", { type: "person" }),
      ...files,
      result("task", { type: "task" }),
      result("document", { type: "document" }),
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Files",
      "Documents",
      "Tasks",
      "People",
      "Data",
    ]);
    expect(groups[0]?.results).toEqual(files.slice(0, 5));
    expect(files).toHaveLength(8);
  });
  it("omits empty groups and handles custom, zero and negative caps", () => {
    expect(groupSearchResults([])).toEqual([]);
    expect(groupSearchResults([result("1"), result("2")], 1)[0]?.results).toHaveLength(1);
    expect(groupSearchResults([result("1")], 0)).toEqual([]);
    expect(groupSearchResults([result("1")], -1)).toEqual([]);
  });
});
describe("recent searches", () => {
  it("trims, deduplicates case-insensitively, moves repeats to front and caps at eight", () => {
    const recent = [
      "Project",
      "notes",
      " project ",
      " ",
      ...Array.from({ length: 10 }, (_, i) => `query ${i}`),
    ];
    expect(updateRecentSearches(recent, " NOTES ")).toEqual([
      "NOTES",
      "Project",
      "query 0",
      "query 1",
      "query 2",
      "query 3",
      "query 4",
      "query 5",
    ]);
    expect(recent[0]).toBe("Project");
    expect(updateRecentSearches([" item ", "ITEM"], " ")).toEqual(["item"]);
    expect(updateRecentSearches([], "")).toEqual([]);
  });
  it.each([null, "{", "{}", "null", "42"])("recovers safely from %j", (value) =>
    expect(readRecentSearches(value)).toEqual([]));
  it("discards invalid entries in saved history", () =>
    expect(readRecentSearches('["plan", false, null, 2, " PLAN ", "docs"]')).toEqual([
      "plan",
      "docs",
    ]));
});
describe("result filters", () => {
  const now = Date.UTC(2026, 10, 1);
  const day = 86400000;
  const items = [
    result("new", { modified: new Date(now), owner: "me" }),
    result("week", {
      type: "document",
      app: "docs",
      modified: new Date(now - 7 * day),
      owner: "other",
    }),
    result("month", { modified: new Date(now - 30 * day), owner: "me" }),
    result("year", { modified: new Date(now - 365 * day) }),
    result("old", { modified: new Date(now - 366 * day) }),
    result("future", { modified: new Date(now + day) }),
    result("undated"),
    result("invalid", { modified: new Date(Number.NaN) }),
  ];
  it("keeps all items by default without sorting or mutating them", () => {
    expect(filterSearchResults(items, defaultSearchFilters)).toEqual(items);
    expect(filterSearchResults(items, defaultSearchFilters, {})).toEqual(items);
  });
  it("filters type, app and their intersection", () => {
    expect(
      filterSearchResults(items, { ...defaultSearchFilters, type: "document" }).map(
        (item) => item.id,
      ),
    ).toEqual(["week"]);
    expect(
      filterSearchResults(items, { ...defaultSearchFilters, app: "docs" }).map((item) => item.id),
    ).toEqual(["week"]);
    expect(
      filterSearchResults(items, { ...defaultSearchFilters, type: "task", app: "drive" }),
    ).toEqual([]);
  });
  it.each([
    ["7", ["new", "week"]],
    ["30", ["new", "week", "month"]],
    ["year", ["new", "week", "month", "year"]],
  ] as const)("filters %s including its boundary and excludes unknown or future dates", (modified, ids) => {
    expect(
      filterSearchResults(items, { ...defaultSearchFilters, modified }, { now }).map(
        (item) => item.id,
      ),
    ).toEqual(ids);
  });
  it("requires known account ownership for Me", () => {
    expect(filterSearchResults(items, { ...defaultSearchFilters, owner: "me" })).toEqual([]);
    expect(
      filterSearchResults(items, { ...defaultSearchFilters, owner: "me" }, { accountId: "me" }).map(
        (item) => item.id,
      ),
    ).toEqual(["new", "month"]);
    expect(
      filterSearchResults(
        items,
        { ...defaultSearchFilters, owner: "me", modified: "7" },
        { accountId: "me", now },
      ).map((item) => item.id),
    ).toEqual(["new"]);
  });
});
describe("local index adapter", () => {
  it("uses ranked client matches, scopes, metadata, body text and copies result records", async () => {
    const source = createLocalSearchSource([
      result("drive"),
      { ...result("docs", { app: "docs", type: "document" }), body: "uniquebody" },
    ]);
    const signal = new AbortController().signal;
    const all = await source.search("project", { signal });
    expect(all.source).toBe("local");
    expect(all.serverSearch).toBe(false);
    expect(all.results).toHaveLength(2);
    expect(
      (await source.search("project", { signal, scope: "docs" })).results.map((item) => item.id),
    ).toEqual(["docs"]);
    expect((await source.search("uniquebody", { signal })).results[0]?.type).toBe("document");
    expect((await source.search("absent", { signal })).results).toEqual([]);
    if (all.results[0]) all.results[0].title = "Changed";
    expect((await source.search("project", { signal })).results[0]?.title).not.toBe("Changed");
  });
  it("propagates aborts and supports empty accounts", async () => {
    const source = createLocalSearchSource([]);
    const controller = new AbortController();
    controller.abort();
    await expect(source.search("project", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect((await source.search("", { signal: new AbortController().signal })).results).toEqual([]);
  });
});
