// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom

import { EditorState, TextSelection } from "@tiptap/pm/state";
import { Editor, getSchema } from "@tiptap/react";
import { prosemirrorJSONToYDoc, ySyncPluginKey } from "@tiptap/y-tiptap";
import { afterEach, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import {
  captureCommentAnchor,
  quoteRange,
  resolveCommentAnchor,
} from "../src/apps/docs/lib/editor/comment-anchors";
import { commentKey, createCommentPlugin } from "../src/apps/docs/lib/editor/comment-decorations";
import type { DocumentComment } from "../src/apps/docs/lib/model/comments";

const editors: Editor[] = [];
const docs: Doc[] = [];
function setup(text = "Before word after") {
  const doc = prosemirrorJSONToYDoc(getSchema(baseExtensions(fetch)), {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const editor = new Editor({ extensions: editorExtensions(doc, fetch) });
  editors.push(editor);
  docs.push(doc);
  editor.commands.setTextSelection({ from: 8, to: 12 });
  return { doc, editor };
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const doc of docs.splice(0)) doc.destroy();
  vi.restoreAllMocks();
});
it("encodes positions without changing Yjs state and follows local and remote edits before the selection", () => {
  const { doc, editor } = setup();
  const before = Array.from(encodeStateAsUpdate(doc));
  const anchor = captureCommentAnchor(editor.state);
  expect(anchor).toMatchObject({ exact: "word", prefix: "Before ", suffix: " after" });
  expect(Array.from(encodeStateAsUpdate(doc))).toEqual(before);
  expect(resolveCommentAnchor(editor.state, anchor)).toEqual({ from: 8, to: 12 });
  editor.commands.insertContentAt(1, "More ");
  expect(resolveCommentAnchor(editor.state, anchor)).toEqual({ from: 13, to: 17 });
  const peer = new Doc();
  docs.push(peer);
  applyUpdate(peer, encodeStateAsUpdate(doc));
  const other = new Editor({ extensions: editorExtensions(peer, fetch) });
  editors.push(other);
  other.commands.insertContentAt(1, "Remote ");
  applyUpdate(doc, encodeStateAsUpdate(peer));
  const range = resolveCommentAnchor(editor.state, anchor);
  expect(range).toEqual({ from: 20, to: 24 });
  editor.commands.deleteRange(range as { from: number; to: number });
  expect(resolveCommentAnchor(editor.state, anchor)).toBeUndefined();
});
it("falls back for invalid or foreign identities, ranks context, prefers the first tie, and joins formatted text", () => {
  const { editor } = setup("Wrong word tail. Before word after");
  const anchor = {
    ...captureCommentAnchor(editor.state),
    exact: "word",
    prefix: "Before ",
    suffix: " after",
    start: "invalid",
    end: "invalid",
  };
  expect(resolveCommentAnchor(editor.state, anchor)).toEqual({ from: 25, to: 29 });
  expect(quoteRange(editor.state.doc, { ...anchor, prefix: "", suffix: "" })).toEqual({
    from: 7,
    to: 11,
  });
  expect(quoteRange(editor.state.doc, { ...anchor, exact: "" })).toBeUndefined();
  expect(quoteRange(editor.state.doc, { ...anchor, exact: "absent" })).toBeUndefined();
  const schema = editor.schema;
  const state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "wo", marks: [{ type: "bold" }] },
            { type: "text", text: "rd" },
            { type: "hardBreak" },
            { type: "image", attrs: { src: "https://example.org/a.png" } },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    }),
  });
  expect(resolveCommentAnchor(state, anchor)).toEqual({ from: 1, to: 5 });
  expect(quoteRange(state.doc, { ...anchor, exact: "after" })).toEqual({ from: 9, to: 14 });
  expect(() => captureCommentAnchor(state)).toThrow("Select text");
  const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 5)));
  expect(() => captureCommentAnchor(selected)).toThrow("still syncing");
  editor.commands.setTextSelection(1);
  expect(() => captureCommentAnchor(editor.state)).toThrow("Select text");
  editor.commands.setTextSelection({ from: 1, to: 3 });
  const foreign = setup();
  const foreignAnchor = captureCommentAnchor(foreign.editor.state);
  expect(resolveCommentAnchor(editor.state, foreignAnchor)).toBeTruthy();
});
it("caps quote contexts at 32 Unicode characters and treats collapsed positions as deleted text and falls back only when positions no longer resolve", () => {
  const { editor } = setup(`${"x".repeat(40)} word ${"y".repeat(40)}`);
  editor.commands.setTextSelection({ from: 42, to: 46 });
  const anchor = captureCommentAnchor(editor.state);
  expect(Array.from(anchor.prefix)).toHaveLength(32);
  expect(Array.from(anchor.suffix)).toHaveLength(32);
  const sync = ySyncPluginKey.getState(editor.state);
  const collapsed = { ...anchor, end: anchor.start };
  expect(resolveCommentAnchor(editor.state, collapsed)).toBeUndefined();
  expect(resolveCommentAnchor(editor.state, { ...anchor, end: "!" })).toEqual({ from: 42, to: 46 });
  if (!sync) throw new Error("Missing sync");
  const mapping = new Map(sync.binding.mapping);
  sync.binding.mapping.clear();
  expect(resolveCommentAnchor(editor.state, anchor)).toEqual({ from: 42, to: 46 });
  for (const [key, value] of mapping) sync.binding.mapping.set(key, value);
});
it("renders only anchored decorations, activates by click, and never adds marks to document state", () => {
  const { editor, doc } = setup();
  const anchor = captureCommentAnchor(editor.state);
  const comment: DocumentComment = {
    url: "https://pod.example/comment.ttl",
    etag: '"one"',
    text: "Discuss",
    creator: "https://me.example/#me",
    created: "2026-01-01",
    kind: "root",
    target: "https://pod.example/doc.ttl",
    anchor,
    resolved: false,
  };
  const activate = vi.fn();
  const before = Array.from(encodeStateAsUpdate(doc));
  editor.view.dispatch(
    editor.state.tr.setMeta(commentKey, {
      comments: [
        comment,
        { ...comment, url: "missing", anchor: undefined },
        { ...comment, url: "lost", anchor: { ...anchor, start: "!", end: "!", exact: "lost" } },
      ],
      active: comment.url,
      activate,
    }),
  );
  expect(editor.view.dom.querySelector(".docs-comment-anchor-active")?.textContent).toBe("word");
  expect(Array.from(encodeStateAsUpdate(doc))).toEqual(before);
  expect(editor.getHTML()).not.toContain("docs-comment");
  const plugin = createCommentPlugin();
  const click = plugin.props.handleClick as NonNullable<typeof plugin.props.handleClick>;
  const element = editor.view.dom.querySelector(".docs-comment-anchor") as HTMLElement;
  const event = new MouseEvent("click");
  Object.defineProperty(event, "target", { value: element });
  expect(click.call(plugin, editor.view, 8, event)).toBe(true);
  expect(activate).toHaveBeenCalledWith(comment.url);
  const outside = new MouseEvent("click");
  Object.defineProperty(outside, "target", { value: editor.view.dom });
  expect(click.call(plugin, editor.view, 1, outside)).toBe(false);
  editor.view.dispatch(editor.state.tr.setMeta(commentKey, { comments: [comment] }));
  expect(editor.view.dom.querySelector(".docs-comment-anchor-active")).toBeNull();
  expect(click.call(plugin, editor.view, 8, event)).toBe(true);
  const state = EditorState.create({
    schema: editor.schema,
    doc: editor.state.doc,
    plugins: [plugin],
  });
  expect(commentKey.getState(state)?.comments).toEqual([]);
});

// AUTHORED-BY Claude Opus 5.5
it("never moves a comment to another occurrence when its own text is deleted", () => {
  const { editor } = setup("Wrong word tail. Before word after");
  const second = editor.state.doc.textContent.lastIndexOf("word") + 1;
  editor.commands.setTextSelection({ from: second, to: second + 4 });
  const anchor = captureCommentAnchor(editor.state);
  expect(resolveCommentAnchor(editor.state, anchor)).toEqual({ from: second, to: second + 4 });
  editor.commands.deleteRange({ from: second, to: second + 4 });
  expect(resolveCommentAnchor(editor.state, anchor)).toBeUndefined();
  // Without usable Yjs positions the quote still finds the best-matching context.
  expect(quoteRange(editor.state.doc, { ...anchor, prefix: "Wrong ", suffix: " tail" })).toEqual({
    from: 7,
    to: 11,
  });
});
