// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger } from "@jeswr/suite-ui";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cardTextExcerpt } from "../lib/excerpt";
import { firstNoteImage } from "../lib/images";
import { NoteCover } from "./note-cover";
import { ShareNote } from "./share-note";

/** Spec: a card shows the first six lines; the grapheme cap bounds one very long line. */
const EXCERPT_LINES = 6;
const EXCERPT_GRAPHEMES = 400;

import type { StoredNote } from "../lib/model/store";
import { noteText } from "../lib/model/text";
import { checklistItems, toggleChecklistItem } from "../lib/ui/checklist";
import { getPendingDrafts } from "../state/draft-registry";
import { useNotesContext } from "../state/notes-context";
import { offerReminderPermission } from "../state/reminders";
import { ColourPicker, ConfirmDialog, LabelChips, LabelPicker } from "./controls";
import { ReminderChip, ReminderPicker } from "./reminder-picker";

export function NoteCard({ note, now = new Date() }: { note: StoredNote; now?: Date }) {
  const {
    prefs,
    openNote,
    pin,
    colour,
    attempt,
    mutations,
    move,
    create,
    session,
    sharedNotes,
    refreshSharing,
    store,
    refresh,
  } = useNotesContext();
  const id = useId();
  const [cover, setCover] = useState<ReturnType<typeof firstNoteImage>>();
  useEffect(() => {
    setCover(firstNoteImage(note.body, session.storageUrl));
  }, [note.body, session.storageUrl]);
  const [sharing, setSharing] = useState<StoredNote>();
  const [deleting, setDeleting] = useState<StoredNote>();
  const pending = note.etag === null && note.url.includes("/pending-");
  const [busy, setBusy] = useState(false);
  const items = checklistItems(note.body);
  const pinned = prefs.pinned.includes(note.url);
  const run = (work: () => Promise<unknown>) => {
    if (busy || pending) return;
    setBusy(true);
    attempt(async () => {
      try {
        return await work();
      } finally {
        setBusy(false);
      }
    });
  };
  return (
    <article
      className="notes-card"
      aria-labelledby={id}
      data-note-colour={prefs.colours[note.url] ?? "default"}
      aria-busy={pending || busy}
    >
      <button
        type="button"
        className="notes-card-body"
        disabled={busy || pending}
        onClick={(event) => openNote(note, event.currentTarget)}
      >
        {cover && <NoteCover {...cover} fetchImpl={session.fetch} />}
        <h3 id={id}>{note.title || "Untitled note"}</h3>
        {items.length === 0 && note.body && (
          <p className="notes-excerpt">
            {cardTextExcerpt(
              noteText(note.body).split("\n").slice(0, EXCERPT_LINES).join("\n"),
              EXCERPT_GRAPHEMES,
            )}
          </p>
        )}
      </button>
      {items.length > 0 && (
        <ul className="notes-checklist-preview">
          {items.slice(0, 5).map((item, index) => (
            <li key={`task-${index.toString()}`}>
              <label>
                <input
                  type="checkbox"
                  aria-label={item.text || `Item ${index + 1}`}
                  checked={item.checked}
                  disabled={busy || pending || note.readOnly || note.location === "trashed"}
                  onChange={() =>
                    run(() => mutations.save(note, { body: toggleChecklistItem(note.body, index) }))
                  }
                />
                <span data-checked={item.checked}>{item.text || "Empty item"}</span>
              </label>
            </li>
          ))}
          {items.length > 5 && <li className="notes-more-items">+{items.length - 5} more</li>}
        </ul>
      )}
      {sharedNotes?.[note.url] === true && (
        <span className="notes-shared-indicator">
          <Users size={14} aria-hidden="true" />
          Shared
        </span>
      )}
      <LabelChips labels={note.labels} />
      <ReminderChip value={note.reminder} now={now} />
      {!note.readOnly && (
        <div className="notes-card-actions">
          {note.location === "trashed" ? (
            <>
              <IconButton
                label="Restore note"
                variant="ghost"
                disabled={busy || pending}
                onClick={() => run(() => move(note, "restore"))}
              >
                <RotateCcw size={17} aria-hidden="true" />
              </IconButton>
              <IconButton
                label="Delete forever"
                variant="ghost"
                disabled={busy || pending}
                onClick={() => setDeleting(note)}
              >
                <Trash2 size={17} aria-hidden="true" />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton
                label={pinned ? "Unpin note" : "Pin note"}
                aria-pressed={pinned}
                variant="ghost"
                disabled={pending}
                onClick={() => pin(note.url)}
              >
                {pinned ? (
                  <PinOff size={17} aria-hidden="true" />
                ) : (
                  <Pin size={17} aria-hidden="true" />
                )}
              </IconButton>
              <ColourPicker
                disabled={busy || pending}
                value={prefs.colours[note.url] ?? "default"}
                onChange={(value) => colour(note.url, value)}
              />
              <IconButton
                label={note.location === "archived" ? "Unarchive note" : "Archive note"}
                variant="ghost"
                disabled={busy || pending}
                onClick={() =>
                  run(() => move(note, note.location === "archived" ? "unarchive" : "archive"))
                }
              >
                {note.location === "archived" ? (
                  <ArchiveRestore size={17} aria-hidden="true" />
                ) : (
                  <Archive size={17} aria-hidden="true" />
                )}
              </IconButton>
              <ReminderPicker
                disabled={busy || pending}
                value={note.reminder}
                onChange={(reminder) =>
                  run(async () => {
                    await mutations.save(note, { reminder });
                    if (reminder) offerReminderPermission(session.webId);
                  })
                }
              />
              <LabelPicker
                disabled={busy || pending}
                value={note.labels}
                onChange={(labels) => run(() => mutations.save(note, { labels }))}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <IconButton label="More note actions" variant="ghost" disabled={busy || pending}>
                    <MoreHorizontal size={17} aria-hidden="true" />
                  </IconButton>
                </PopoverTrigger>
                <PopoverContent
                  className="notes-popover notes-more-menu"
                  aria-label="More note actions"
                >
                  <Button
                    variant="ghost"
                    disabled={busy || pending}
                    onClick={() =>
                      run(() =>
                        create(
                          { title: note.title, body: note.body, labels: note.labels },
                          false,
                          prefs.colours[note.url] ?? "default",
                        ),
                      )
                    }
                  >
                    Make a copy
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy || pending}
                    onClick={() =>
                      run(async () => {
                        const saved = await getPendingDrafts(session.webId).flush(note, (...args) =>
                          store.save(...args),
                        );
                        setSharing(saved);
                      })
                    }
                  >
                    Collaborator
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy || pending}
                    onClick={() => run(() => move(note, "trash"))}
                  >
                    Move to trash
                  </Button>
                </PopoverContent>
              </Popover>
            </>
          )}
        </div>
      )}
      {sharing && (
        <ShareNote
          note={sharing}
          session={session}
          onClose={() => {
            setSharing(undefined);
            refreshSharing?.();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete forever"
          description="This note will be permanently deleted from your pod."
          close={() => setDeleting(undefined)}
          confirm={() => mutations.deleteForever(deleting)}
        />
      )}
    </article>
  );
}
