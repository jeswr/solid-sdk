// AUTHORED-BY Codex GPT-6.1-Sol
import type { SharedItem } from "@jeswr/suite-sdk/shared";
import { describe, expect, it } from "vitest";
import { encodeRef } from "../src/lib/refs";
import { openedSharedItems, sharedItemHref, sharedSender } from "../src/lib/shared/items";

const storage = "https://bob.example/";
const url = `${storage}docs/plan.ttl`;
const item: SharedItem = { url, name: "Plan", app: "docs", kind: "document", source: "opened" };

describe("shared item presentation", () => {
  it.each([
    ["docs/plan.ttl", "docs/d"],
    ["sheets/budget/", "sheets/s"],
    ["tasks/team.ttl", "tasks/p"],
    ["docs/file.md", "drive/p"],
    ["docs/file.docx", "drive/p"],
    ["docs/file.txt", "drive/p"],
    ["docs/file.html", "drive/p"],
    ["sheets/data.csv", "drive/p"],
    ["sheets/data.xlsx", "drive/p"],
    ["notes/n.ttl", "drive/p"],
    ["photos/p.jpg", "drive/p"],
    ["photos/albums/p.ttl", "drive/p"],
    ["calendar/a.ics", "drive/p"],
    ["calendar/personal/a.ttl", "drive/p"],
    ["music/a.mp3", "drive/p"],
    ["music/playlists/a.ttl", "drive/p"],
    ["music/albums/a.ttl", "drive/p"],
    ["file.bin", "drive/p"],
    ["folder/", "drive/f"],
  ])("opens %s in a capable destination", (path, route) => {
    const resource = `${storage}${path}`;
    expect(sharedItemHref({ ...item, url: `${resource}#it` }, storage)).toBe(
      `/${route}/${encodeRef(resource)}`,
    );
  });
  it("uses canonical Tasks metadata for arbitrary tracker URLs", () => {
    expect(
      sharedItemHref(
        {
          ...item,
          url: `${storage}home.ttl`,
          app: "tasks",
          rdfTypes: ["http://www.w3.org/2005/01/wf/flow#Tracker"],
        },
        storage,
      ),
    ).toBe(`/tasks/p/${encodeRef(`${storage}home.ttl`)}`);
  });
  it("previews foreign-origin and mismatched-actor announcements; titles cannot choose a route", () => {
    expect(sharedItemHref({ ...item, source: "inbox" }, "https://alice.example/")).toBe(
      `/drive/p/${encodeRef(url)}`,
    );
    expect(sharedItemHref({ ...item, source: "inbox", fromAnotherPod: true }, storage)).toBe(
      `/drive/p/${encodeRef(url)}`,
    );
    expect(sharedItemHref({ ...item, source: "inbox" })).toBe(`/drive/p/${encodeRef(url)}`);
    expect(sharedItemHref({ ...item, source: "inbox", fromAnotherPod: false }, storage)).toBe(
      `/docs/d/${encodeRef(url)}`,
    );
    expect(
      sharedItemHref({ ...item, url: `${storage}file.bin`, name: "docs/secret.ttl" }, storage),
    ).toBe(`/drive/p/${encodeRef(`${storage}file.bin`)}`);
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
    ).toMatchObject({ name: "Budget", app: "sheets", contentType: "text/csv" });
  });
  it("uses sender assertions without fetching profiles", () => {
    expect(sharedSender(undefined)).toBe("Unknown sender");
    expect(sharedSender("https://bob.example/profile#me")).toBe("bob.example");
    expect(sharedSender("Bob")).toBe("Bob");
    expect(sharedSender("urn:bob")).toBe("Unknown sender");
  });
});
