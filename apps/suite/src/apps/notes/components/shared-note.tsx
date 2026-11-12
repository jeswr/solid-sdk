// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { OpenWithAccount } from "@/components/open-with-account";
import { notesExtensions } from "../editor/extensions";
import type { StoredNote } from "../lib/model/store";
import { noteLink, PrivateNoteError, readSharedNote } from "../lib/shared-note";

const anonymous: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "omit", redirect: "error" });
function SharedBody({ note, ownerRoot }: { note: StoredNote; ownerRoot: string }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: notesExtensions(anonymous, ownerRoot),
    content: note.body,
    editable: false,
    editorProps: { attributes: { "aria-label": "Note body", "aria-readonly": "true" } },
  });
  return (
    <article className="notes-shared-view">
      <h1>{note.title || "Untitled note"}</h1>
      <p role="status">View only</p>
      <EditorContent editor={editor} />
      <a href="/notes">Open your Notes</a>
    </article>
  );
}
export function SharedNote({
  reference,
  podRoot,
  account,
}: {
  reference: string;
  podRoot: string;
  /** The account's fetch and grant, when it can open private notes shared from another pod. */
  account?: { fetch: typeof fetch; grant: (url: string) => Promise<void> };
}) {
  const [state, setState] = useState<{
    reference: string;
    note?: StoredNote;
    ownerRoot?: string;
    error?: Error;
  }>();
  // The note this account was granted, after the reader's consent click.
  const [granted, setGranted] = useState<string>();
  const withAccount = granted === reference ? account?.fetch : undefined;
  useEffect(() => {
    let alive = true;
    void readSharedNote(reference, podRoot, undefined, withAccount).then(
      ({ note, ownerRoot }) => {
        if (alive) setState({ reference, note, ownerRoot });
      },
      (error: Error) => {
        if (alive) setState({ reference, error });
      },
    );
    return () => {
      alive = false;
    };
  }, [reference, podRoot, withAccount]);
  if (state?.reference !== reference) return <p role="status">Opening shared note…</p>;
  if (state.error)
    return (
      <div role="alert">
        <p>{state.error.message}</p>
        {account && state.error instanceof PrivateNoteError && state.error.reason === "private" && (
          <OpenWithAccount
            url={noteLink(reference, podRoot).url}
            kind="note"
            open={async () => {
              await account.grant(noteLink(reference, podRoot).url);
              setState(undefined);
              setGranted(reference);
            }}
          />
        )}
      </div>
    );
  return (
    <SharedBody
      key={reference}
      note={state.note as StoredNote}
      ownerRoot={state.ownerRoot as string}
    />
  );
}
