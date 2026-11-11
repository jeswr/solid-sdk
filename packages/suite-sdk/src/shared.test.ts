// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  classifySharedItem,
  hideSharedItem,
  isSharedItemUrl,
  isSharedUrlEntry,
  isSuiteDocsDocument,
  latestSharedEntries,
  mergeSharedItems,
  parseSharedEntries,
  removeSharedItem,
  type SharedItem,
  sharedAccountKey,
  sharedItemName,
  sharedItemsForAccount,
  sharedItemsFromInbox,
  visibleSharedItems,
} from "./shared.js";

const url = "https://bob.example/docs/plan.ttl";
const item = (fields: Partial<SharedItem> = {}): SharedItem => ({
  url,
  name: "plan.ttl",
  app: "drive",
  kind: "file",
  source: "opened",
  ...fields,
});

describe("classification", () => {
  it.each([
    ["sheets", "spreadsheet", "text/csv", "SpreadsheetDigitalDocument", "xlsx", "sheets"],
    ["notes", "note", "application/vnd.jeswr.note", "Note", "note", "notes"],
    ["tasks", "task-list", "application/vnd.jeswr.tasks", "Tracker", "todo", "tasks"],
    ["calendar", "calendar", "text/calendar", "Calendar", "ics", "calendar"],
    ["photos", "photo", "image/jpeg", "ImageObject", "png", "photos"],
    ["music", "audio", "audio/mpeg", "MusicRecording", "mp3", "music"],
    ["docs", "document", "text/markdown", "Document", "docx", "docs"],
  ])("routes %s by media type, RDF type, extension and decoded path", (app, kind, mime, type, extension, path) => {
    const expected = { app, kind };
    expect(
      classifySharedItem({ url, contentType: ` ${mime.toUpperCase()}; charset=utf-8` }),
    ).toEqual(expected);
    expect(
      classifySharedItem({ url, rdfTypes: ["unknown", `https://example/ns#${type}`] }),
    ).toEqual(expected);
    expect(classifySharedItem({ url: `https://pod.example/file.${extension}` })).toEqual(expected);
    expect(
      classifySharedItem({ url: `https://pod.example/file.${extension}`, name: "Friendly title" }),
    ).toEqual(expected);
    expect(
      classifySharedItem({
        url: "https://pod.example/file",
        name: `File.${extension.toUpperCase()}`,
      }),
    ).toEqual(expected);
    expect(classifySharedItem({ url: `https://pod.example/${path}/%66ile.ttl` })).toEqual(expected);
  });
  it.each([
    ["photos", "album", "PhotoAlbum", "photos/albums/party.ttl"],
    ["calendar", "event", "CalendarEvent", "calendar/personal/dinner.ttl"],
    ["music", "playlist", "MusicPlaylist", "music/playlists/mix.ttl"],
    ["music", "album", "MusicAlbum", "music/albums/record.ttl"],
  ])("preserves %s %s deep-link kinds", (app, kind, type, path) => {
    expect(classifySharedItem({ url: `https://pod.example/${path}` })).toEqual({ app, kind });
    expect(
      classifySharedItem({
        url: "https://pod.example/unknown.ttl",
        rdfTypes: [`https://schema.org/${type}`],
      }),
    ).toEqual({ app, kind });
  });
  it("prefers explicit types to filenames, paths and broad Document types", () => {
    expect(classifySharedItem({ url, name: "song.mp3", contentType: "text/csv" }).app).toBe(
      "sheets",
    );
    expect(
      classifySharedItem({
        url,
        rdfTypes: ["https://schema.org/Document", "https://schema.org/SpreadsheetDigitalDocument"],
      }).app,
    ).toBe("sheets");
    expect(classifySharedItem({ url, name: "photo.jpg" }).app).toBe("photos");
    expect(classifySharedItem({ url, contentType: "", rdfTypes: [] }).app).toBe("docs");
    expect(classifySharedItem({ url: "https://example/unknown.bin" })).toEqual({
      app: "drive",
      kind: "file",
    });
    expect(classifySharedItem({ url: "https://example/folder/" })).toEqual({
      app: "drive",
      kind: "folder",
    });
    expect(classifySharedItem({ url: "https://example/%FF" }).app).toBe("drive");
    expect(classifySharedItem({ url: "javascript:alert(1)" }).app).toBe("drive");
  });
  it("extracts names without trusting protocols or malformed escapes", () => {
    expect(sharedItemName("https://example/a%20b.ttl")).toBe("a b.ttl");
    expect(sharedItemName("https://example/")).toBe("example");
    expect(sharedItemName("broken")).toBe("broken");
    expect(sharedItemName("https://example/%FF")).toBe("https://example/%FF");
    for (const value of ["https://example/x", "http://example/x"])
      expect(isSharedItemUrl(value)).toBe(true);
    for (const value of [
      "broken",
      "data:text/plain,x",
      "https://u:p@example/x",
      "https://u@example/x",
    ])
      expect(isSharedItemUrl(value)).toBe(false);
  });
  it("preserves Drive's native Docs scope including legacy storage and separator guards", () => {
    expect(isSuiteDocsDocument(url, "https://bob.example/")).toBe(true);
    expect(
      isSuiteDocsDocument("https://bob.example/pod-docs/plan.ttl", "https://bob.example/"),
    ).toBe(true);
    for (const target of [
      "broken",
      "https://bob.example/docs/plan.md",
      "https://bob.example/docs/sub/a.ttl",
      "https://other.example/docs/plan.ttl",
      "https://bob.example/docs/a%2fb.ttl",
      "https://bob.example/docs/a%5Cb.ttl",
      "https://bob.example/docs/a.ttl?x=a.ttl",
      "https://bob.example/docs/a.ttl#b.ttl",
      "https://bob.example/docs-evil/a.ttl",
    ])
      expect(isSuiteDocsDocument(target, "https://bob.example/")).toBe(false);
    expect(isSuiteDocsDocument(url, "bad")).toBe(false);
  });
});

it("projects only share announcements, tolerating missing metadata and untrusted URLs", () => {
  const base = {
    url: "https://alice.example/inbox/1",
    type: "Announce",
    summary: "Shared with you as Editor",
    object: url,
  };
  expect(
    sharedItemsFromInbox([{ ...base, actor: "Bob", published: "2026-01-02T00:00:00Z" }]),
  ).toEqual([
    {
      url,
      name: "plan.ttl",
      app: "docs",
      kind: "document",
      sharedBy: "Bob",
      sharedAt: "2026-01-02T00:00:00Z",
      role: "Editor",
      source: "inbox",
    },
  ]);
  expect(sharedItemsFromInbox([{ ...base, content: " Team plan " }])[0]?.name).toBe("Team plan");
  const [minimal] = sharedItemsFromInbox([
    { ...base, summary: "Shared with you as ", published: "bad" },
  ]);
  expect(sharedItemsFromInbox([base])[0]).not.toHaveProperty("sharedAt");
  expect(minimal).toEqual({
    url,
    name: "plan.ttl",
    app: "docs",
    kind: "document",
    source: "inbox",
  });
  expect(
    sharedItemsFromInbox([
      { ...base, type: "Create" },
      { ...base, type: "Offer" },
      { ...base, summary: "Assigned", target: url },
      { url: base.url, type: "Announce" },
      { ...base, object: undefined },
      { ...base, object: "javascript:alert(1)" },
      { ...base, object: "https://u:p@example/secret" },
    ]),
  ).toEqual([]);
});

it("merges exact URLs newest first and keeps richer fields without mutating inputs", () => {
  const oldest = item({
    sharedAt: "2026-01-01",
    name: "Launch plan",
    app: "docs",
    kind: "document",
    sharedBy: "Bob",
    role: "Viewer",
    source: "app",
  });
  const newest = item({ sharedAt: "2026-02-01", role: "Editor", source: "inbox" });
  const other = item({ url: "https://z.example/undated", sharedAt: "bad" });
  expect(mergeSharedItems([oldest, other], [newest, item({ url: "javascript:alert(1)" })])).toEqual(
    [{ ...oldest, sharedAt: newest.sharedAt, role: "Editor", source: "inbox" }, other],
  );
  expect(oldest.role).toBe("Viewer");
  expect(newest.name).toBe("plan.ttl");
  expect(
    mergeSharedItems(
      [item({ name: "Explicit", app: "docs", kind: "document" })],
      [item({ name: "", sharedBy: "Bob", role: "Viewer" })],
    )[0],
  ).toMatchObject({ name: "Explicit", sharedBy: "Bob", role: "Viewer" });
  expect(mergeSharedItems([item({ name: "" }), item({ name: "Title" })])[0]?.name).toBe("Title");
  expect(mergeSharedItems([item(), item({ name: "" })])[0]?.name).toBe("plan.ttl");
  expect(
    mergeSharedItems([item({ sharedAt: "2026-01-01", name: "Title" }), item({ name: "old" })])[0]
      ?.sharedAt,
  ).toBe("2026-01-01");
  expect(mergeSharedItems()).toEqual([]);
  expect(
    mergeSharedItems([other, item({ url: "https://a.example/undated" })]).map((x) => x.url),
  ).toEqual(["https://a.example/undated", other.url]);
});

it("shares Drive's latest-entry selection and deterministic undated order", () => {
  const entries = [
    item({ sharedAt: "2026-02-01" }),
    item({ sharedAt: "2026-01-01" }),
    item({ sharedAt: "2026-02-01", name: "last" }),
  ];
  expect(latestSharedEntries(entries, (entry) => entry.sharedAt)).toEqual([entries[2]]);
  expect(
    latestSharedEntries(
      [item({ url: "https://z.example/" }), item({ url: "https://a.example/", sharedAt: "bad" })],
      (entry) => entry.sharedAt,
    ).map((entry) => entry.url),
  ).toEqual(["https://a.example/", "https://z.example/"]);
  expect(latestSharedEntries([], () => undefined)).toEqual([]);
});

describe("account-scoped removal lists", () => {
  it("uses Tasks' key scheme and fences signed-out or foreign account snapshots", () => {
    expect(sharedAccountKey("https://alice.example/#me", "suite.tasks.shared")).toBe(
      "suite.tasks.shared:https%3A%2F%2Falice.example%2F%23me",
    );
    expect(sharedAccountKey("alice")).toBe("suite.shared.hidden:alice");
    const snapshot = { owner: "alice", items: [{ url }] };
    expect(sharedItemsForAccount("alice", snapshot)).toBe(snapshot.items);
    expect(sharedItemsForAccount("bob", snapshot)).toEqual([]);
    expect(sharedItemsForAccount(undefined, { items: snapshot.items })).toEqual([]);
  });
  it("parses, validates and deduplicates; invalid storage is empty", () => {
    for (const raw of [null, "{", "null", "0", "{}", '"text"'])
      expect(parseSharedEntries(raw, isSharedUrlEntry)).toEqual([]);
    expect(
      parseSharedEntries(
        JSON.stringify([null, 0, {}, { url: 3 }, { url: "bad" }, { url }, { url, extra: true }]),
        isSharedUrlEntry,
      ),
    ).toEqual([{ url, extra: true }]);
  });
  it("hides safely and removes without modifying the input or resource permissions", () => {
    const items = [item(), item({ url: "https://other.example/a" })];
    const hidden = hideSharedItem([], url);
    expect(hideSharedItem(hidden, url)).toEqual(hidden);
    expect(hideSharedItem(hidden, "bad")).toEqual(hidden);
    expect(visibleSharedItems(items, hidden)).toEqual([items[1]]);
    expect(removeSharedItem(items, url)).toEqual([items[1]]);
    expect(items).toHaveLength(2);
    expect(hidden).toEqual([{ url }]);
  });
});
