// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  capabilityRows,
  demoCapabilities,
  demoCapabilitiesWith,
} from "../src/shell/lib/settings-capabilities";
import {
  defaultPreferences,
  mergePreferences,
  parsePreferences,
  preferencesKey,
} from "../src/shell/lib/settings-preferences";

describe("storage capabilities", () => {
  it("merges explicit overrides and keeps defaults for absent flags", () => {
    expect(demoCapabilitiesWith({ serverSearch: true, trash: false, move: undefined })).toEqual({
      ...demoCapabilities,
      serverSearch: true,
      trash: false,
    });
    expect(demoCapabilitiesWith({})).toEqual(demoCapabilities);
  });
  it("has ordered plain-language rows and treats missing flags as unavailable", () => {
    expect(capabilityRows({}).map((row) => [row.label, row.value])).toEqual([
      ["Live co-editing", "No"],
      ["Live updates", "No"],
      ["Search", "No"],
      ["Access requests", "No"],
      ["Version history", "No"],
      ["Trash", "No"],
      ["Link sharing", "No"],
      ["Expiring access", "No"],
      ["Move", "No"],
    ]);
    expect(
      capabilityRows(demoCapabilities)
        .filter((row) => row.value === "Yes")
        .map((row) => row.key),
    ).toEqual(["trash", "move"]);
    expect(
      capabilityRows({ ...demoCapabilities, serverSearch: true }).find(
        (row) => row.key === "serverSearch",
      )?.value,
    ).toBe("Yes");
  });
});

describe("per-account preferences", () => {
  it("defaults to Home while preserving an explicitly chosen start page", () => {
    expect(defaultPreferences.startPage).toBe("/home");
    expect(parsePreferences('{"startPage":"invalid"}').startPage).toBe("/home");
    expect(parsePreferences('{"startPage":"/drive"}').startPage).toBe("/drive");
  });
  it.each([null, "{", "null", "[]", "42", '"text"'])("tolerates %s", (raw) => {
    expect(parsePreferences(raw)).toEqual(defaultPreferences);
  });
  it("validates individual fields, nested defaults and strips unknown data", () => {
    expect(
      parsePreferences(
        JSON.stringify({
          theme: "dark",
          density: "bad",
          fontScale: "110",
          motion: "reduce",
          unknown: "private",
          notifications: { shared: false, tasks: "yes" },
          quietHours: { enabled: true, start: "25:00", end: "09:15" },
        }),
      ),
    ).toEqual({
      ...defaultPreferences,
      theme: "dark",
      fontScale: "110",
      motion: "reduce",
      notifications: { ...defaultPreferences.notifications, shared: false },
      quietHours: { enabled: true, start: "22:00", end: "09:15" },
    });
    expect(parsePreferences('{"theme":"dark","notifications":null,"quietHours":[]}')).toEqual({
      ...defaultPreferences,
      theme: "dark",
    });
  });
  it("merges partial nested updates without losing other choices", () => {
    const first = mergePreferences(defaultPreferences, {
      theme: "light",
      notifications: { comments: false },
      quietHours: { start: "21:30" },
    });
    const next = mergePreferences(first, {
      density: "compact",
      notifications: { shared: false },
      quietHours: { enabled: true },
      unknown: "ignored",
    });
    expect(next).toEqual({
      ...first,
      density: "compact",
      notifications: { ...first.notifications, shared: false },
      quietHours: { ...first.quietHours, enabled: true },
    });
    expect(mergePreferences(next, null)).toEqual(next);
    expect(mergePreferences(next, { notifications: null, quietHours: [] })).toEqual(next);
    expect(parsePreferences(JSON.stringify(next))).toEqual(next);
    expect(preferencesKey("first")).toBe("suite.prefs.v1.first");
    expect(preferencesKey("second")).not.toBe(preferencesKey("first"));
    expect(defaultPreferences.theme).toBe("system");
  });
});
