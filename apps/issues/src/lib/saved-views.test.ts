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
});
