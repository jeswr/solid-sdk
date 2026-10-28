// AUTHORED-BY Codex
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { expect, it } from "vitest";
import { createFindPlugin, findKey } from "../src/apps/docs/editor/find-plugin";

it("decorates fresh ProseMirror matches, tracks the active result and handles replacement", () => {
  const schema = new Schema({
    nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} },
  });
  const plugin = createFindPlugin();
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("CAT cat")])]),
    plugins: [plugin],
  });
  const decorations = () => {
    const source = plugin.props.decorations?.call(plugin, state);
    if (!(source instanceof DecorationSet)) throw new Error("Expected a decoration set");
    return source.find();
  };
  expect(decorations()).toEqual([]);
  state = state.apply(state.tr.setMeta(findKey, { query: "cat", caseSensitive: false, active: 1 }));
  expect(decorations().map(({ from, to }) => [from, to])).toEqual([
    [1, 4],
    [5, 8],
  ]);
  state = state.apply(state.tr.insertText("dog", 5, 8));
  expect(decorations().map(({ from, to }) => [from, to])).toEqual([[1, 4]]);
  state = state.apply(state.tr.setMeta(findKey, { query: "cat", caseSensitive: true, active: 0 }));
  expect(decorations()).toEqual([]);
  state = state.apply(
    state.tr.setMeta(findKey, { query: "x".repeat(513), caseSensitive: false, active: 0 }),
  );
  expect(decorations()).toEqual([]);
  expect(findKey.getState(state)?.query).toHaveLength(513);
});
