// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, EmptyState, ErrorState } from "@jeswr/suite-ui";
import { StickyNote } from "lucide-react";
import Link from "next/link";
import { useConnectionState } from "@/shell/sync/connection-state";

export type NotesView = "active" | "archived" | "trashed" | "label" | "search" | "reminders";

const emptyCopy = {
  active: ["Notes you add appear here", "Capture an idea, a reminder or a checklist."],
  archived: [
    "Your archived notes appear here",
    "Archive notes to keep them out of your main list.",
  ],
  trashed: ["No notes in Trash", "Notes you move to Trash stay here for 30 days."],
  label: ["No notes with this label", "Create a note with this label or return to all your notes."],
  search: ["No matching notes", "Try another search or return to all your notes."],
  reminders: ["Notes with reminders appear here", "Set a reminder on a note to find it here."],
} as const;

export function NotesEmptyState({ view, onCreate }: { view: NotesView; onCreate: () => void }) {
  const [title, body] = emptyCopy[view];
  const canCreate = view === "active" || view === "label";
  return (
    <EmptyState
      variant={view === "search" ? "no-results" : view === "label" ? "filtered-empty" : "first-use"}
      title={title}
      body={body}
      {...(view === "search" ? {} : { icon: <StickyNote size={24} aria-hidden="true" /> })}
      primaryAction={
        canCreate ? (
          <Button onClick={onCreate}>Create a note</Button>
        ) : (
          <Button asChild>
            <Link href="/notes">Back to Notes</Link>
          </Button>
        )
      }
      secondaryAction={
        view === "label" ? (
          <Button asChild variant="outline">
            <Link href="/notes">Back to Notes</Link>
          </Button>
        ) : undefined
      }
    />
  );
}

export function NotesLoadError({ retry }: { retry: () => void }) {
  const connection = useConnectionState();
  return (
    <ErrorState error={connection === "online" ? "unreachable" : "offline"} actions={{ retry }}>
      <p>Your notes couldn't be loaded. Try again when your storage is available.</p>
    </ErrorState>
  );
}

export function NotesMissingState() {
  return (
    <div className="notes-workspace">
      <h1>Note not found</h1>
      <ErrorState error="not-found">
        <p>This note may have been moved or deleted.</p>
        <Button asChild>
          <Link href="/notes">Back to Notes</Link>
        </Button>
      </ErrorState>
    </div>
  );
}

export function NotesAvailability({ trashed = false }: { trashed?: boolean }) {
  const connection = useConnectionState();
  if (!trashed && connection === "online") return null;
  return (
    <div className="notes-availability" role="status">
      {connection !== "online" && <p>You're offline. Reconnect to save changes to your pod.</p>}
      {trashed && <p>This note is read-only in Trash. Restore it to make changes.</p>}
    </div>
  );
}
