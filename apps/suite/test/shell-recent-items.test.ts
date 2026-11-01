// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  isRecordablePath,
  parseRecentItems,
  RECENT_LIMIT,
  type RecentItem,
  recentItemsKey,
  recordRecentItem,
} from "../src/shell/lib/recent-items";

const now = new Date("2026-11-01T12:00:00Z");
const item = (href: string, title = "Search"): RecentItem => ({
  title,
  href,
  viewedAt: now.toISOString(),
});

describe("recent items", () => {
  it("keys the index per account and keeps twenty", () => {
    expect(recentItemsKey("demo")).toBe("suite.recent.v1.demo");
    expect(RECENT_LIMIT).toBe(20);
  });

  it.each([
    ["/search", true],
    ["/drive/f/aHR0cHM6Ly9leGFtcGxlLm9yZy8", true],
    ["/settings/account", true],
    ["/offlineish", true],
    ["search", false],
    ["//evil.example/", false],
    ["/a//b", false],
    ["/search?q=secret", false],
    ["/docs#heading", false],
    ["/a\\b", false],
    ["/a b", false],
    ["/a\u0000", false],
    ["/_next/static/chunk.js", false],
    ["/api/thing", false],
    ["/offline", false],
    ["/signin", false],
    ["/dev/components", false],
    ["/auth/callback.html", false],
  ])("recordable %j → %s", (href, expected) => expect(isRecordablePath(href)).toBe(expected));

  it("moves a revisited page to the front, trims titles and caps the list", () => {
    const first = recordRecentItem([], { title: "  Search  ", href: "/search" }, now);
    expect(first).toEqual([item("/search")]);
    const second = recordRecentItem(first, { title: "Notifications", href: "/notifications" }, now);
    const again = recordRecentItem(second, { title: "Search", href: "/search" }, now);
    expect(again.map((entry) => entry.href)).toEqual(["/search", "/notifications"]);
    expect(recordRecentItem(again, { title: "x".repeat(200), href: "/x" }, now)[0]?.title).toBe(
      "x".repeat(120),
    );
    const capped = recordRecentItem(again, { title: "Settings", href: "/settings" }, now, 2);
    expect(capped.map((entry) => entry.href)).toEqual(["/settings", "/search"]);
  });

  it("ignores pages without a title or with an unrecordable path", () => {
    const list = [item("/search")];
    expect(recordRecentItem(list, { title: " ", href: "/drive/my" }, now)).toEqual(list);
    expect(recordRecentItem(list, { title: "Offline", href: "/offline" }, now)).toEqual(list);
  });

  it.each([null, "{", "{}", "7"])("reads unreadable state as empty: %j", (raw) =>
    expect(parseRecentItems(raw)).toEqual([]));

  it("drops invalid and duplicate entries and caps a long list", () => {
    expect(
      parseRecentItems(
        JSON.stringify([
          item("/search"),
          item("/search", "Again"),
          item("//evil.example/"),
          { ...item("/notifications"), viewedAt: "today" },
          { ...item("/settings"), title: "" },
          "nope",
          item("/notifications", "Notifications"),
        ]),
      ),
    ).toEqual([item("/search"), item("/notifications", "Notifications")]);
    const many = Array.from({ length: 30 }, (_, i) => item(`/page-${i}`));
    expect(parseRecentItems(JSON.stringify(many))).toHaveLength(RECENT_LIMIT);
  });
});
