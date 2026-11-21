// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Button, ErrorState, Skeleton } from "@jeswr/suite-ui";
import { Search, StickyNote } from "lucide-react";
import { useEffect, useState } from "react";
import { bulkFailureMessage, bulkNeedsConnection } from "../lib/bulk";
import { selectNotes } from "../lib/model/query";
import type { NoteFailure, StoredNote } from "../lib/model/store";
import { useNotesContext } from "../state/notes-context";
import { useNotesSelection } from "../state/use-notes-selection";
import { CaptureBar } from "./capture-bar";
import { ConfirmDialog } from "./controls";
import { NoteCard } from "./note-card";
import { NoteFailures } from "./note-failures";
import { NotesShortcuts } from "./notes-shortcuts";
import { NotesSelectionToolbar } from "./selection-toolbar";

export function NotesGrid({
  view = "active",
  label,
  query = "",
}: {
  view?: "active" | "archived" | "trashed" | "label" | "search" | "reminders";
  label?: string;
  query?: string;
}) {
  const { notes, prefs, active, archived, trashed, refresh, store } = useNotesContext();
  const [now, setNow] = useState(Date.now);
  const hasReminders = notes.some((note) => note.location !== "trashed" && !!note.reminder);
  useEffect(() => {
    if (!hasReminders) return;
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [hasReminders]);
  const [emptying, setEmptying] = useState<StoredNote[]>();
  const [failures, setFailures] = useState<NoteFailure[]>([]);
  const location = view === "archived" || view === "trashed" ? view : "active";
  const resource = location === "archived" ? archived : location === "trashed" ? trashed : active;
  const searching = view === "search";
  const combined = searching || view === "reminders";
  const loading = combined
    ? (active.loading && !active.data) || (archived.loading && !archived.data)
    : resource.loading && !resource.data;
  const error = combined ? active.error || archived.error : resource.error;
  const selected = selectNotes(notes, prefs, {
    location: view === "reminders" ? "reminders" : location,
    ...(label === undefined ? {} : { labels: [label] }),
    query: searching ? query : "",
    now,
  });
  if (searching) {
    const archive = selectNotes(notes, prefs, { location: "archived", query });
    selected.others.push(...archive.others);
  }
  const sections = selected.sections ?? [
    { title: "Pinned", notes: selected.pinned },
    { title: selected.pinned.length ? "Others" : "Notes", notes: selected.others },
  ];
  const visible = loading || error ? [] : sections.flatMap((section) => section.notes);
  const bulk = useNotesSelection(visible, JSON.stringify([view, label, query]));
  const [focused, setFocused] = useState<string>();
  const focusCard = (url: string) => {
    setFocused(url);
    const card = [...document.querySelectorAll<HTMLElement>(".notes-card")].find(
      (element) => element.dataset.noteUrl === url,
    );
    card?.querySelector<HTMLButtonElement>(".notes-card-body")?.focus();
  };
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]') &&
        !bulk.busy
      )
        bulk.selection.clear();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [bulk.busy, bulk.selection.clear]);
  const count = sections.reduce((sum, section) => sum + section.notes.length, 0);
  const title =
    view === "reminders"
      ? "Reminders"
      : view === "archived"
        ? "Archive"
        : view === "trashed"
          ? "Trash"
          : view === "label"
            ? label
            : searching
              ? "Search notes"
              : "Notes";
  const empty =
    view === "reminders"
      ? "Notes with reminders appear here"
      : view === "archived"
        ? "Your archived notes appear here"
        : view === "trashed"
          ? "No notes in Trash"
          : view === "label"
            ? "No notes with this label"
            : searching
              ? "No matching notes"
              : "Notes you add appear here";
  return (
    <div
      className="notes-workspace"
      data-view={prefs.view}
      onFocusCapture={(event) => {
        const card = event.target.closest<HTMLElement>(".notes-card");
        if (card) setFocused(card.dataset.noteUrl);
      }}
    >
      <NotesShortcuts notes={visible} state={bulk} focused={focused} focus={focusCard} />
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {bulk.selected.length} selected
      </p>
      {bulk.selected.length ? (
        <NotesSelectionToolbar state={bulk} />
      ) : (
        <header className="notes-page-heading">
          <h1>{title}</h1>
          {searching && <p>Results for “{query}”</p>}
        </header>
      )}
      {bulk.failure && (
        <div className="notes-bulk-failure">
          <p role="alert">
            {bulkFailureMessage(
              bulk.failure.failed.length,
              bulk.failure.total,
              bulk.failure.action,
            )}
          </p>
          <Button
            disabled={bulk.busy || (!bulk.online && bulkNeedsConnection(bulk.failure.action.type))}
            onClick={bulk.retry}
          >
            Retry failed notes
          </Button>
          <NoteFailures
            failures={bulk.failure.failed.map(({ note, error }) => ({ url: note.url, error }))}
          />
        </div>
      )}
      {(view === "active" || view === "label") && (
        <CaptureBar key={label ?? "active"} {...(label === undefined ? {} : { label })} />
      )}
      {view === "trashed" && (
        <div className="notes-trash-banner">
          <p>Notes in Trash are deleted after 30 days.</p>
          {count > 0 && (
            <Button
              variant="outline"
              onClick={() => setEmptying(notes.filter((note) => note.location === "trashed"))}
            >
              Empty trash
            </Button>
          )}
        </div>
      )}
      <NoteFailures failures={failures} />
      {loading ? (
        <div className="notes-grid" role="status" aria-label="Loading notes" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="notes-skeleton">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState error="unreachable" actions={{ retry: () => void refresh() }} />
      ) : count === 0 ? (
        <div className="notes-empty">
          {searching ? (
            <Search size={52} aria-hidden="true" />
          ) : (
            <StickyNote size={52} aria-hidden="true" />
          )}
          <h2>{empty}</h2>
        </div>
      ) : (
        sections
          .filter((section) => section.notes.length > 0)
          .map((section) => (
            <section key={section.title} aria-label={section.title}>
              <h2 className={section.title === "Notes" ? "sr-only" : "notes-section-heading"}>
                {section.title}
              </h2>
              <div className="notes-grid">
                {section.notes.map((note) => (
                  <NoteCard
                    key={note.url}
                    note={note}
                    now={new Date(now)}
                    selection={{
                      checked: bulk.selection.selectedKeys.has(note.url),
                      active: bulk.selected.length > 0,
                      busy: bulk.busy,
                      toggle: (range) => {
                        if (!bulk.busy)
                          bulk.selection.select(
                            note.url,
                            visible.map((note) => note.url),
                            { range, toggle: !range, additive: true },
                          );
                      },
                    }}
                  />
                ))}
              </div>
            </section>
          ))
      )}
      {emptying && (
        <ConfirmDialog
          title="Empty trash"
          description="Permanently delete all notes in Trash? This cannot be undone."
          close={() => setEmptying(undefined)}
          confirm={async () => {
            const results = await Promise.allSettled(
              emptying.map((note) => store.deleteForever(note.url, note.etag)),
            );
            setFailures(
              results.flatMap((result, index) =>
                result.status === "rejected"
                  ? [{ url: (emptying[index] as StoredNote).url, error: result.reason }]
                  : [],
              ),
            );
            await refresh();
          }}
        />
      )}
    </div>
  );
}
