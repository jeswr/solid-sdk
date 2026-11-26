// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { UNDO_SHORTCUTS } from "../lib/shortcut-settings";
import { useShortcut } from "../shortcuts/provider";
import { type UndoActions, useOptionalUndo } from "./provider";

/** Surfaces with their own undo (whiteboard, spreadsheet grid) opt out with this ancestor attribute. */
export const NATIVE_UNDO_SELECTOR = '[data-undo-scope="native"]';
const ownsUndo = () => !!document.activeElement?.closest(NATIVE_UNDO_SELECTOR);

/** Register inside ShortcutsProvider, alongside the shell's other global commands. */
export function UndoShortcuts() {
  const actions = useOptionalUndo();
  return actions ? <RegisteredUndoShortcuts actions={actions} /> : null;
}
function RegisteredUndoShortcuts({ actions }: { actions: UndoActions }) {
  const { undo, redo, canUndo, canRedo } = actions;
  useShortcut({
    ...UNDO_SHORTCUTS.undo,
    run: () => {
      void undo();
    },
    // An empty history, or an app surface with its own undo, leaves the key alone.
    when: () => canUndo() && !ownsUndo(),
    allowInEditable: false,
  });
  useShortcut({
    ...UNDO_SHORTCUTS.redo,
    run: () => {
      void redo();
    },
    when: () => canRedo() && !ownsUndo(),
    allowInEditable: false,
  });
  return null;
}
