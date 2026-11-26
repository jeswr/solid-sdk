// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { isSharedTrackerUrl } from "../../src/apps/tasks/lib/model/rdf";
import {
  defaultPreferences,
  parsePreferences,
  parseSharedProjects,
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
      sharedProjects: [],
      favourites: [],
      boardGrouping: {},
      sort: { inbox: "name" },
      groupBy: {},
      viewMode: { home: "board" },
      collapsedSections: ["one"],
      collapsedProjects: [],
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

it("validates and deduplicates opened shared projects in storage and reducer actions", () => {
  const valid = { url: "https://bob.example/home.ttl", title: "Home" };
  const invalid = [
    null,
    0,
    {},
    { ...valid, title: " " },
    { ...valid, url: 1 },
    { ...valid, url: "broken" },
    ...[
      "javascript:alert(1)",
      "https://user:pass@bob.example/a",
      "https://bob.example/a#this",
      "https://bob.example/a?x=1",
      "https://bob.example/",
    ].map((url) => ({ ...valid, url })),
  ];
  expect(parseSharedProjects(JSON.stringify([...invalid, valid, valid]))).toEqual([valid]);
  for (const raw of [null, "{", "{}", '"x"']) expect(parseSharedProjects(raw)).toEqual([]);
  // A browser-wide list (from before the per-account split) is never read.
  expect(parsePreferences(JSON.stringify({ sharedProjects: [valid] })).sharedProjects).toEqual([]);
  const state = { ...defaultPreferences, sharedProjects: [valid] };
  expect(preferencesReducer(state, { type: "sharedProject", ...valid })).toBe(state);
  expect(
    preferencesReducer(state, { type: "sharedProject", ...valid, title: "Renamed" }).sharedProjects,
  ).toEqual([{ ...valid, title: "Renamed" }]);
  expect(
    preferencesReducer(defaultPreferences, { type: "sharedProject", ...valid }).sharedProjects,
  ).toEqual([valid]);
  expect(preferencesReducer(state, { type: "sharedProject", ...valid, url: "bad" })).toBe(state);
});

afterEach(() => vi.unstubAllEnvs());

it("requires HTTPS and removes remembered shared projects", () => {
  vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", undefined);
  for (const url of ["https://bob.example/home.ttl", "https://localhost:3000/home.ttl"]) {
    const state = preferencesReducer(defaultPreferences, {
      type: "sharedProject",
      url,
      title: "Home",
    });
    expect(state.sharedProjects).toEqual([{ url, title: "Home" }]);
    expect(preferencesReducer(state, { type: "removeSharedProject", url }).sharedProjects).toEqual(
      [],
    );
  }
  for (const url of [
    "http://bob.example/home.ttl",
    "http://localhost.example/home.ttl",
    "http://192.168.0.1/home.ttl",
    "http://localhost:3000/home.ttl",
    "http://127.0.0.2/home.ttl",
    "http://[::1]/home.ttl",
    "https://bob.example/home",
  ]) {
    expect(
      preferencesReducer(defaultPreferences, { type: "sharedProject", url, title: "Home" }),
    ).toBe(defaultPreferences);
    expect(parseSharedProjects(JSON.stringify([{ url, title: "Home" }]))).toEqual([]);
  }
});

it("allows HTTP loopback shared projects only with the explicit fixture flag", () => {
  for (const flag of [undefined, "0", "true", "1"]) {
    vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", flag);
    for (const url of [
      "http://localhost:3000/home.ttl",
      "http://127.0.0.2/home.ttl",
      "http://[::1]/home.ttl",
    ]) {
      expect(isSharedTrackerUrl(url)).toBe(flag === "1");
      expect(parseSharedProjects(JSON.stringify([{ url, title: "Home" }]))).toEqual(
        flag === "1" ? [{ url, title: "Home" }] : [],
      );
    }
    expect(isSharedTrackerUrl("http://bob.example/home.ttl")).toBe(false);
    expect(isSharedTrackerUrl("http://localhost.example/home.ttl")).toBe(false);
    expect(isSharedTrackerUrl("http://192.168.0.1/home.ttl")).toBe(false);
  }
});
