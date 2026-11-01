// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Button, ErrorState, Skeleton } from "@jeswr/suite-ui";
import { Search, StickyNote } from "lucide-react";
import { useState } from "react";
import { NoteConflictError } from "../lib/model/errors";
import { selectNotes } from "../lib/model/query";
import type { StoredNote } from "../lib/model/store";
import { useNotesContext } from "../state/notes-context";
import { CaptureBar } from "./capture-bar";
import { ConfirmDialog } from "./controls";
import { NoteCard } from "./note-card";

export function NotesGrid({
  view = "active",
  label,
  query = "",
}: {
  view?: "active" | "archived" | "trashed" | "label" | "search";
  label?: string;
  query?: string;
}) {
  const { notes, prefs, active, archived, trashed, refresh, store } = useNotesContext();
  const [emptying, setEmptying] = useState<StoredNote[]>();
  const location = view === "archived" || view === "trashed" ? view : "active";
  const resource = location === "archived" ? archived : location === "trashed" ? trashed : active;
  const searching = view === "search";
  const loading = searching
    ? (active.loading && !active.data) || (archived.loading && !archived.data)
    : resource.loading && !resource.data;
  const error = searching ? active.error || archived.error : resource.error;
  const selected = selectNotes(notes, prefs, {
    location,
    ...(label === undefined ? {} : { labels: [label] }),
    query: searching ? query : "",
  });
  if (searching) {
    const archive = selectNotes(notes, prefs, { location: "archived", query });
    selected.others.push(...archive.others);
  }
  const count = selected.pinned.length + selected.others.length;
  const title =
    view === "archived"
      ? "Archive"
      : view === "trashed"
        ? "Trash"
        : view === "label"
          ? label
          : searching
            ? "Search notes"
            : "Notes";
  const empty =
    view === "archived"
      ? "Your archived notes appear here"
      : view === "trashed"
        ? "No notes in Trash"
        : view === "label"
          ? "No notes with this label"
          : searching
            ? "No matching notes"
            : "Notes you add appear here";
  return (
    <div className="notes-workspace" data-view={prefs.view}>
      <header className="notes-page-heading">
        <h1>{title}</h1>
        {searching && <p>Results for “{query}”</p>}
      </header>
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
        <>
          {selected.pinned.length > 0 && (
            <section aria-labelledby="notes-pinned">
              <h2 id="notes-pinned" className="notes-section-heading">
                Pinned
              </h2>
              <div className="notes-grid">
                {selected.pinned.map((note) => (
                  <NoteCard key={note.url} note={note} />
                ))}
              </div>
            </section>
          )}
          {selected.others.length > 0 && (
            <section aria-label={selected.pinned.length ? undefined : "Notes"}>
              {selected.pinned.length > 0 ? (
                <h2 className="notes-section-heading">Others</h2>
              ) : (
                <h2 className="sr-only">Notes</h2>
              )}
              <div className="notes-grid">
                {selected.others.map((note) => (
                  <NoteCard key={note.url} note={note} />
                ))}
              </div>
            </section>
          )}
        </>
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
            await refresh();
            const conflict = results.find(
              (result) =>
                result.status === "rejected" && result.reason instanceof NoteConflictError,
            );
            if (conflict?.status === "rejected") throw conflict.reason;
            if (results.some((result) => result.status === "rejected"))
              throw new Error("Some notes could not be deleted");
          }}
        />
      )}
    </div>
  );
}
