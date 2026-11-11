// AUTHORED-BY Codex GPT-6.1-Sol
import type { SharedItem } from "@jeswr/suite-sdk/shared";
import { describe, expect, it } from "vitest";
import { encodeRef } from "../src/lib/refs";
import { openedSharedItems, sharedItemHref, sharedSender } from "../src/lib/shared/items";

const url = "https://bob.example/docs/plan.ttl";
const item: SharedItem = { url, name: "Plan", app: "docs", kind: "document", source: "inbox" };

describe("shared item presentation", () => {
  it.each([
    ["docs", "document", `/docs/d/${encodeRef(url)}`],
    ["sheets", "spreadsheet", `/sheets/s/${encodeRef(url)}`],
    ["notes", "note", `/notes/n/${encodeRef(url)}`],
    ["tasks", "task-list", `/tasks/p/${encodeRef(url)}`],
    ["photos", "photo", `/photos/p/${encodeRef(url)}`],
    ["photos", "album", `/photos/a/${encodeRef(url)}`],
    ["calendar", "event", `/calendar/e/${encodeRef(url)}`],
    ["calendar", "calendar", `/calendar/week?calendar=${encodeRef(url)}`],
    ["music", "audio", "/music/search?q=Plan"],
    ["music", "playlist", `/music/p/${encodeRef(url)}`],
    ["music", "album", `/music/a/${encodeRef(url)}`],
    ["drive", "file", `/drive/p/${encodeRef(url)}`],
    ["drive", "folder", `/drive/f/${encodeRef(url)}`],
  ] as const)("uses %s's existing route for %s", (app, kind, href) => {
    expect(sharedItemHref({ ...item, app, kind })).toBe(href);
  });
  it("projects Drive's legacy entries and explicit metadata", () => {
    expect(openedSharedItems([{ url, openedAt: "2026-01-01" }])[0]).toMatchObject({
      name: "plan.ttl",
      app: "docs",
      sharedAt: "2026-01-01",
      source: "opened",
    });
    expect(
      openedSharedItems([
        { url, name: "Budget", contentType: "text/csv", openedAt: "2026-01-01" },
      ])[0],
    ).toMatchObject({ name: "Budget", app: "sheets" });
  });
  it("uses sender assertions without fetching profiles", () => {
    expect(sharedSender(undefined)).toBe("Unknown sender");
    expect(sharedSender("https://bob.example/profile#me")).toBe("bob.example");
    expect(sharedSender("Bob")).toBe("Bob");
    expect(sharedSender("urn:bob")).toBe("Unknown sender");
  });
});
