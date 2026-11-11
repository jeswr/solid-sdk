// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { notesExtensions } from "../editor/extensions";
import type { StoredNote } from "../lib/model/store";
import { readSharedNote } from "../lib/shared-note";

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
export function SharedNote({ reference, podRoot }: { reference: string; podRoot: string }) {
  const [state, setState] = useState<{
    reference: string;
    note?: StoredNote;
    ownerRoot?: string;
    error?: string;
  }>();
  useEffect(() => {
    let alive = true;
    void readSharedNote(reference, podRoot).then(
      ({ note, ownerRoot }) => {
        if (alive) setState({ reference, note, ownerRoot });
      },
      (error: Error) => {
        if (alive) setState({ reference, error: error.message });
      },
    );
    return () => {
      alive = false;
    };
  }, [reference, podRoot]);
  if (state?.reference !== reference) return <p role="status">Opening shared note…</p>;
  if (state.error) return <div role="alert">{state.error}</div>;
  return (
    <SharedBody
      key={reference}
      note={state.note as StoredNote}
      ownerRoot={state.ownerRoot as string}
    />
  );
}
