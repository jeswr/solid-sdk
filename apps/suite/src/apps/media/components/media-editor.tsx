// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  type MediaEntry,
  type MediaKind,
  type MediaRecord,
  type MediaStatus,
  STATUSES,
  validateEntry,
} from "@jeswr/solid-media-log";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@jeswr/suite-ui";
import { useId, useState } from "react";
import { KIND_LABELS, STATUS_LABELS } from "../lib/view";

function Choice({
  id,
  label,
  value,
  choices,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  choices: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="media-field">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(choices).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
export function MediaEditor({
  record,
  offline,
  onClose,
  onSave,
}: {
  record?: MediaRecord | undefined;
  offline: boolean;
  onClose: () => void;
  onSave: (entry: MediaEntry) => void;
}) {
  const id = useId();
  const item = record?.data;
  const [kind, setKind] = useState<MediaKind>(item?.kind ?? "film");
  const [status, setStatus] = useState<MediaStatus>(item?.status ?? "want");
  const [error, setError] = useState("");
  const fields = [
    {
      name: "title",
      label: "Title",
      type: "text",
      required: true,
      value: item?.title,
      maxLength: 500,
    },
    {
      name: "year",
      label: "Release or publication year",
      type: "number",
      value: item?.year,
      min: 1000,
      max: 9999,
      step: 1,
    },
    {
      name: "creator",
      label: "Creator or author",
      type: "text",
      value: item?.creator,
      maxLength: 500,
    },
    { name: "cover", label: "Cover image URL", type: "url", value: item?.cover },
    { name: "started", label: "Started on", type: "date", value: item?.started },
    {
      name: "finished",
      label: "Finished on",
      type: "date",
      value: item?.finished,
      disabled: status !== "finished",
    },
    {
      name: "rating",
      label: "Your rating (0.5–5)",
      type: "number",
      value: item?.rating,
      min: 0.5,
      max: 5,
      step: 0.5,
    },
    {
      name: "repeatCount",
      label: "Rewatches or rereads",
      type: "number",
      value: item?.repeatCount,
      min: 0,
      step: 1,
    },
    {
      name: "progress",
      label: kind === "book" ? "Current page" : "Current episode or progress",
      type: "number",
      value: item?.progress,
      min: 0,
      step: 1,
    },
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="media-dialog">
        <DialogHeader>
          <DialogTitle>{item ? "Edit media item" : "Add an item"}</DialogTitle>
          <DialogDescription>
            {record && !record.url
              ? "Your changes are saved as a media log entry. The original import stays available in your pod."
              : "A film, a new world, a book you couldn't put down. Keep it on your shelf."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="media-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const text = (key: string) => String(form.get(key) ?? "").trim() || undefined;
            const numeric = (key: string) =>
              text(key) === undefined ? undefined : Number(text(key));
            try {
              const entry: MediaEntry = {
                title: text("title") ?? "",
                kind,
                status,
                creator: text("creator"),
                year: numeric("year"),
                cover: text("cover"),
                started: text("started"),
                finished: status === "finished" ? text("finished") : undefined,
                rating: numeric("rating"),
                repeatCount: numeric("repeatCount"),
                progress: numeric("progress"),
                progressUnit:
                  kind === "book"
                    ? "page"
                    : kind === "tv" || kind === "episode"
                      ? "episode"
                      : undefined,
                review: text("review"),
                source: item?.source ?? "Manual",
                origin: item?.origin,
              };
              onSave(validateEntry(entry));
            } catch (error) {
              setError(
                error instanceof TypeError
                  ? error.message
                  : "Couldn't prepare this item. Please try again.",
              );
            }
          }}
        >
          <div className="media-form-grid">
            <Choice
              id={`${id}-kind`}
              label="Kind"
              value={kind}
              choices={KIND_LABELS}
              onChange={(value) => setKind(value as MediaKind)}
            />
            <Choice
              id={`${id}-shelf`}
              label="Shelf"
              value={status}
              choices={Object.fromEntries(STATUSES.map((value) => [value, STATUS_LABELS[value]]))}
              onChange={(value) => setStatus(value as MediaStatus)}
            />
            {fields.map(({ name, label, value, ...props }) => (
              <div
                key={name}
                className={`media-field ${name === "title" || name === "cover" ? "media-field-wide" : ""}`}
              >
                <Label htmlFor={`${id}-${name}`}>{label}</Label>
                <Input {...props} id={`${id}-${name}`} name={name} defaultValue={value ?? ""} />
              </div>
            ))}
          </div>
          <div className="media-field">
            <Label htmlFor={`${id}-review`}>Your review</Label>
            <Textarea
              id={`${id}-review`}
              name="review"
              rows={4}
              maxLength={20000}
              defaultValue={item?.review ?? ""}
              placeholder="What stayed with you?"
            />
          </div>
          {error && (
            <p role="alert" className="media-form-error">
              {error}
            </p>
          )}
          {offline && (
            <p role="status">You're offline. Your draft is kept open; reconnect to save it.</p>
          )}
          <div className="media-dialog-actions">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={offline}>
              Save item
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
