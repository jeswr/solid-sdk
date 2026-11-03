// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { documentSubject, type Revision } from "../src/apps/docs/lib/model/document";
import { DOCUMENT_CLASS, NS } from "../src/apps/docs/lib/model/vocab";
import { cardTextExcerpt } from "../src/apps/notes/lib";
import {
  buildNote,
  type Note,
  NoteColour,
  NoteDoc,
  notesPreferencesSchema,
  noteText,
  parseNote,
  prunePreferences,
  rekeyPreferences,
  selectNotes,
  togglePinned,
} from "../src/apps/notes/lib/model";

const ROOT = "https://pod.example/notes/";
const URL = `${ROOT}note.ttl`;
const NOW = new Date("2026-11-01T12:00:00Z");

function note(url: string, input: Partial<Note> = {}): Note {
  return {
    url,
    title: "",
    body: "",
    labels: [],
    format: "text/html",
    location: "active",
    revisions: [],
    ...input,
  };
}

describe("note document", () => {
  it("extends the shared document with interop types and literal labels", () => {
    const data = buildNote(URL, {
      title: "A note",
      body: "<p>Hello</p>",
      labels: ["work", "home", "work"],
      now: NOW,
    });
    const doc = new NoteDoc(documentSubject(URL), data, DataFactory);
    expect([...doc.types]).toEqual([DOCUMENT_CLASS, `${NS.SCHEMA}TextDigitalDocument`]);
    expect([...doc.labels]).toEqual(["work", "home"]);
    expect(parseNote(URL, data, "active")).toMatchObject({
      url: URL,
      title: "A note",
      body: "<p>Hello</p>",
      labels: ["work", "home"],
      format: "text/html",
      created: NOW.toISOString(),
      location: "active",
    });
    expect(parseNote(URL, new Store(), "active")).toBeUndefined();
    expect(parseNote(URL, buildNote(URL, { title: "" }), "active")?.body).toBe("");
    expect(() => buildNote(URL, { title: "", labels: [""] })).toThrow();
  });

  it("round trips typed PROV trash metadata and rejects foreign previous containers", () => {
    const url = `${ROOT}.trash/note.ttl`;
    for (const previousContainer of [ROOT, `${ROOT}archive/`, "https://evil.example/"]) {
      const data = buildNote(url, {
        title: "Trash",
        now: NOW,
        trashedAt: NOW.toISOString(),
        previousContainer,
      });
      const doc = new NoteDoc(documentSubject(url), data, DataFactory);
      expect(doc.trashedAt?.toISOString()).toBe(NOW.toISOString());
      expect(doc.previousContainer).toBe(previousContainer);
      const triples = [
        ...data.match(
          DataFactory.namedNode(documentSubject(url)),
          DataFactory.namedNode(`${NS.PROV}invalidatedAtTime`),
        ),
      ];
      expect(triples[0]?.object).toMatchObject({
        value: NOW.toISOString(),
        datatype: { value: `${NS.XSD}dateTime` },
      });
      expect(parseNote(url, data, "trashed")).toMatchObject({
        trashedAt: NOW.toISOString(),
        previous:
          previousContainer === ROOT
            ? "active"
            : previousContainer === `${ROOT}archive/`
              ? "archived"
              : undefined,
      });
    }
    expect(parseNote(url, buildNote(url, { title: "" }), "trashed")).toMatchObject({
      trashedAt: undefined,
      previous: undefined,
    });
  });

  it("caps automatic and named histories, without mutating prior inputs or duplicating named entries", () => {
    let prior: Revision[] = [];
    for (let index = 0; index < 26; index++) {
      const frozen = JSON.stringify(prior);
      const data = buildNote(URL, {
        title: "History",
        body: `${index}`,
        now: new Date(NOW.getTime() + index * 600_000),
        priorRevisions: prior,
        creator: `${ROOT}#owner`,
        editor: `${ROOT}#editor`,
        revisionLabel: `Named ${index}`,
      });
      expect(JSON.stringify(prior)).toBe(frozen);
      prior = parseNote(URL, data, "active")?.revisions as Revision[];
      expect(prior).toHaveLength(Math.min(20, index + 1));
      expect(prior[0]?.id).toBe(`${URL}#rev-${index}`);
      expect(prior.at(-1)?.wasRevisionOf).toBeUndefined();
      expect(
        [...data].filter(
          (quad) =>
            quad.predicate.value === `${NS.RDF}type` && quad.object.value === `${NS.PROV}Entity`,
        ),
      ).toHaveLength(prior.length);
    }
  });
});

describe("plain text", () => {
  it("projects checklists to lines, strips unsafe markup and decodes entities once", () => {
    const text = noteText(
      '<h2>Shop &amp; cook</h2><ul data-type="taskList"><li><input type="checkbox" checked><p>Milk&nbsp; &#x1F95B;</p></li><li><p>Bread &lt;b&gt; &copy; &quot;x&quot; &apos;y&apos;</p></li></ul><script>hidden</script><style>hidden</style>',
    );
    expect(text).toBe("Shop & cook\nMilk 🥛\nBread <b> © \"x\" 'y'");
    expect(noteText("<div> one  two <b>three</b><br>four</div><p>five</p>")).toBe(
      "one two three\nfour\nfive",
    );
    expect(noteText("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
    expect(noteText("<p>one\n\t two</p>")).toBe("one two");
    expect(noteText("<img src=x><!-- comment -->")).toBe("");
    expect(cardTextExcerpt(text, 4)).toBe("Shop");
  });
});

describe("preferences", () => {
  it("validates colours and defaults, toggles pins, prunes and rekeys without mutation", () => {
    const defaults = notesPreferencesSchema.parse({});
    expect(defaults).toEqual({ pinned: [], view: "grid", colours: {} });
    expect(NoteColour.options).toHaveLength(11);
    expect(notesPreferencesSchema.safeParse({ colours: { a: "invisible" } }).success).toBe(false);
    const prefs = {
      pinned: ["a", "b"],
      view: "list" as const,
      colours: { a: "red" as const, b: "teal" as const },
    };
    expect(togglePinned(defaults, "a").pinned).toEqual(["a"]);
    expect(togglePinned(prefs, "a").pinned).toEqual(["b"]);
    expect(prunePreferences(prefs, ["b"])).toEqual({
      pinned: ["b"],
      view: "list",
      colours: { b: "teal" },
    });
    expect(rekeyPreferences(prefs, "a", "b")).toEqual({
      pinned: ["b"],
      view: "list",
      colours: { b: "red" },
    });
    expect(rekeyPreferences(prefs, "a", "a")).toEqual(prefs);
    expect(rekeyPreferences(prefs, "missing", "z")).toEqual(prefs);
    expect(prefs.colours).toEqual({ a: "red", b: "teal" });
  });
});

describe("selection", () => {
  const a = note("a", {
    title: "Alpha",
    body: "<p>milk &amp; bread</p>",
    labels: ["home", "food"],
    modified: "2026-11-01",
  });
  const b = note("b", { title: "Bread", labels: ["food"], created: "2026-10-20" });
  const c = note("c", { title: "milk", labels: ["work"], modified: "bad" });
  const archive = note("archive", { location: "archived" });
  const trash = note("trash", { location: "trashed" });
  const notes = [b, a, c, archive, trash];
  const prefs = notesPreferencesSchema.parse({ pinned: ["b", "archive", "trash"] });
  it("combines location, labels and account pins with stable recency order", () => {
    expect(selectNotes(notes, prefs, { location: "active" })).toEqual({
      pinned: [b],
      others: [a, c],
    });
    expect(selectNotes(notes, prefs, { location: "active", labels: ["home", "food"] })).toEqual({
      pinned: [],
      others: [a],
    });
    expect(
      selectNotes(notes, prefs, {
        location: "active",
        labels: ["home", "food"],
        labelMode: "union",
      }),
    ).toEqual({ pinned: [b], others: [a] });
    expect(selectNotes(notes, prefs, { location: "archived" })).toEqual({
      pinned: [],
      others: [archive],
    });
    expect(selectNotes(notes, prefs, { location: "trashed" })).toEqual({
      pinned: [],
      others: [trash],
    });
  });
  it("ranks plain text without replacing HTML bodies or searching markup", () => {
    expect(selectNotes(notes, prefs, { location: "active", query: "milk" })).toEqual({
      pinned: [],
      others: [a, c],
    });
    expect(selectNotes(notes, prefs, { location: "active", query: "bread" }).pinned).toEqual([b]);
    expect(selectNotes(notes, prefs, { location: "active", query: "p" }).others).toEqual([]);
    expect(selectNotes(notes, prefs, { location: "active", query: " " })).toEqual(
      selectNotes(notes, prefs, { location: "active" }),
    );
    expect(a.body).toBe("<p>milk &amp; bread</p>");
  });
});
