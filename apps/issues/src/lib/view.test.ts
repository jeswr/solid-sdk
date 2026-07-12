// AUTHORED-BY Claude Opus 4.8
import { describe, it, expect } from "vitest";
import { resolveView, viewHref, VIEWS, VIEW_KEY, type KeyValueStorage } from "./view";

function memStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("resolveView — URL-driven view selection", () => {
  it("returns the URL param when it names a valid view", () => {
    for (const v of VIEWS) {
      expect(resolveView(v, memStorage())).toBe(v);
    }
  });

  it("ignores an invalid URL param and falls back to localStorage", () => {
    const storage = memStorage({ [VIEW_KEY]: "board" });
    expect(resolveView("bogus", storage)).toBe("board");
  });

  it("ignores an invalid URL param and defaults to 'list' when storage is empty", () => {
    expect(resolveView("bogus", memStorage())).toBe("list");
  });

  it("falls back to localStorage when URL param is null (no ?view= param)", () => {
    const storage = memStorage({ [VIEW_KEY]: "timeline" });
    expect(resolveView(null, storage)).toBe("timeline");
  });

  it("defaults to 'list' when both URL param and localStorage are absent", () => {
    expect(resolveView(null, memStorage())).toBe("list");
  });

  it("ignores a corrupted localStorage value and defaults to 'list'", () => {
    const storage = memStorage({ [VIEW_KEY]: "not-a-view" });
    expect(resolveView(null, storage)).toBe("list");
  });

  it("URL param takes precedence over localStorage", () => {
    // localStorage says "board", URL says "calendar" — URL wins.
    const storage = memStorage({ [VIEW_KEY]: "board" });
    expect(resolveView("calendar", storage)).toBe("calendar");
  });
});

describe("viewHref — URL generation", () => {
  it("produces '/' for the list view (no ?view= param)", () => {
    expect(viewHref("list")).toBe("/");
  });

  it("produces '/?view=<name>' for all other views", () => {
    expect(viewHref("board")).toBe("/?view=board");
    expect(viewHref("dashboard")).toBe("/?view=dashboard");
    expect(viewHref("timeline")).toBe("/?view=timeline");
    expect(viewHref("calendar")).toBe("/?view=calendar");
    expect(viewHref("workload")).toBe("/?view=workload");
    expect(viewHref("epics")).toBe("/?view=epics");
    expect(viewHref("backlog")).toBe("/?view=backlog");
  });
});
