// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import { NoteConflictError, NoteMoveBlockedError } from "../lib/model/errors";
import type { NoteFailure } from "../lib/model/store";
import { useNotesContext } from "../state/notes-context";

/** Batch failures retain each refused note and its route to sharing. */
export function NoteFailures({ failures }: { failures: readonly NoteFailure[] }) {
  const { openShare, notes } = useNotesContext();
  if (!failures.length) return null;
  return (
    <div role="alert">
      <p>
        {failures.length} {failures.length === 1 ? "note" : "notes"} could not be changed.
      </p>
      <ul>
        {failures.map(({ url, error }) => (
          <li key={url}>
            {notes.find((note) => note.url === url)?.title || url}:{" "}
            {error instanceof NoteMoveBlockedError ? (
              <>
                {error.message}{" "}
                <Button variant="link" onClick={() => openShare(url)}>
                  Share
                </Button>
              </>
            ) : error instanceof NoteConflictError ? (
              "This note changed somewhere else. The list has been refreshed."
            ) : (
              "Couldn't complete this action. Please try again."
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
