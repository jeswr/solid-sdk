// AUTHORED-BY Codex
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import { findText } from "../lib/find";
export const findKey = new PluginKey<{ query: string; caseSensitive: boolean; active: number }>(
  "docsFind",
);
export function createFindPlugin() {
  return new Plugin({
    key: findKey,
    state: {
      init: () => ({ query: "", caseSensitive: false, active: 0 }),
      apply: (tr, previous) => tr.getMeta(findKey) ?? previous,
    },
    props: {
      decorations(state) {
        const search = findKey.getState(state);
        if (!search?.query) return DecorationSet.empty;
        try {
          return DecorationSet.create(
            state.doc,
            findText(state.doc.toJSON(), search.query, { caseSensitive: search.caseSensitive }).map(
              (match, index) =>
                Decoration.inline(match.from, match.to, {
                  class: index === search.active ? "docs-find-active" : "docs-find-match",
                }),
            ),
          );
        } catch {
          return DecorationSet.empty;
        }
      },
    },
  });
}
export const FindDecorations = Extension.create({
  name: "docsFind",
  addProseMirrorPlugins: () => [createFindPlugin()],
});
