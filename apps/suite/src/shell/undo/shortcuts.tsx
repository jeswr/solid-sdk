// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { UNDO_SHORTCUTS } from "../lib/shortcut-settings";
import { useShortcut } from "../shortcuts/provider";
import { useUndo } from "./provider";

/** Register inside ShortcutsProvider, alongside the shell's other global commands. */
export function UndoShortcuts() {
  const { undo, redo } = useUndo();
  useShortcut({
    ...UNDO_SHORTCUTS.undo,
    run: () => {
      void undo();
    },
    allowInEditable: false,
  });
  useShortcut({
    ...UNDO_SHORTCUTS.redo,
    run: () => {
      void redo();
    },
    allowInEditable: false,
  });
  return null;
}
