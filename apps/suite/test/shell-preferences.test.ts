// AUTHORED-BY Codex GPT-6.1-Sol
import { defaultRailPins } from "@jeswr/suite-ui";
import { describe, expect, it } from "vitest";
import {
  parseRailPreferences,
  RECENT_PROVIDERS_KEY,
  recentProviders,
} from "../src/shell/lib/preferences";

describe("shell local preferences", () => {
  it.each([null, false, 1, {}, { pinned: "home" }])("defaults invalid pins: %j", (value) =>
    expect(parseRailPreferences(value)).toEqual({ pinned: defaultRailPins }));
  it("filters, deduplicates and limits pins while preserving order", () => {
    expect(
      parseRailPreferences({
        pinned: [
          "docs",
          "missing",
          "docs",
          "home",
          "drive",
          "tasks",
          "permissions",
          "calendar",
          "photos",
        ],
      }).pinned,
    ).toEqual(["docs", "home", "drive", "tasks", "permissions", "calendar"]);
    expect(parseRailPreferences({ pinned: [] }).pinned).toEqual([]);
  });
  it.each([null, "{", "null", "{}"])("ignores corrupt recent providers: %j", (value) =>
    expect(recentProviders(value)).toEqual([]));
  it("keeps five unique http(s) recent providers and drops credentials and unsafe schemes", () => {
    expect(RECENT_PROVIDERS_KEY).toBe("suite.recentProviders.v1");
    expect(
      recentProviders(
        JSON.stringify([
          1,
          "no",
          "javascript:alert(1)",
          "https://user:pass@example.org/",
          "https://user@example.org/",
          "http://localhost:3000/",
          "https://example.org/",
          "https://example.org/",
          "https://example.com/",
          "https://id.example.org/",
          "https://id.example.com/",
          "https://six.example.org/",
        ]),
      ),
    ).toEqual([
      "http://localhost:3000/",
      "https://example.org/",
      "https://example.com/",
      "https://id.example.org/",
      "https://id.example.com/",
    ]);
  });
});
