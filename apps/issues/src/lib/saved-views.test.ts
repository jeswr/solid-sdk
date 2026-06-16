import { describe, it, expect } from "vitest";
import { SavedViews, type KeyValueStorage } from "./saved-views";
import { DEFAULT_QUERY } from "./filter";

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe("SavedViews", () => {
  it("saves, lists newest-first, and dedupes by name", () => {
    const views = new SavedViews(memoryStorage());
    views.save("Open bugs", { ...DEFAULT_QUERY, labels: ["bug"] }, "1");
    views.save("High priority", { ...DEFAULT_QUERY, priorities: ["high"] }, "2");
    expect(views.list().map((v) => v.name)).toEqual(["High priority", "Open bugs"]);

    views.save("Open bugs", { ...DEFAULT_QUERY, labels: ["bug", "ui"] }, "3");
    const list = views.list();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("Open bugs");
    expect(list[0].query.labels).toEqual(["bug", "ui"]);
  });

  it("removes by id and tolerates corrupt storage", () => {
    const storage = memoryStorage();
    const views = new SavedViews(storage);
    views.save("A", DEFAULT_QUERY, "a");
    views.save("B", DEFAULT_QUERY, "b");
    views.remove("a");
    expect(views.list().map((v) => v.id)).toEqual(["b"]);

    storage.setItem("solid-issues:saved-views", "{not json");
    expect(views.list()).toEqual([]);
  });

  it("captures the active layout (view) alongside the query", () => {
    const views = new SavedViews(memoryStorage());
    views.save("Board high", { ...DEFAULT_QUERY, priorities: ["high"] }, "1", "board");
    expect(views.list()[0].view).toBe("board");
    // No layout → view is omitted (backward-compatible with older saved views).
    views.save("No layout", DEFAULT_QUERY, "2");
    expect(views.list().find((v) => v.id === "2")?.view).toBeUndefined();
  });

  it("replace() keeps only the given views (partial-migration safe)", () => {
    const views = new SavedViews(memoryStorage());
    views.save("A", DEFAULT_QUERY, "a");
    views.save("B", DEFAULT_QUERY, "b");
    views.save("C", DEFAULT_QUERY, "c");
    // Simulate a migration where only B failed: keep B, drop A + C.
    views.replace(views.list().filter((v) => v.id === "b"));
    expect(views.list().map((v) => v.id)).toEqual(["b"]);
    views.clear();
    expect(views.list()).toEqual([]);
  });
});
