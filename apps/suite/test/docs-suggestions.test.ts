// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom

import { history, redo, undo } from "@tiptap/pm/history";
import {
  DOMParser,
  DOMSerializer,
  Fragment,
  type MarkType,
  type NodeType,
  Slice,
} from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { Editor, getSchema } from "@tiptap/react";
import { ySyncPluginKey, yUndoPluginKey } from "@tiptap/y-tiptap";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import { suggestionColour } from "../src/apps/docs/editor/suggestion-marks";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { exportMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml } from "../src/apps/docs/lib/convert/schema";
import {
  createSuggestionPlugin,
  resolveSuggestions,
  type Suggestion,
  suggestionAction,
  suggestionAt,
  suggestionKey,
  suggestions,
} from "../src/apps/docs/lib/editor/suggestions";

const schema = getSchema(baseExtensions(globalThis.fetch));
const author = "https://alice.example/#me";
const { bold, suggestionInsert } = schema.marks as { bold: MarkType; suggestionInsert: MarkType };
function setup(text = "hello world", enabled = true) {
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, text ? [schema.text(text)] : []),
    ]),
    plugins: [createSuggestionPlugin(), history()],
  });
  const apply = (tr: typeof state.tr) => {
    state = state.applyTransaction(tr).state;
  };
  apply(state.tr.setMeta(suggestionKey, { enabled, author }));
  return {
    get state() {
      return state;
    },
    apply,
    select(from: number, to = from) {
      apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    },
  };
}
const marks = (s: ReturnType<typeof setup>) => suggestions(s.state.doc);
function resolve(s: ReturnType<typeof setup>, accept: boolean, id?: string) {
  s.apply(resolveSuggestions(s.state, accept, id));
}

describe("suggesting transactions", () => {
  it("marks typing, extends consecutive typing with the same id and leaves editing mode plain", () => {
    const s = setup("");
    s.apply(s.state.tr.insertText("a"));
    const first = marks(s)[0] as Suggestion;
    expect(first).toMatchObject({ author, kind: "suggestionInsert" });
    expect(Number.isFinite(Date.parse(first.created))).toBe(true);
    s.apply(s.state.tr.insertText("b"));
    expect(s.state.doc.textContent).toBe("ab");
    expect(marks(s)).toEqual([first]);
    expect(s.state.selection.from).toBe(3);
    expect(suggestionAt(s.state)).toEqual(first);
    s.apply(s.state.tr.setMeta(suggestionKey, { enabled: false, author }));
    s.apply(s.state.tr.insertText("c"));
    expect(s.state.doc.nodeAt(3)?.marks).toEqual([]);
  });
  it.each([
    true,
    false,
  ])("marks deletions and moves the caret in the deletion direction (backwards %s)", (backwards) => {
    const s = setup();
    s.select(backwards ? 6 : 1);
    s.apply(s.state.tr.delete(1, 6));
    expect(s.state.doc.textContent).toBe("hello world");
    expect(marks(s)).toMatchObject([{ kind: "suggestionDelete", author }]);
    expect(s.state.selection.from).toBe(backwards ? 1 : 6);
  });
  it("really removes one's own pending insertion, including mixed selections", () => {
    const s = setup("plain");
    s.select(6);
    s.apply(s.state.tr.insertText(" new"));
    s.apply(s.state.tr.delete(8, 10));
    expect(s.state.doc.textContent).toBe("plain n");
    expect(marks(s)).toHaveLength(1);
    s.select(1, 8);
    s.apply(s.state.tr.deleteSelection());
    expect(s.state.doc.textContent).toBe("plain");
    expect(marks(s)).toMatchObject([{ kind: "suggestionDelete" }]);
  });
  it("marks another author's insertion as a deletion and preserves existing pending deletion attribution", () => {
    const s = setup("abc");
    s.apply(
      s.state.tr.addMark(
        1,
        2,
        suggestionInsert.create({ id: "other", author: "bob", created: "then" }),
      ),
    );
    s.apply(s.state.tr.delete(1, 2));
    expect(s.state.doc.textContent).toBe("abc");
    const first = marks(s);
    expect(first).toMatchObject([{ kind: "suggestionDelete", author }]);
    s.apply(s.state.tr.delete(1, 2));
    expect(marks(s)).toEqual(first);
  });
  it("replaces selected text and handles pasted formatted inline text", () => {
    const s = setup();
    s.select(1, 6);
    s.apply(s.state.tr.insertText("goodbye"));
    expect(s.state.doc.textContent).toBe("goodbyehello world");
    expect(marks(s)).toHaveLength(1); // one id identifies the whole replacement
    expect(s.state.doc.nodeAt(1)?.marks[0]?.type.name).toBe("suggestionInsert");
    expect(s.state.doc.nodeAt(8)?.marks[0]?.type.name).toBe("suggestionDelete");
    s.select(19);
    s.apply(
      s.state.tr
        .replaceSelection(new Slice(Fragment.from(schema.text(" paste", [bold.create()])), 0, 0))
        .setMeta("paste", true),
    );
    expect(s.state.doc.textContent).toBe("goodbyehello world paste");
    expect(s.state.doc.nodeAt(19)?.marks.map((m) => m.type.name)).toEqual([
      "bold",
      "suggestionInsert",
    ]);
  });
  it("replays multiple steps with correct coordinates and retains formatting edits", () => {
    const s = setup("abc");
    s.select(2);
    s.apply(s.state.tr.delete(2, 3).insertText("X", 2).addMark(1, 2, bold.create()));
    expect(s.state.doc.textContent).toBe("abXc");
    expect(s.state.doc.nodeAt(1)?.marks[0]?.type.name).toBe("bold");
  });
  it("leaves structural edits, formatting, remote sync, explicit actions and history untouched", () => {
    const s = setup("abc");
    s.apply(s.state.tr.addMark(1, 2, bold.create()));
    expect(marks(s)).toEqual([]);
    s.select(2);
    s.apply(s.state.tr.split(2));
    expect(s.state.doc.childCount).toBe(2);
    for (const meta of [ySyncPluginKey, yUndoPluginKey, suggestionAction]) {
      s.apply(s.state.tr.insertText("r").setMeta(meta, {}));
      expect(marks(s)).toEqual([]);
    }
    s.apply(s.state.tr.insertText("s"));
    const before = s.state.doc.toJSON();
    expect(undo(s.state, s.apply)).toBe(true);
    expect(redo(s.state, s.apply)).toBe(true);
    expect(s.state.doc.toJSON()).toEqual(before);
  });
});

describe("resolving suggestions", () => {
  it.each([
    true,
    false,
  ])("resolves insertions and deletions by id or together (accept %s)", (accept) => {
    const s = setup("old");
    s.select(4);
    s.apply(s.state.tr.insertText("new"));
    const insertion = marks(s)[0] as Suggestion;
    s.select(1, 4);
    s.apply(s.state.tr.deleteSelection());
    expect(marks(s)).toHaveLength(2);
    const tr = resolveSuggestions(s.state, accept, insertion.id);
    expect(tr.getMeta(suggestionAction)).toBe(true);
    s.apply(tr);
    expect(s.state.doc.textContent).toBe(accept ? "oldnew" : "old");
    expect(marks(s)).toMatchObject([{ kind: "suggestionDelete" }]);
    resolve(s, accept);
    expect(s.state.doc.textContent).toBe(accept ? "new" : "old");
    expect(marks(s)).toEqual([]);
    expect(suggestionAt(s.state)).toBeUndefined();
    expect(resolveSuggestions(s.state, true).steps).toEqual([]);
  });
  it("resolves a replacement as a single suggestion and gathers split marked ranges", () => {
    const s = setup("old");
    s.select(1, 4);
    s.apply(s.state.tr.insertText("new"));
    s.apply(s.state.tr.addMark(2, 3, bold.create()));
    expect(marks(s)).toHaveLength(1);
    resolve(s, true, (marks(s)[0] as Suggestion).id);
    expect(s.state.doc.textContent).toBe("new");
    expect(marks(s)).toEqual([]);
  });
});

it("round trips suggestion marks, metadata and author styling through HTML without creating strike/underline marks", () => {
  const s = setup("old");
  s.select(1, 4);
  s.apply(s.state.tr.insertText("new"));
  const element = document.createElement("div");
  element.append(DOMSerializer.fromSchema(schema).serializeFragment(s.state.doc.content));
  expect(element.querySelector("ins")?.getAttribute("data-suggestion-author")).toBe(author);
  expect(element.querySelector("del")?.getAttribute("class")).toBe("docs-suggestion-del");
  expect(DOMParser.fromSchema(schema).parse(element).toJSON()).toEqual(s.state.doc.toJSON());
  expect(importHtml(element.innerHTML).json).toEqual(s.state.doc.toJSON());
  expect(suggestionColour(author)).toBe(suggestionColour(author));
  expect(new Set(["a", "b", "c", "d"].map(suggestionColour)).size).toBe(4);
});

it("exports pending insertions and deletions as plain text in Markdown and DOCX", async () => {
  const s = setup("old");
  s.select(1, 4);
  s.apply(s.state.tr.insertText("new"));
  const json = s.state.doc.toJSON();
  expect(exportMarkdown(json)).toBe("newold");
  const docx = await toDocx(json, async () => {
    throw new Error("no images");
  });
  const zip = await openArrayBuffer(await Packer.toArrayBuffer(docx));
  const xml = await zip.read("word/document.xml", "utf-8");
  expect(xml).toContain("new");
  expect(xml).toContain("old");
  expect(xml).not.toMatch(/<w:(ins|del|strike|u)[\s/>]/);
});

it("uses a single Yjs undo item and does not rewrite undo or redo", () => {
  const doc = new Y.Doc();
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: editorExtensions(doc, globalThis.fetch),
  });
  editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: true, author }));
  editor.commands.insertContent("hello");
  expect(suggestions(editor.state.doc)).toHaveLength(1);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.doc.textContent).toBe("");
  expect(editor.commands.redo()).toBe(true);
  expect(editor.state.doc.textContent).toBe("hello");
  expect(suggestions(editor.state.doc)).toHaveLength(1);
  editor.destroy();
  doc.destroy();
});

it("applies hard breaks and their deletion normally, and tracks typing inside code blocks", () => {
  const s = setup("abc");
  s.select(2);
  s.apply(s.state.tr.replaceSelectionWith(schema.node("hardBreak")));
  expect(marks(s)).toEqual([]);
  s.apply(s.state.tr.delete(2, 3));
  expect(s.state.doc.textContent).toBe("abc");
  expect(marks(s)).toEqual([]);
  s.apply(s.state.tr.setBlockType(1, 4, schema.nodes.codeBlock as NodeType));
  s.apply(s.state.tr.insertText("code", 1));
  expect(marks(s)).toMatchObject([{ kind: "suggestionInsert" }]);
});
it("clears inherited suggestion stored marks and retains explicit formatting", () => {
  const s = setup("abc");
  const boldMark = bold.create();
  const suggestion = suggestionInsert.create({
    id: "stored",
    author,
    created: "then",
  });
  s.apply(s.state.tr.insertText("x", 1).setStoredMarks([boldMark, suggestion]));
  expect(s.state.storedMarks).toEqual([boldMark]);
});
it("preserves offsets when formatting and editing newly inserted text in the same transaction", () => {
  const s = setup("old");
  s.select(1, 4);
  s.apply(s.state.tr.insertText("new").addMark(1, 3, bold.create()).insertText("!", 3));
  expect(s.state.doc.textContent).toBe("ne!wold");
  expect(s.state.doc.nodeAt(1)?.marks.map((mark) => mark.type.name)).toContain("bold");
  expect(s.state.doc.nodeAt(5)?.marks.map((mark) => mark.type.name)).not.toContain("bold");
});
it("ignores zero-width formatting steps when replaying a text edit", async () => {
  const { AddMarkStep } = await import("@tiptap/pm/transform");
  const s = setup("abc");
  s.apply(s.state.tr.insertText("x", 2).step(new AddMarkStep(2, 2, bold.create())));
  expect(s.state.doc.textContent).toBe("axbc");
  expect(marks(s)).toHaveLength(1);
});

it("parses incomplete suggestion HTML safely and uses text-only author colours", () => {
  const element = document.createElement("div");
  element.innerHTML = '<p><ins data-suggestion-id="missing">text</ins></p>';
  const doc = DOMParser.fromSchema(schema).parse(element);
  expect(doc.firstChild?.firstChild?.marks[0]?.attrs).toMatchObject({ author: "", created: "" });
  DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
  const invalid = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "safe",
            marks: [{ type: "suggestionInsert", attrs: { id: "malformed", author: null } }],
          },
        ],
      },
    ],
  });
  expect(() => DOMSerializer.fromSchema(schema).serializeFragment(invalid.content)).not.toThrow();
});

it("shares final tracked edits with another Yjs editor and leaves that peer's plain editing untouched", async () => {
  const { prosemirrorJSONToYDoc } = await import("@tiptap/y-tiptap");
  const doc = prosemirrorJSONToYDoc(schema, {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "old" }] }],
  });
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  const editor = new Editor({ extensions: editorExtensions(doc, fetch) });
  const other = new Editor({ extensions: editorExtensions(peer, fetch) });
  const send = (update: Uint8Array) => Y.applyUpdate(peer, update, "first");
  const receive = (update: Uint8Array) => Y.applyUpdate(doc, update, "second");
  doc.on("update", send);
  peer.on("update", receive);
  editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: true, author }));
  editor.commands.setTextSelection({ from: 1, to: 4 });
  editor.commands.insertContent("new");
  expect(other.getJSON()).toEqual(editor.getJSON());
  expect(other.state.doc.textContent).toBe("newold");
  expect(suggestions(other.state.doc)).toHaveLength(1);
  other.commands.setTextSelection(7);
  other.commands.insertContent("plain");
  expect(editor.getJSON()).toEqual(other.getJSON());
  expect(editor.state.doc.nodeAt(7)?.marks).toEqual([]);
  editor.view.dispatch(resolveSuggestions(editor.state, true));
  expect(other.state.doc.textContent).toBe("newplain");
  expect(suggestions(other.state.doc)).toEqual([]);
  editor.destroy();
  other.destroy();
  doc.destroy();
  peer.destroy();
});
