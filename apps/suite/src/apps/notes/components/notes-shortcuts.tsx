// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useState } from "react";
import { ShortcutHelpSheet } from "@/shell/shortcuts/help-sheet";
import { useShortcut } from "@/shell/shortcuts/provider";
import type { StoredNote } from "../lib/model/store";
import { useNotesContext } from "../state/notes-context";
import type { useNotesSelection } from "../state/use-notes-selection";

function NotesKey({
  keys,
  label,
  run,
  when,
}: {
  keys: string;
  label: string;
  run: () => void;
  when: () => boolean;
}) {
  useShortcut({ id: `notes.${keys}`, keys, label, run, when, group: "Notes" });
  return null;
}

export function NotesShortcuts({
  notes,
  state,
  focused,
  focus,
}: {
  notes: readonly StoredNote[];
  state: ReturnType<typeof useNotesSelection>;
  focused: string | undefined;
  focus: (url: string) => void;
}) {
  const [help, setHelp] = useState(false);
  const context = useNotesContext();
  // Single-key actions follow real keyboard focus at key time, never a stale remembered card.
  const activeNote = () => {
    const element = document.activeElement;
    const url =
      element instanceof Element
        ? element.closest<HTMLElement>(".notes-card")?.dataset.noteUrl
        : undefined;
    return url === undefined ? undefined : notes.find((note) => note.url === url);
  };
  const targets = () => {
    if (state.selected.length) return state.selected;
    const current = activeNote();
    return current ? [current] : [];
  };
  const act = (action: (targets: readonly StoredNote[]) => Parameters<typeof state.run>[0]) => {
    const list = targets();
    if (list.length) void state.run(action(list), list);
  };
  const available = () =>
    !document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]');
  const moveFocus = (direction: number) => {
    const index = notes.findIndex((note) => note.url === focused);
    const next =
      notes[
        index < 0
          ? direction > 0
            ? 0
            : notes.length - 1
          : Math.max(0, Math.min(notes.length - 1, index + direction))
      ];
    if (next) focus(next.url);
  };
  const open = () => {
    const element = document.activeElement;
    const current = activeNote();
    if (current && element instanceof HTMLElement && element.closest(".notes-card-body"))
      context.openNote(current, element);
  };
  const bindings = [
    { keys: "j", label: "Next note", run: () => moveFocus(1) },
    { keys: "k", label: "Previous note", run: () => moveFocus(-1) },
    { keys: "o", label: "Open note", run: open },
    {
      keys: "Enter",
      label: "Open focused note",
      run: open,
      when: () => available() && !!document.activeElement?.closest(".notes-card-body"),
    },
    {
      keys: "e",
      label: "Archive or unarchive notes",
      run: () =>
        act((list) => ({
          type: list.every((note) => note.location === "archived") ? "unarchive" : "archive",
        })),
    },
    {
      keys: "#",
      label: "Move notes to trash",
      run: () => act(() => ({ type: "trash" })),
    },
    {
      keys: "f",
      label: "Pin or unpin notes",
      run: () =>
        act((list) => ({
          type: list.every((note) => context.prefs.pinned.includes(note.url)) ? "unpin" : "pin",
        })),
    },
    {
      keys: "x",
      label: "Select note",
      run: () => {
        const current = activeNote();
        if (current && !state.busy) state.selection.toggle(current.url);
      },
    },
    {
      keys: "Escape",
      label: "Clear selection",
      run: () => {
        if (!state.busy) state.selection.clear();
      },
    },
    {
      keys: "c",
      label: "New note",
      run: () => {
        const capture = document.querySelector(".notes-capture");
        if (capture)
          capture
            .querySelector<HTMLElement>(
              '[aria-label="Take a note"], [aria-label="Note title"], [aria-label="List item 1"], [aria-label="Note text"]',
            )
            ?.focus();
        // Views without a capture bar (Archive, Trash, Search, Reminders) never write a note here.
      },
    },
    {
      keys: "/",
      label: "Search notes",
      run: () => document.querySelector<HTMLElement>("[data-global-search]")?.focus(),
    },
    { keys: "?", label: "Keyboard shortcuts", run: () => setHelp(true) },
  ];
  return (
    <>
      {bindings.map((binding) => (
        <NotesKey key={binding.keys} {...binding} when={binding.when ?? available} />
      ))}
      <ShortcutHelpSheet open={help} onOpenChange={setHelp} />
    </>
  );
}
