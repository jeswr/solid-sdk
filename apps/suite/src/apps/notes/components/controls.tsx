// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  TagInput,
} from "@jeswr/suite-ui";
import { Palette, Tag } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { NoteColour } from "../lib/model/prefs";
import { useNotesContext } from "../state/notes-context";

export function ColourPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: NoteColour;
  onChange: (value: NoteColour) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Note colour" variant="ghost" disabled={disabled}>
          <Palette aria-hidden="true" size={18} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="notes-popover" aria-label="Note colour">
        <fieldset className="notes-swatches">
          <legend>Note colour</legend>
          {NoteColour.options.map((colour) => (
            <label
              key={colour}
              className="notes-swatch"
              data-note-colour={colour}
              title={colour === "default" ? "Default" : colour[0]?.toUpperCase() + colour.slice(1)}
            >
              <input
                disabled={disabled}
                type="radio"
                name={id}
                value={colour}
                aria-label={
                  colour === "default" ? "Default" : colour[0]?.toUpperCase() + colour.slice(1)
                }
                checked={value === colour}
                onChange={() => onChange(colour)}
              />
              <span aria-hidden="true">{value === colour ? "✓" : ""}</span>
            </label>
          ))}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
export function LabelChips({
  labels,
  links = true,
}: {
  labels: readonly string[];
  links?: boolean;
}) {
  return (
    <div className="notes-labels">
      {labels.map((label) =>
        links ? (
          <Link
            className="notes-chip"
            key={label}
            href={`/notes/label/${encodeURIComponent(label)}`}
          >
            <Tag size={12} aria-hidden="true" />
            {label}
          </Link>
        ) : (
          <span className="notes-chip" key={label}>
            <Tag size={12} aria-hidden="true" />
            {label}
          </span>
        ),
      )}
    </div>
  );
}
export function LabelPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const { labels } = useNotesContext();
  const [name, setName] = useState("");
  const all = [...new Set([...labels, ...value])];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Edit note labels" variant="ghost" disabled={disabled}>
          <Tag size={18} aria-hidden="true" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="notes-popover" aria-label="Note labels">
        <TagInput
          disabled={disabled}
          label="Note labels"
          value={value}
          options={all.map((label) => ({ id: label, label }))}
          onChange={onChange}
        />
        <form
          className="notes-new-label"
          onSubmit={(event) => {
            event.preventDefault();
            const label = name.trim();
            if (!disabled && label && !value.includes(label)) onChange([...value, label]);
            setName("");
          }}
        >
          <Input
            disabled={disabled}
            aria-label="New label"
            placeholder="Create a label"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={disabled || !name.trim()}>
            Add label
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
export function ConfirmDialog({
  title,
  description,
  confirm,
  close,
}: {
  title: string;
  description: string;
  confirm: () => Promise<unknown>;
  close: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        className="notes-confirm"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById("notes-cancel-delete")?.focus();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {failed && <p role="alert">Couldn't complete this action. Please try again.</p>}
        <div className="notes-confirm-actions">
          <Button id="notes-cancel-delete" variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setFailed(false);
              void confirm()
                .then(close, () => setFailed(true))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Working…" : title}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
