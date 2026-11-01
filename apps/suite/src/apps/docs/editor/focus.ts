// AUTHORED-BY Codex
import type { Editor } from "@tiptap/react";

/** ProseMirror's focus command restores selection but skips DOM focus in view mode. */
export function focusDocument(editor: Editor, options?: { scrollIntoView: boolean }) {
  if (editor.isDestroyed) return;
  editor.commands.focus(undefined, options);
  if (editor.isEditable === false)
    // Match TipTap's deferred focus so a closing dialog has released its focus trap.
    requestAnimationFrame(() => {
      if (!editor.isDestroyed)
        editor.view.dom.focus({ preventScroll: options?.scrollIntoView === false });
    });
}
