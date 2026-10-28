// AUTHORED-BY Codex
import type { Editor, EditorEvents } from "@tiptap/react";

/** Track a point, including its nearest surviving position after deletion. */
export function insertionAnchor(editor: Editor) {
  let position = editor.state.selection.from;
  const map = ({ transaction, appendedTransactions }: EditorEvents["transaction"]) => {
    for (const applied of [transaction, ...appendedTransactions]) {
      position = applied.mapping.map(position, 1);
    }
  };
  editor.on("transaction", map);
  return {
    get position() {
      return position;
    },
    release: () => {
      editor.off("transaction", map);
    },
  };
}
