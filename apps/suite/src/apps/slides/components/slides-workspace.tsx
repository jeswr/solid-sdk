// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
"use client";
import { safeHttpIri } from "@jeswr/rdf-serialize";
import {
  type Deck,
  deckFromMarkdown,
  deckOutline,
  deckToMarkdown,
  deleteSlide,
  duplicateSlide,
  insertSlide,
  LAYOUTS,
  newDeck,
  newSlide,
  type Slide,
  THEMES,
} from "@jeswr/solid-slides";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  IconButton,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@jeswr/suite-ui";
import {
  ArrowLeft,
  Copy,
  Download,
  ImagePlus,
  Play,
  Plus,
  Presentation,
  Printer,
  Trash2,
} from "lucide-react";
import { useCallback, useId, useState } from "react";
import { AppFrame, AppHeading } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { useSlides } from "../state/slides-context";
import { Presenter } from "./presenter";
import { SlideCanvas } from "./slide-canvas";
import { SlideSorter } from "./slide-sorter";

const LAYOUT_LABELS: Record<Slide["layout"], string> = {
  title: "Title",
  "title-and-body": "Title and body",
  "two-column": "Two columns",
  section: "Section",
  image: "Image",
  blank: "Blank",
};
const THEME_LABELS: Record<Deck["theme"], string> = {
  light: "Light",
  dark: "Dark",
  contrast: "High contrast",
  warm: "Warm",
};
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="sld-choice">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger id={id} aria-label={label} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function downloadMarkdown(deck: Deck) {
  try {
    const url = URL.createObjectURL(
      new Blob([deckToMarkdown(deck)], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${deck.name.replace(/[^a-zA-Z0-9 -]/g, "_") || "Presentation"}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    toast.error("Add a slide before exporting Markdown.");
  }
}
function ImageInsert({ slide, update }: { slide: Slide; update: (patch: Partial<Slide>) => void }) {
  const { repository } = useSlides();
  const [url, setUrl] = useState(slide.image ?? "");
  const [uploading, setUploading] = useState(false);
  return (
    <div className="sld-image-controls">
      <Label htmlFor="sld-image-url">Drive or pod image URL</Label>
      <div className="sld-toolbar">
        <Input
          id="sld-image-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://your-pod.example/image.png"
        />
        <Button
          variant="outline"
          onClick={() => {
            const safe = safeHttpIri(url);
            if (!safe) {
              toast.error("Enter a full http or https image URL.");
              return;
            }
            update({ image: safe, layout: "image" });
          }}
        >
          Insert image
        </Button>
      </div>
      <Label htmlFor="sld-image-alt">Image description</Label>
      <Input
        id="sld-image-alt"
        value={slide.imageAlt ?? ""}
        onChange={(event) => update({ imageAlt: event.target.value })}
      />
      <Label htmlFor="sld-image-file">Upload image to this presentation's folder</Label>
      <Input
        id="sld-image-file"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setUploading(true);
          void repository
            .uploadImage(file, file.name)
            .then(
              (image) => {
                setUrl(image);
                update({ image, layout: "image" });
              },
              () =>
                toast.error(
                  "Couldn't upload the image. Choose a PNG, JPEG, WebP or GIF smaller than 10 MB and try again.",
                ),
            )
            .finally(() => setUploading(false));
          event.target.value = "";
        }}
      />
      {uploading && <p role="status">Uploading image… You can keep editing.</p>}
      {slide.image && (
        <Button
          variant="ghost"
          onClick={() => {
            setUrl("");
            update({ image: "" });
          }}
        >
          Remove image
        </Button>
      )}
    </div>
  );
}
function Editor({ url, onBack }: { url: string; onBack: () => void }) {
  const { decks, store } = useSlides();
  const item = decks.find((entry) => entry.url === store.resolveUrl(url));
  const [selected, setSelected] = useState<string>();
  const [images, setImages] = useState(false);
  const [presenting, setPresenting] = useState<string>();
  const stop = useCallback(() => {
    setPresenting(undefined);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);
  if (!item)
    return (
      <EmptyState
        title="Presentation removed"
        body="Return to your presentations to choose another."
        primaryAction={<Button onClick={onBack}>All presentations</Button>}
      />
    );
  const { deck } = item;
  const slide = deck.slides.find((entry) => entry.id === selected) ?? deck.slides[0];
  const edit = (patch: Partial<Deck>) => store.edit(item.url, { ...deck, ...patch });
  const update = (patch: Partial<Slide>) =>
    edit({
      slides: deck.slides.map((entry) => (entry.id === slide?.id ? { ...entry, ...patch } : entry)),
    });
  const index = deck.slides.findIndex((entry) => entry.id === slide?.id);
  const addSlide = () => {
    const added = newSlide();
    edit({ slides: insertSlide(deck.slides, index + 1, added) });
    setSelected(added.id);
  };
  return (
    <>
      <div className="sld-editor-header">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} />
          All presentations
        </Button>
        <Label className="sld-visually-hidden" htmlFor="sld-deck-name">
          Presentation name
        </Label>
        <Input
          id="sld-deck-name"
          value={deck.name}
          onChange={(event) => edit({ name: event.target.value })}
        />
        <div className="sld-toolbar">
          <Button
            onClick={() => {
              setPresenting(crypto.randomUUID());
              void document.documentElement
                .requestFullscreen?.()
                .catch(() => toast.error("Full screen is unavailable in this browser."));
            }}
          >
            <Play size={16} />
            Present
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (typeof BroadcastChannel === "undefined") {
                toast.error("Presenter view isn't supported by this browser.");
                return;
              }
              const id = crypto.randomUUID();
              const destination = new URL(location.href);
              destination.search = "";
              destination.searchParams.set("presenter", id);
              const opened = window.open(destination.href, "_blank", "popup,width=1100,height=780");
              if (!opened) {
                toast.error("Allow pop-ups to open presenter view.");
                return;
              }
              opened.opener = null;
              setPresenting(id);
            }}
          >
            Presenter view
          </Button>
          <IconButton label="Export Markdown" onClick={() => downloadMarkdown(deck)}>
            <Download size={17} />
          </IconButton>
          <IconButton label="Print or export PDF" onClick={() => window.print()}>
            <Printer size={17} />
          </IconButton>
        </div>
      </div>
      <div className="sld-editor-toolbar">
        <Button variant="outline" onClick={addSlide}>
          <Plus size={16} />
          Add slide
        </Button>
        <IconButton
          label="Duplicate selected slide"
          disabled={!slide}
          onClick={() => {
            const id = crypto.randomUUID();
            edit({ slides: duplicateSlide(deck.slides, index, id) });
            setSelected(id);
          }}
        >
          <Copy size={16} />
        </IconButton>
        <IconButton
          label="Delete selected slide"
          disabled={!slide}
          onClick={() => {
            edit({ slides: deleteSlide(deck.slides, index) });
            setSelected(deck.slides[index - 1]?.id);
          }}
        >
          <Trash2 size={16} />
        </IconButton>
        <Choice
          label="Theme"
          value={deck.theme}
          options={THEMES.map((theme) => ({ value: theme, label: THEME_LABELS[theme] }))}
          onChange={(theme) => edit({ theme })}
        />
        <Choice
          label="Aspect ratio"
          value={deck.aspectRatio}
          options={[
            { value: "16:9", label: "16:9" },
            { value: "4:3", label: "4:3" },
          ]}
          onChange={(aspectRatio) => edit({ aspectRatio })}
        />
      </div>
      <div className="sld-editor-grid">
        <aside className="sld-slide-rail" aria-label="Slides">
          <SlideSorter
            deck={deck}
            selected={slide?.id}
            onSelect={setSelected}
            onChange={(slides) => edit({ slides })}
          />
        </aside>
        <div className="sld-edit-area">
          {slide ? (
            <>
              <figure className="sld-preview" aria-label="Slide preview">
                <SlideCanvas slide={slide} deck={deck} />
              </figure>
              <div className="sld-fields">
                <div className="sld-toolbar">
                  <Choice
                    label="Layout"
                    value={slide.layout}
                    options={LAYOUTS.map((layout) => ({
                      value: layout,
                      label: LAYOUT_LABELS[layout],
                    }))}
                    onChange={(layout) => update({ layout })}
                  />
                  <div className="sld-checkbox">
                    <Checkbox
                      id="sld-slide-hidden"
                      checked={slide.hidden ?? false}
                      onCheckedChange={(checked) => update({ hidden: checked === true })}
                    />
                    <Label htmlFor="sld-slide-hidden">Skip when presenting</Label>
                  </div>
                  <Button variant="ghost" onClick={() => setImages(!images)} aria-expanded={images}>
                    <ImagePlus size={16} />
                    Image
                  </Button>
                </div>
                {images && <ImageInsert key={slide.id} slide={slide} update={update} />}
                <Label htmlFor="sld-slide-title">Slide title</Label>
                <Input
                  id="sld-slide-title"
                  value={slide.title ?? ""}
                  onChange={(event) => update({ title: event.target.value })}
                />
                <Label htmlFor="sld-slide-body">Slide body · Markdown</Label>
                <Textarea
                  id="sld-slide-body"
                  rows={5}
                  value={slide.body ?? ""}
                  onChange={(event) => update({ body: event.target.value })}
                />
                {slide.layout === "two-column" && (
                  <>
                    <Label htmlFor="sld-second-body">Second column · Markdown</Label>
                    <Textarea
                      id="sld-second-body"
                      rows={4}
                      value={slide.secondBody ?? ""}
                      onChange={(event) => update({ secondBody: event.target.value })}
                    />
                  </>
                )}
                <Label htmlFor="sld-speaker-notes">Speaker notes</Label>
                <Textarea
                  id="sld-speaker-notes"
                  rows={3}
                  value={slide.notes ?? ""}
                  onChange={(event) => update({ notes: event.target.value })}
                />
                <p className="sld-muted">Notes appear only in the editor and presenter view.</p>
              </div>
            </>
          ) : (
            <EmptyState
              title="Your first slide"
              body="Add a slide to start telling your story."
              primaryAction={<Button onClick={addSlide}>Add slide</Button>}
            />
          )}
        </div>
      </div>
      <div className="sld-print-deck" aria-hidden="true">
        {deck.slides
          .filter((entry) => !entry.hidden)
          .map((entry) => (
            <div className="sld-print-page" key={entry.id}>
              <SlideCanvas slide={entry} deck={deck} />
            </div>
          ))}
      </div>
      {presenting && <Presenter deck={deck} channelId={presenting} onClose={stop} />}
    </>
  );
}
export function SlidesWorkspace() {
  const { decks, broken, store, pending, error, conflict, conflicts, session } = useSlides();
  const connection = useConnectionState();
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const create = () => setSelected(store.add(newDeck()));
  const remove = (url: string) => {
    store.remove(url);
    toast.success("Presentation deleted", {
      action: { label: "Undo", onClick: () => store.undo(url) },
      duration: 6000,
    });
  };
  const filtered = decks.filter((entry) =>
    `${entry.deck.name} ${deckOutline(entry.deck).join(" ")}`
      .toLocaleLowerCase("en-GB")
      .includes(query.toLocaleLowerCase("en-GB")),
  );
  return (
    <AppFrame
      app="slides"
      sidebar={
        <div className="sld-sidebar">
          <Presentation size={28} aria-hidden="true" />
          <strong>Slides</strong>
          <p>Make room for your ideas.</p>
          <Button onClick={create}>
            <Plus size={16} />
            New presentation
          </Button>
          <Button variant="outline" onClick={() => setImporting(true)}>
            From Markdown
          </Button>
          <p className="sld-muted">
            {decks.length} presentations
            {session.mode === "demo" ? " · Fictional demo" : " · In your pod"}
          </p>
        </div>
      }
      context={<span>Slides</span>}
    >
      <div className="sld-page">
        <div className="sld-save-line" role="status" aria-live="polite">
          {connection !== "online"
            ? "You're offline. Keep editing; your changes are saved on this device."
            : error
              ? "Edits kept on this device. Retry to save to your pod."
              : pending
                ? "Saving presentation…"
                : "All changes saved"}
          {(error || (pending && connection === "online")) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void store.flush();
              }}
            >
              Retry save
            </Button>
          )}
        </div>
        {selected ? (
          <Editor url={selected} onBack={() => setSelected(undefined)} />
        ) : (
          <>
            <div className="sld-library-header">
              <div>
                <AppHeading>Your presentations</AppHeading>
                <p className="sld-muted">A place for stories, big ideas and what comes next.</p>
              </div>
              <div className="sld-toolbar">
                <Button onClick={create}>
                  <Plus size={16} />
                  New presentation
                </Button>
                <Button variant="outline" onClick={() => setImporting(true)}>
                  From Markdown
                </Button>
              </div>
            </div>
            {broken.length > 0 && (
              <p className="sld-broken" role="status">
                {broken.length === 1
                  ? "1 presentation couldn't be opened."
                  : `${broken.length} presentations couldn't be opened.`}{" "}
                Check the files in your pod's slides folder, or reconnect and try again.
              </p>
            )}
            <Label htmlFor="sld-search" className="sld-visually-hidden">
              Search presentations and slide titles
            </Label>
            <Input
              id="sld-search"
              className="sld-search"
              placeholder="Search presentations and slide titles"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {filtered.length ? (
              <div className="sld-library">
                {filtered.map((entry) => (
                  <article key={entry.url} className="sld-deck-card">
                    <button
                      type="button"
                      className="sld-open-deck"
                      onClick={() => setSelected(entry.url)}
                      aria-label={`Open ${entry.deck.name}`}
                    >
                      <span className="sld-card-thumbnail">
                        {entry.deck.slides[0] ? (
                          <SlideCanvas slide={entry.deck.slides[0]} deck={entry.deck} thumbnail />
                        ) : (
                          <span>Empty presentation</span>
                        )}
                      </span>
                      <strong>{entry.deck.name || "Untitled presentation"}</strong>
                    </button>
                    <div className="sld-card-footer">
                      <span>{entry.deck.slides.length} slides</span>
                      <IconButton
                        label={`Duplicate ${entry.deck.name}`}
                        size="icon-sm"
                        onClick={() =>
                          setSelected(
                            store.add({
                              ...entry.deck,
                              name: `${entry.deck.name} (copy)`,
                              created: new Date(),
                              modified: new Date(),
                            }),
                          )
                        }
                      >
                        <Copy size={15} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${entry.deck.name}`}
                        size="icon-sm"
                        onClick={() => remove(entry.url)}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                variant={query ? "no-results" : "first-use"}
                title={query ? "No matching presentations" : "Start with an idea"}
                body={
                  query
                    ? "Try another title or clear your search."
                    : "Create a blank presentation or turn Markdown into slides."
                }
                primaryAction={
                  <Button onClick={query ? () => setQuery("") : create}>
                    {query ? "Clear search" : "Create presentation"}
                  </Button>
                }
              />
            )}
          </>
        )}
      </div>
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create from Markdown</DialogTitle>
            <DialogDescription>
              Separate slides with a line containing exactly ---. Use # for a title, and ??? or
              Note: for speaker notes.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="sld-markdown-file">Choose a Markdown file</Label>
          <Input
            id="sld-markdown-file"
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) {
                toast.error("Choose a Markdown file smaller than 2 MB.");
                return;
              }
              void file.text().then(setMarkdown, () => toast.error("Couldn't read that file."));
            }}
          />
          <Label htmlFor="sld-markdown-paste">Markdown</Label>
          <Textarea
            id="sld-markdown-paste"
            rows={9}
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            placeholder="# Your title"
          />
          <DialogFooter>
            <Button
              onClick={() => {
                try {
                  setSelected(store.add(deckFromMarkdown(markdown)));
                  setImporting(false);
                  setMarkdown("");
                } catch {
                  toast.error(
                    "Couldn't import this Markdown. Check the presentation metadata and try again.",
                  );
                }
              }}
            >
              Create presentation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(conflict)} onOpenChange={() => {}}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {conflict
                ? `“${conflict.local.name || "Untitled presentation"}” changed elsewhere`
                : "This presentation changed elsewhere"}
            </DialogTitle>
            <DialogDescription>
              The latest pod version is loaded. Keep your unsaved changes as a separate
              presentation, or continue with the pod version.
              {conflicts.length > 1 && ` ${conflicts.length - 1} more to review after this one.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => store.resolveConflict(false)}>
              Use pod version
            </Button>
            <Button
              onClick={() => {
                const url = store.resolveConflict(true);
                if (url) setSelected(url);
              }}
            >
              Keep my copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppFrame>
  );
}
