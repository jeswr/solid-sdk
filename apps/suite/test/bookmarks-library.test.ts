// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import {
  bookmarkDraft,
  bookmarkImport,
  bookmarkTags,
  bookmarkTitle,
  importSizeMessage,
  visibleBookmarks,
} from "../src/apps/bookmarks/lib/library";

const items = [
  {
    id: "a",
    data: {
      url: "https://example.org/first",
      title: "Zebra",
      notes: "A quiet afternoon",
      tags: ["reading", "reading"],
      created: new Date(1000),
    },
  },
  {
    id: "b",
    data: {
      url: "https://example.net/second",
      title: "Apple",
      description: "A design story",
      archived: true,
      tags: ["design", "reading"],
      created: new Date(2000),
    },
  },
  { id: "c", data: { url: "https://example.com/third" } },
];
const base = { view: "all" as const, tag: null, search: "", sort: "newest" as const };
describe("bookmark presentation", () => {
  it.each([
    ["https://example.com", "https://example.com/"],
    ["HTTPS://EXAMPLE.org/", "https://example.org/"],
    ["https://de.wikipedia.org/wiki/Äpfel", "https://de.wikipedia.org/wiki/%C3%84pfel"],
  ])("canonicalises typed bookmark URLs: %s", (input, url) => {
    expect(bookmarkDraft({ url: input, title: "", description: "", notes: "", tags: "" }).url).toBe(
      url,
    );
  });
  it.each([
    "java&#x73;cript:alert(1)",
    "java\nscript:alert(1)",
    "jav\tascript:alert(1)",
    "&#x64;ata:text/html,x",
    "&#x66;ile:///x",
    "ht\ntps://example.org/",
    "h\tttps://example.org/",
    "https:example.org",
  ])("rejects encoded or control-character schemes: %s", (url) => {
    expect(() => bookmarkDraft({ url, title: "", description: "", notes: "", tags: "" })).toThrow(
      "http",
    );
  });
  it("uses one friendly message for byte, token and bookmark count limits", () => {
    expect(bookmarkImport('<a href="https://example.org/">Good</a>').bookmarks).toHaveLength(1);
    for (const html of [
      " ".repeat(10_000_001),
      "<p>".repeat(100_002),
      '<a href="https://example.org/">One</a>'.repeat(5001),
    ])
      expect(() => bookmarkImport(html)).toThrow(importSizeMessage);
  });
  it("validates drafts, defaults titles to the host, trims and deduplicates tags", () => {
    expect(
      bookmarkDraft({
        url: " https://example.org/a ",
        title: " ",
        description: " x ",
        notes: " n ",
        tags: "one, two\none, ,",
      }),
    ).toMatchObject({
      url: "https://example.org/a",
      title: "example.org",
      description: "x",
      notes: "n",
      tags: ["one", "two"],
    });
    expect(
      bookmarkDraft({
        url: "http://example.net/",
        title: " Custom ",
        description: "",
        notes: "",
        tags: "",
      }).title,
    ).toBe("Custom");
    for (const url of ["", "example.org", "file:///x", "javascript:alert(1)", "data:text/html,x"])
      expect(() => bookmarkDraft({ url, title: "", description: "", notes: "", tags: "" })).toThrow(
        "http",
      );
  });
  it("filters all, unread, archive, tags and terms across every text field", () => {
    expect(visibleBookmarks(items, base).map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(visibleBookmarks(items, { ...base, view: "unread" }).map((item) => item.id)).toEqual([
      "a",
      "c",
    ]);
    expect(visibleBookmarks(items, { ...base, view: "archived" }).map((item) => item.id)).toEqual([
      "b",
    ]);
    for (const search of ["ZEBRA", "quiet", "example.org", "reading afternoon"])
      expect(visibleBookmarks(items, { ...base, search }).some((item) => item.id === "a")).toBe(
        true,
      );
    expect(
      visibleBookmarks(items, { ...base, tag: "design", search: "story" }).map((item) => item.id),
    ).toEqual(["b"]);
    expect(visibleBookmarks(items, { ...base, tag: "missing" })).toEqual([]);
    expect(visibleBookmarks(items, { ...base, search: "not present" })).toEqual([]);
  });
  it("sorts deterministically by date and fallback title without mutating inputs", () => {
    expect(visibleBookmarks(items, { ...base, sort: "oldest" }).map((item) => item.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(visibleBookmarks(items, { ...base, sort: "title" }).map((item) => item.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(
      visibleBookmarks(
        [
          { id: "b", data: { url: "https://example.org/" } },
          { id: "a", data: { url: "https://example.org/" } },
        ],
        base,
      ).map((item) => item.id),
    ).toEqual(["a", "b"]);
    expect(items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(bookmarkTitle(items[2]?.data as { url: string })).toBe("example.com");
  });
  it("counts each tag once per bookmark across all views", () => {
    expect(bookmarkTags(items)).toEqual([
      ["design", 1],
      ["reading", 2],
    ]);
    expect(bookmarkTags([])).toEqual([]);
  });
});
