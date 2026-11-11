// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  type JournalEntry,
  MOODS,
  validateEntry,
  validatePhoto,
  wordCount,
} from "@jeswr/solid-journal";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  SafeMarkdown,
  Textarea,
} from "@jeswr/suite-ui";
import { useState } from "react";
import { useJournal } from "../state/journal-context";

function dateInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
export function Editor({
  entry,
  open,
  close,
  returnFocus,
}: {
  entry?: JournalEntry;
  open: boolean;
  close: (saved?: boolean) => void;
  returnFocus: () => void;
}) {
  const { controller } = useJournal();
  const [title, setTitle] = useState(entry?.title ?? "");
  const [text, setText] = useState(entry?.text ?? "");
  const [date, setDate] = useState(dateInput(entry?.created ?? new Date()));
  const [mood, setMood] = useState(entry?.mood);
  const [tags, setTags] = useState(entry?.tags?.join(", ") ?? "");
  const [location, setLocation] = useState(entry?.location ?? "");
  const [weather, setWeather] = useState(entry?.weather ?? "");
  const [photos, setPhotos] = useState<File[]>([]);
  const [images, setImages] = useState(entry?.images ?? []);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const save = () => {
    try {
      const data = validateEntry({
        title,
        text,
        created: new Date(date),
        modified: new Date(),
        ...(mood ? { mood } : {}),
        tags: tags.split(","),
        location,
        weather,
        images,
      });
      controller.save(data, entry, photos);
      close(true);
    } catch {
      setError("Write some words and choose a valid date before saving.");
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        className="jn-editor"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{entry ? "Edit entry" : "New entry"}</DialogTitle>
          <DialogDescription>
            Only you can see this. Write freely — Markdown is welcome.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="jn-form"
        >
          <div className="jn-field">
            <Label htmlFor="journal-title">Title (optional)</Label>
            <Input
              id="journal-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Give today a name"
            />
          </div>
          <div className="jn-field">
            <Label htmlFor="journal-date">Date and time</Label>
            <Input
              id="journal-date"
              type="datetime-local"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <fieldset>
            <legend>How are you feeling?</legend>
            <div className="jn-moods">
              {MOODS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={mood === value ? "default" : "outline"}
                  aria-pressed={mood === value}
                  onClick={() => setMood(mood === value ? undefined : value)}
                >
                  {value[0]?.toUpperCase()}
                  {value.slice(1)}
                </Button>
              ))}
            </div>
          </fieldset>
          <div className="jn-editor-tabs">
            <Label htmlFor="journal-text">Your words</Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={preview}
              onClick={() => setPreview(!preview)}
            >
              {preview ? "Write" : "Preview"}
            </Button>
          </div>
          {preview ? (
            <section className="jn-preview" aria-label="Markdown preview">
              <SafeMarkdown className="jn-prose">
                {text || "Your preview will appear here."}
              </SafeMarkdown>
            </section>
          ) : (
            <Textarea
              id="journal-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="What would you like to remember?"
              rows={10}
              aria-describedby="journal-word-count"
            />
          )}
          <p id="journal-word-count" className="jn-muted">
            {wordCount(text)} words
          </p>
          <div className="jn-field">
            <Label htmlFor="journal-tags">Tags (separate with commas)</Label>
            <Input
              id="journal-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="gratitude, a small win"
            />
          </div>
          <div className="jn-pair">
            <div className="jn-field">
              <Label htmlFor="journal-location">Location (optional)</Label>
              <Input
                id="journal-location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </div>
            <div className="jn-field">
              <Label htmlFor="journal-weather">Weather (optional)</Label>
              <Input
                id="journal-weather"
                value={weather}
                onChange={(event) => setWeather(event.target.value)}
              />
            </div>
          </div>
          <div className="jn-field">
            <Label htmlFor="journal-photos">Attach photos</Label>
            <Input
              id="journal-photos"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                try {
                  for (const file of files) validatePhoto(file);
                  setPhotos((current) => [
                    ...new Map(
                      [...current, ...files].map((file) => [
                        `${file.name}-${file.lastModified}-${file.size}`,
                        file,
                      ]),
                    ).values(),
                  ]);
                  setError("");
                } catch {
                  setError("Choose JPG, PNG, WebP or GIF photos up to 10 MB each.");
                }
                event.target.value = "";
              }}
            />
            <p className="jn-muted">Up to 10 MB each. Photos upload when you save.</p>
          </div>
          {images.map((url, index) => (
            <div className="jn-attachment" key={url}>
              <span>Attached photo {index + 1}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setImages((current) => current.filter((image) => image !== url))}
              >
                Remove photo {index + 1}
              </Button>
            </div>
          ))}
          {photos.map((file, index) => (
            <div className="jn-attachment" key={`${file.name}-${file.lastModified}-${file.size}`}>
              <span>{file.name}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setPhotos((current) => current.filter((_, position) => position !== index))
                }
              >
                Remove {file.name}
              </Button>
            </div>
          ))}
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => close()}>
              Close
            </Button>
            <Button type="submit">Save entry</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
