// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom

import { DOMParser, DOMSerializer, type MarkType, Schema } from "@tiptap/pm/model";
import { AllSelection, EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { Editor } from "@tiptap/react";
import { afterEach, expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { importHtml } from "../src/apps/docs/lib/convert/schema";
import {
  createSuggestionPlugin,
  resolveSuggestions,
  type Suggestion,
  suggestionAction,
  suggestionKey,
  suggestions,
  suggestionUnsupported,
} from "../src/apps/docs/lib/editor/suggestions";

const editors: Editor[] = [];
function make(content = "<p>abc</p><p>def</p>", author = "alice") {
  const editor = new Editor({ extensions: baseExtensions(fetch), content });
  editors.push(editor);
  editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: true, author }));
  return editor;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});
function marked(editor: Editor, kind: string) {
  const text: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === kind)) text.push(node.text as string);
  });
  return text.join("");
}
it.each(["Z", ""])("preserves all textblocks when AllSelection is replaced with %j", (text) => {
  const editor = make();
  editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
  editor.view.dispatch(text ? editor.state.tr.insertText(text) : editor.state.tr.deleteSelection());
  expect(marked(editor, "suggestionDelete")).toBe("abcdef");
  expect(marked(editor, "suggestionInsert")).toBe(text);
  expect(editor.state.doc.childCount).toBeGreaterThanOrEqual(2);
  if (!text) expect(editor.state.doc.childCount).toBe(2);
  editor.view.dispatch(resolveSuggestions(editor.state, false));
  expect(editor.state.doc.textContent).toBe("abcdef");
});
it("preserves cross-paragraph deletions and only removes one's own insertions", () => {
  const editor = make();
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, 7)).deleteSelection(),
  );
  expect(editor.state.doc.textContent).toBe("abcdef");
  expect(editor.state.doc.childCount).toBe(2);
  expect(marked(editor, "suggestionDelete")).toBe("bcd");
});
it("marks every textblock in a multiline paste", () => {
  const editor = make("<p>hello world</p>");
  editor.commands.setTextSelection(6);
  editor.view.pasteText("one\ntwo", new Event("paste") as ClipboardEvent);
  expect(marked(editor, "suggestionInsert")).toBe("onetwo");
  expect(editor.state.doc.textContent).toBe("helloonetwo world");
  expect(suggestions(editor.state.doc)).toHaveLength(1);
});
it("blocks unsupported node deletion and ReplaceAroundStep atomically with a notification", () => {
  const blocked = vi.fn();
  const editor = make('<p>abc</p><img src="https://example.com/image.png"><p>def</p>');
  editor.view.dom.addEventListener(suggestionUnsupported, blocked);
  const before = editor.getJSON();
  editor.view.dispatch(
    editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 5)).deleteSelection(),
  );
  expect(editor.getJSON()).toEqual(before);
  editor.commands.setTextSelection(2);
  editor.commands.toggleBlockquote();
  expect(editor.getJSON()).toEqual(before);
  expect(blocked).toHaveBeenCalled();
});
it.each([
  "accept-delete",
  "reject-delete",
  "accept-insert",
  "reject-insert",
  "accept-all",
  "reject-all",
])("resolves overlapping authors safely: %s", (action) => {
  const editor = make("<p>abc</p>", "bob");
  editor.commands.setTextSelection(4);
  editor.commands.insertContent("XYZ");
  const bob = suggestions(editor.state.doc)[0] as Suggestion;
  editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: true, author: "alice" }));
  editor.view.dispatch(editor.state.tr.delete(4, 7));
  const alice = suggestions(editor.state.doc).find((s) => s.author === "alice") as Suggestion;
  expect(suggestions(editor.state.doc)).toHaveLength(2);
  const container = document.createElement("div");
  container.append(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.content),
  );
  expect(container.querySelector("ins del")).not.toBeNull();
  expect(DOMParser.fromSchema(editor.schema).parse(container).toJSON()).toEqual(editor.getJSON());
  const accept = action.startsWith("accept");
  editor.view.dispatch(
    resolveSuggestions(
      editor.state,
      accept,
      action.endsWith("all") ? undefined : action.endsWith("delete") ? alice.id : bob.id,
    ),
  );
  expect(editor.state.doc.textContent).toBe(
    ["accept-delete", "reject-insert", "accept-all", "reject-all"].includes(action)
      ? "abc"
      : "abcXYZ",
  );
  expect(suggestions(editor.state.doc)).toEqual(
    action === "reject-delete" ? [bob] : action === "accept-insert" ? [alice] : [],
  );
});
it.each([
  false,
  true,
])("strips forged and copied metadata at the paste/import boundary (suggesting %s)", (enabled) => {
  const html =
    '<p><ins data-suggestion-id="forged" data-suggestion-author="bob"><del data-suggestion-id="deleted">copied</del></ins></p>';
  const editor = make("<p></p>");
  editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled, author: "alice" }));
  editor.view.pasteHTML(html, new Event("paste") as ClipboardEvent);
  expect(editor.state.doc.textContent).toBe("copied");
  const pending = suggestions(editor.state.doc);
  expect(pending).toHaveLength(enabled ? 1 : 0);
  if (enabled)
    expect(pending[0]).toMatchObject({
      author: "alice",
      kind: "suggestionInsert",
      id: expect.not.stringMatching(/forged|deleted/),
    });
  expect(JSON.stringify(importHtml(html).json)).not.toContain("suggestion");
});
it("pasting next to one's own suggestion creates a fresh id", () => {
  const editor = make("<p></p>");
  editor.commands.insertContent("first");
  const first = suggestions(editor.state.doc)[0] as Suggestion;
  editor.view.pasteHTML(editor.getHTML(), new Event("paste") as ClipboardEvent);
  expect(suggestions(editor.state.doc)).toHaveLength(2);
  expect(suggestions(editor.state.doc).filter((s) => s.id === first.id)).toHaveLength(1);
});
it("defers composition rewriting until compositionend, then marks the composed range once", async () => {
  const editor = make("<p>old</p>");
  const composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(true);
  editor.commands.setTextSelection({ from: 1, to: 4 });
  editor.view.dispatch(editor.state.tr.insertText("n").setMeta("composition", 1));
  expect(editor.state.doc.textContent).toBe("n");
  expect(suggestions(editor.state.doc)).toHaveLength(0);
  editor.view.dispatch(editor.state.tr.insertText("你", 1, 2).setMeta("composition", 1));
  expect(editor.state.doc.textContent).toBe("你");
  composing.mockReturnValue(false);
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await vi.waitFor(() => expect(marked(editor, "suggestionInsert")).toBe("你"));
  expect(marked(editor, "suggestionDelete")).toBe("old");
  expect(suggestions(editor.state.doc)).toHaveLength(1);
});
it("coalesces consecutive Backspaces by the same author", () => {
  const editor = make("<p>word</p>");
  editor.commands.setTextSelection(5);
  for (let pos = 4; pos >= 1; pos--) editor.view.dispatch(editor.state.tr.delete(pos, pos + 1));
  expect(marked(editor, "suggestionDelete")).toBe("word");
  expect(suggestions(editor.state.doc)).toHaveLength(1);
});

it("retains original text and block structure when replacing mixed own insertions across paragraphs", () => {
  const editor = make();
  editor.commands.setTextSelection(3);
  editor.commands.insertContent("OWN");
  editor.commands.setTextSelection({ from: 2, to: 10 });
  editor.view.dispatch(editor.state.tr.insertText("Q"));
  expect(editor.state.doc.textContent).toBe("aQbcdef");
  expect(editor.state.doc.childCount).toBe(2);
  expect(marked(editor, "suggestionInsert")).toBe("Q");
  expect(marked(editor, "suggestionDelete")).toBe("bcd");
  editor.view.dispatch(resolveSuggestions(editor.state, false));
  expect(editor.state.doc.textContent).toBe("abcdef");
});
it("rejecting overlapping suggestions cannot delete adjacent plain text twice", () => {
  const editor = make("<p>leftmiddleRIGHT</p>", "bob");
  editor.commands.setTextSelection({ from: 5, to: 11 });
  editor.view.dispatch(editor.state.tr.insertText("new"));
  editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: true, author: "alice" }));
  editor.view.dispatch(editor.state.tr.delete(5, 8));
  editor.view.dispatch(resolveSuggestions(editor.state, false));
  expect(editor.state.doc.textContent).toBe("leftmiddleRIGHT");
  expect(suggestions(editor.state.doc)).toEqual([]);
});
it("never groups deletion suggestions from different authors", () => {
  const editor = make("<p>word</p>", "bob");
  editor.commands.setTextSelection(5);
  editor.view.dispatch(editor.state.tr.delete(4, 5));
  editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: true, author: "alice" }));
  editor.view.dispatch(editor.state.tr.delete(3, 4));
  expect(suggestions(editor.state.doc).map((s) => s.author)).toEqual(["alice", "bob"]);
});
it("blocks deletion of a table and blocks the whole transaction if any step is unsupported", () => {
  const editor = make("<p>before</p><table><tr><td>cell</td></tr></table><p>after</p>");
  const before = editor.getJSON();
  editor.view.dispatch(editor.state.tr.insertText("new", 1).delete(11, 23));
  expect(editor.getJSON()).toEqual(before);
});
it("stored HTML snapshots reload pending marks through the persistence parser", async () => {
  const { parseDocumentHtml } = await import("../src/apps/docs/lib/editor/parse-html");
  const editor = make("<p>original</p>");
  editor.commands.setTextSelection({ from: 1, to: 9 });
  editor.commands.insertContent("new");
  const stored = parseDocumentHtml(editor.getHTML(), baseExtensions(fetch));
  expect(stored).toEqual(editor.getJSON());
  const reloaded = make(editor.getHTML());
  expect(suggestions(reloaded.state.doc)).toEqual(suggestions(editor.state.doc));
});
it("flushes a composition on the first transaction after composition ends", () => {
  const editor = make("<p></p>");
  const composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(true);
  editor.view.dispatch(editor.state.tr.insertText("你"));
  expect(suggestions(editor.state.doc)).toEqual([]);
  composing.mockReturnValue(false);
  editor.view.dispatch(editor.state.tr.insertText("好"));
  expect(editor.state.doc.textContent).toBe("你好");
  expect(marked(editor, "suggestionInsert")).toBe("你好");
  expect(suggestions(editor.state.doc)).toHaveLength(1);
});
it("does not create suggestions for an empty or cancelled composition", async () => {
  const editor = make("<p>text</p>");
  const composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(true);
  editor.commands.setTextSelection(2);
  composing.mockReturnValue(false);
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(editor.state.doc.textContent).toBe("text");
  expect(suggestions(editor.state.doc)).toEqual([]);
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(suggestions(editor.state.doc)).toEqual([]);
});

it("preserves remote formatting received during a composition, before and after local text", async () => {
  const { AddMarkStep } = await import("@tiptap/pm/transform");
  const editor = make("<p>old</p>");
  const composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(true);
  const bold = editor.schema.marks.bold as MarkType;
  const italic = editor.schema.marks.italic as MarkType;
  editor.view.dispatch(
    editor.state.tr.addMark(1, 2, bold.create()).setMeta(suggestionAction, true),
  );
  editor.view.dispatch(editor.state.tr.insertText("你", 2));
  editor.view.dispatch(
    editor.state.tr.addMark(1, 3, italic.create()).setMeta(suggestionAction, true),
  );
  editor.view.dispatch(
    editor.state.tr.step(new AddMarkStep(2, 2, bold.create())).setMeta(suggestionAction, true),
  );
  composing.mockReturnValue(false);
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await vi.waitFor(() => expect(marked(editor, "suggestionInsert")).toBe("你"));
  expect(editor.state.doc.textContent).toBe("o你ld");
  expect(editor.state.doc.nodeAt(1)?.marks.map((mark) => mark.type.name)).toContain("bold");
  expect(editor.state.doc.nodeAt(2)?.marks.map((mark) => mark.type.name)).toEqual([
    "bold",
    "italic",
    "suggestionInsert",
  ]);
});
it("blocks text changes in a textblock whose schema forbids suggestion marks", () => {
  const editor = make();
  const schema = new Schema({
    nodes: editor.schema.spec.nodes.update("paragraph", {
      ...editor.schema.spec.nodes.get("paragraph"),
      marks: "",
    }),
    marks: editor.schema.spec.marks,
  });
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("original")])]),
    plugins: [createSuggestionPlugin()],
  });
  state = state.applyTransaction(
    state.tr.setMeta(suggestionKey, { enabled: true, author: "alice" }),
  ).state;
  const result = state.applyTransaction(state.tr.insertText("new"));
  expect(result.transactions).toEqual([]);
  expect(result.state.doc.textContent).toBe("original");
});

it("does not flush an ended composition while the view is still composing", async () => {
  const editor = make("<p></p>");
  const composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(true);
  editor.view.dispatch(editor.state.tr.insertText("你"));
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(suggestions(editor.state.doc)).toEqual([]);
  composing.mockReturnValue(false);
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await vi.waitFor(() => expect(marked(editor, "suggestionInsert")).toBe("你"));
});

it("tracks deletion across nested textblocks without removing their list structure", () => {
  const editor = make("<ul><li><p>abc</p></li><li><p>def</p></li></ul>");
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4, 11)).deleteSelection(),
  );
  expect(editor.state.doc.textContent).toBe("abcdef");
  expect(editor.state.doc.firstChild?.childCount).toBe(2);
  expect(marked(editor, "suggestionDelete")).toBe("bcd");
});
it("does not turn a cancelled composition that restores its original text into a suggestion", async () => {
  const editor = make("<p>old</p>");
  const composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(true);
  editor.view.dispatch(editor.state.tr.insertText("n", 1, 4));
  editor.view.dispatch(editor.state.tr.insertText("old", 1, 2));
  composing.mockReturnValue(false);
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(editor.state.doc.textContent).toBe("old");
  expect(suggestions(editor.state.doc)).toEqual([]);
});

it("blocks a structural paragraph join that contains no text to suggest", () => {
  const blocked = vi.fn();
  const editor = make();
  editor.view.dom.addEventListener(suggestionUnsupported, blocked);
  const before = editor.getJSON();
  editor.view.dispatch(editor.state.tr.join(5));
  expect(editor.getJSON()).toEqual(before);
  expect(blocked).toHaveBeenCalled();
});

it.each([
  true,
  false,
])("keeps mode changes from triggering a mid-composition rewrite (initial edit %s)", async (initialEdit) => {
  const editor = make("<p>old</p>");
  const composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(true);
  if (initialEdit) editor.view.dispatch(editor.state.tr.insertText("n", 1, 4));
  editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: false, author: "alice" }));
  editor.view.dispatch(editor.state.tr.insertText("你", 1, initialEdit ? 2 : 4));
  expect(editor.state.doc.textContent).toBe("你");
  expect(suggestions(editor.state.doc)).toEqual([]);
  composing.mockReturnValue(false);
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(marked(editor, "suggestionInsert")).toBe("");
  expect(marked(editor, "suggestionDelete")).toBe(initialEdit ? "old" : "");
});
it("leaves native compositions in Editing mode unmarked", async () => {
  const editor = make("<p></p>");
  editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, { enabled: false, author: "alice" }));
  const composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(true);
  editor.view.dispatch(editor.state.tr.insertText("你"));
  composing.mockReturnValue(false);
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(editor.state.doc.textContent).toBe("你");
  expect(suggestions(editor.state.doc)).toEqual([]);
});

it("select-all deletion of an empty document does not accumulate blank paragraphs", () => {
  const editor = make("<p></p>");
  for (let i = 0; i < 3; i++) {
    editor.view.dispatch(
      editor.state.tr.setSelection(new AllSelection(editor.state.doc)).deleteSelection(),
    );
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.textContent).toBe("");
  }
});
it("select-all multiline paste preserves the originals and marks every pasted paragraph", () => {
  const editor = make();
  editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
  editor.view.pasteText("one\ntwo", new Event("paste") as ClipboardEvent);
  expect(marked(editor, "suggestionInsert")).toBe("onetwo");
  expect(marked(editor, "suggestionDelete")).toBe("abcdef");
});
