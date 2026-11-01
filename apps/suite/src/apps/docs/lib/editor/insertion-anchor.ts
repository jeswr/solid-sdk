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
    insert(run: () => void) {
      // The saved target owns the insertion, while the live caret owns later
      // typing. Map that caret through every insertion/appended transaction.
      const current = insertionAnchor(editor);
      try {
        editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)));
        run();
      } finally {
        editor.view.dispatch(editor.state.tr.setSelection(current.selection));
        current.release();
      }
    },
    release: () => {
      editor.off("transaction", map);
    },
  };
}
