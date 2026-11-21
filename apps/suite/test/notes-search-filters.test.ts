// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import type { Note } from "../src/apps/notes/lib/model/note";
import type { NotesPreferences } from "../src/apps/notes/lib/model/prefs";
import {
  matchesNoteSearch,
  noteSearchHref,
  parseNoteSearch,
  serializeNoteSearch,
} from "../src/apps/notes/lib/search-filters";
import { taskListHtml } from "../src/apps/notes/lib/ui/capture";
import "./drive-ui-dom";

const root = "https://pod.example/";
const bob = `${root}bob#me`;
const note: Note = {
  url: `${root}notes/a.ttl`,
  title: "Garden ideas",
  body: "<p>Plant sunflowers</p>",
  labels: ["Ideas & plans"],
  location: "active",
  format: "text/html",
  revisions: [],
};
const prefs: NotesPreferences = { pinned: [], colours: {}, view: "grid" };
const context = { prefs, podRoot: root, sharedNotes: {}, collaborators: {} };

describe("Notes search URLs", () => {
  it("round-trips every filter and encoded labels, query and WebIDs", () => {
    const filters = {
      q: "red fox + café",
      type: "images" as const,
      colour: "blue" as const,
      label: " Ideas & plans / 家 ",
      shared: bob,
    };
    const encoded = serializeNoteSearch(filters);
    expect(parseNoteSearch(encoded)).toEqual(filters);
    expect(parseNoteSearch(new URLSearchParams(encoded))).toEqual(filters);
    expect(noteSearchHref(filters)).toBe(`/notes/search?${encoded}`);
    expect(noteSearchHref({ q: "" })).toBe("/notes/search");
    expect(serializeNoteSearch({ q: "" })).toBe("");
    expect(parseNoteSearch("q=%20%20hello%20%20&shared=any")).toEqual({
      q: "hello",
      shared: "any",
    });
    expect(parseNoteSearch("type=lists&colour=default")).toEqual({
      q: "",
      type: "lists",
      colour: "default",
    });
    expect(parseNoteSearch("type=reminders").type).toBe("reminders");
    expect(parseNoteSearch("type=links").type).toBe("links");
  });

  it("ignores unknown, empty, malformed and unsafe parameters without throwing", () => {
    expect(
      parseNoteSearch("future=x&type=unknown&colour=ultraviolet&label=%20&shared=broken"),
    ).toEqual({ q: "" });
    expect(parseNoteSearch("type=&colour=&label=&shared=")).toEqual({ q: "" });
    expect(parseNoteSearch("label=%00&shared=https%3A%2F%2Fu%3Ap%40example.org%2F")).toEqual({
      q: "",
    });
    for (const shared of [
      "javascript:alert(1)",
      "ftp://example.org/",
      "https://a b/",
      "https://a\\b/",
      "https://[",
      "https://a/\n",
    ]) {
      expect(parseNoteSearch(new URLSearchParams({ shared }))).toEqual({ q: "" });
    }
    expect(() => parseNoteSearch("q=%E0%A4%A&type=%ZZ")).not.toThrow();
    expect(parseNoteSearch("shared=http%3A%2F%2Fexample.org%2F%23me").shared).toBe(
      "http://example.org/#me",
    );
    expect(parseNoteSearch("type=images&type=lists").type).toBe("images");
  });
});

describe("Notes search predicate", () => {
  it("uses existing text ranking and label identity, includes archives and excludes Trash", () => {
    expect(matchesNoteSearch(note, { q: "sunflow" }, context)).toBe(true);
    expect(matchesNoteSearch(note, { q: "missing" }, context)).toBe(false);
    expect(matchesNoteSearch(note, { q: "garden", label: "Ideas & plans" }, context)).toBe(true);
    expect(matchesNoteSearch(note, { q: "", label: "ideas & plans" }, context)).toBe(false);
    expect(matchesNoteSearch({ ...note, location: "archived" }, { q: "garden" }, context)).toBe(
      true,
    );
    expect(matchesNoteSearch({ ...note, location: "trashed" }, { q: "" }, context)).toBe(false);
    expect(
      matchesNoteSearch(note, { q: "" }, { ...context, prefs: { ...prefs, pinned: [note.url] } }),
    ).toBe(true);
  });

  it("uses the approved image projection and actual checklist items", () => {
    expect(
      matchesNoteSearch(
        { ...note, body: `<img src="${root}notes/media/a.png">` },
        { q: "", type: "images" },
        context,
      ),
    ).toBe(true);
    expect(
      matchesNoteSearch(
        { ...note, body: '<img src="https://other.example/a.png">' },
        { q: "", type: "images" },
        context,
      ),
    ).toBe(false);
    expect(matchesNoteSearch(note, { q: "", type: "images" }, context)).toBe(false);
    expect(
      matchesNoteSearch(
        { ...note, body: taskListHtml([{ text: "Milk", checked: true }]) },
        { q: "", type: "lists" },
        context,
      ),
    ).toBe(true);
    expect(
      matchesNoteSearch(
        { ...note, body: "<ul><li>Ordinary list</li></ul>" },
        { q: "", type: "lists" },
        context,
      ),
    ).toBe(false);
  });

  it("matches valid reminders, safe link destinations and plain text URLs", () => {
    expect(
      matchesNoteSearch(
        { ...note, reminder: "2026-11-10T08:00:00Z" },
        { q: "", type: "reminders" },
        context,
      ),
    ).toBe(true);
    for (const reminder of [undefined, "invalid"])
      expect(matchesNoteSearch({ ...note, reminder }, { q: "", type: "reminders" }, context)).toBe(
        false,
      );
    for (const body of [
      '<p><a href="https://example.org/">Website</a></p>',
      "<p>See https://example.org/path</p>",
      '<p><a href="javascript:alert(1)">Unsafe</a> https://example.org/</p>',
    ])
      expect(matchesNoteSearch({ ...note, body }, { q: "", type: "links" }, context)).toBe(true);
    for (const body of [
      '<a href="javascript:alert(1)">Unsafe</a>',
      "<p>No links</p>",
      `<img src="${root}notes/media/a.png">`,
      "<a>Empty</a>",
      '<a href="broken">Relative</a>',
    ])
      expect(matchesNoteSearch({ ...note, body }, { q: "", type: "links" }, context)).toBe(false);
    expect(
      matchesNoteSearch(
        { ...note, title: "http://example.org/" },
        { q: "", type: "links" },
        context,
      ),
    ).toBe(true);
  });

  it("composes all filters with AND and uses local colours and discovered sharing", () => {
    const shared = {
      ...context,
      prefs: { ...prefs, colours: { [note.url]: "blue" as const } },
      sharedNotes: { [note.url]: true },
      collaborators: { [note.url]: [bob] },
    };
    const filters = {
      q: "garden",
      type: "links" as const,
      colour: "blue" as const,
      label: "Ideas & plans",
      shared: bob,
    };
    const linked = { ...note, body: '<a href="https://example.org/">Website</a>' };
    expect(matchesNoteSearch(linked, filters, shared)).toBe(true);
    expect(matchesNoteSearch(linked, { ...filters, colour: "red" }, shared)).toBe(false);
    expect(matchesNoteSearch(linked, { ...filters, shared: `${root}other#me` }, shared)).toBe(
      false,
    );
    expect(matchesNoteSearch(linked, { ...filters, shared: "any" }, shared)).toBe(true);
    expect(matchesNoteSearch(linked, { q: "", shared: "any" }, context)).toBe(false);
    expect(matchesNoteSearch(linked, { q: "", shared: bob }, context)).toBe(false);
    expect(matchesNoteSearch(note, { q: "", colour: "default" }, context)).toBe(true);
    expect(matchesNoteSearch(note, { q: "", colour: "blue" }, context)).toBe(false);
    expect(matchesNoteSearch(note, filters, shared)).toBe(false);
  });
});
