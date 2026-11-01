// AUTHORED-BY Codex
import type { Editor, EditorEvents } from "@tiptap/react";

/** Retain the whole selection, mapping edits and falling back after deletion. */
export function insertionAnchor(editor: Editor) {
  let bookmark = editor.state.selection.getBookmark();
  const map = ({ transaction, appendedTransactions }: EditorEvents["transaction"]) => {
    for (const applied of [transaction, ...appendedTransactions]) {
      bookmark = bookmark.map(applied.mapping);
    }
  };
  editor.on("transaction", map);
  return {
    get selection() {
      return bookmark.resolve(editor.state.doc);
    },
    release: () => {
      editor.off("transaction", map);
    },
  };
}
