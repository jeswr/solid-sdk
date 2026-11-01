// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  defaultPreferences,
  parsePreferences,
  preferencesReducer,
} from "../../src/apps/tasks/state/preferences-reducer";

describe("Tasks preferences", () => {
  it("rejects malformed storage and non-records", () => {
    for (const raw of [null, "{", "null", "1", '"text"', "[]"])
      expect(parsePreferences(raw)).toEqual(defaultPreferences);
    expect(parsePreferences("{}")).toEqual(defaultPreferences);
  });
  it("validates every stored field independently", () => {
    expect(
      parsePreferences(
        JSON.stringify({
          sort: { inbox: "name", bad: "random" },
          viewMode: { home: "board", bad: 1 },
          collapsedSections: ["one", 2],
          sidebar: { labelsOpen: false, projectsOpen: false },
          showCompletedInProject: true,
          weekStart: "monday",
        }),
      ),
    ).toEqual({
      sort: { inbox: "name" },
      viewMode: { home: "board" },
      collapsedSections: ["one"],
      sidebar: { labelsOpen: false, projectsOpen: false },
      showCompletedInProject: true,
      weekStart: "monday",
    });
    expect(
      parsePreferences('{"sort":[],"viewMode":0,"sidebar":null,"weekStart":"sunday"}').weekStart,
    ).toBe("sunday");
    expect(
      parsePreferences('{"sort":null,"viewMode":[],"sidebar":{"labelsOpen":1},"weekStart":"bad"}')
        .sidebar,
    ).toEqual(defaultPreferences.sidebar);
  });
  it("reduces all settings without mutating the baseline", () => {
    let prefs = preferencesReducer(defaultPreferences, {
      type: "sort",
      viewId: "inbox",
      value: "due",
    });
    prefs = preferencesReducer(prefs, { type: "viewMode", viewId: "home", value: "board" });
    prefs = preferencesReducer(prefs, { type: "collapse", sectionId: "doing" });
    prefs = preferencesReducer(prefs, { type: "collapse", sectionId: "other" });
    prefs = preferencesReducer(prefs, { type: "collapse", sectionId: "doing" });
    prefs = preferencesReducer(prefs, { type: "sidebar", group: "labelsOpen" });
    prefs = preferencesReducer(prefs, { type: "sidebar", group: "projectsOpen" });
    prefs = preferencesReducer(prefs, { type: "showCompleted", value: true });
    prefs = preferencesReducer(prefs, { type: "weekStart", value: "sunday" });
    expect(prefs).toEqual({
      ...defaultPreferences,
      sort: { inbox: "due" },
      viewMode: { home: "board" },
      collapsedSections: ["other"],
      sidebar: { labelsOpen: false, projectsOpen: false },
      showCompletedInProject: true,
      weekStart: "sunday",
    });
    expect(defaultPreferences.collapsedSections).toEqual([]);
  });
});
