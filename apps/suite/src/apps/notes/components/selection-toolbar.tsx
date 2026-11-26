// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Toolbar,
  type ToolbarAction,
} from "@jeswr/suite-ui";
import { useState } from "react";
import { bulkActionLabels, bulkNeedsConnection, notesBulkActions } from "../lib/bulk";
import { useNotesContext } from "../state/notes-context";
import type { useNotesSelection } from "../state/use-notes-selection";
import { ColourPicker, ConfirmDialog } from "./controls";

export function NotesSelectionToolbar({ state }: { state: ReturnType<typeof useNotesSelection> }) {
  const { selected, selection, busy, run, online } = state;
  const { prefs } = useNotesContext();
  const colours = selected.map((note) => prefs.colours[note.url] ?? "default");
  const commonColour = colours.every((colour) => colour === colours[0]) ? colours[0] : undefined;
  const [picker, setPicker] = useState<"colour" | "labels">();
  const [label, setLabel] = useState("");
  const [deleting, setDeleting] = useState(false);
  const actions: ToolbarAction[] = [
    { id: "clear", label: "Clear selection", disabled: busy, onSelect: selection.clear },
    ...notesBulkActions(selected)
      .filter((type) => type !== "removeLabel")
      .map((type) => ({
        id: type,
        label: type === "addLabel" ? "Labels" : bulkActionLabels[type],
        disabled: busy || (!online && bulkNeedsConnection(type)),
        onSelect: () => {
          if (type === "colour") setPicker("colour");
          else if (type === "addLabel") setPicker("labels");
          else if (type === "deleteForever") setDeleting(true);
          else void run({ type });
        },
      })),
  ];
  return (
    <div className="notes-selection-heading">
      <h1>{selected.length} selected</h1>
      <Toolbar label="Selected notes" actions={actions} />
      {!online && (
        <p role="status">
          You're offline. Archive, trash, labels, restore and permanent deletion need a connection
          and cannot be queued.
        </p>
      )}
      {!notesBulkActions(selected).length && (
        <p role="status">Read-only or pending notes cannot be changed together.</p>
      )}
      {picker && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setPicker(undefined);
          }}
        >
          <DialogContent className="notes-bulk-picker">
            <DialogTitle>
              {picker === "colour" ? "Colour selected notes" : "Label selected notes"}
            </DialogTitle>
            <DialogDescription>Apply to {selected.length} selected notes.</DialogDescription>
            {picker === "colour" ? (
              <ColourPicker
                value={commonColour}
                disabled={busy}
                onChange={(value) => {
                  setPicker(undefined);
                  void run({ type: "colour", value });
                }}
              />
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (label.trim() && online) {
                    setPicker(undefined);
                    void run({ type: "addLabel", label: label.trim() });
                  }
                }}
              >
                <Input
                  aria-label="Label name"
                  list="notes-bulk-labels"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
                <datalist id="notes-bulk-labels">
                  {[...new Set(selected.flatMap((note) => note.labels))].map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <Button type="submit" disabled={busy || !online || !label.trim()}>
                  Add label
                </Button>
                <Button
                  type="button"
                  disabled={busy || !online || !label.trim()}
                  onClick={() => {
                    setPicker(undefined);
                    void run({ type: "removeLabel", label: label.trim() });
                  }}
                >
                  Remove label
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete forever"
          description={`Permanently delete ${selected.length} selected notes? This cannot be undone.`}
          close={() => setDeleting(false)}
          confirm={() => run({ type: "deleteForever" })}
        />
      )}
    </div>
  );
}
