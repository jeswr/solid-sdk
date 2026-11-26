// AUTHORED-BY Codex GPT-6.2-Astra
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { OpenWithAccount } from "@/components/open-with-account";
import type { SessionResourceGrant } from "@/shell/session/types";
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
interface SharedNoteProps {
  reference: string;
  podRoot: string;
  /** The account's fetch and grant, when it can open private notes shared from another pod. */
  account?: {
    id: string;
    fetch: typeof fetch;
    grant: (url: string) => Promise<SessionResourceGrant>;
  };
}
export function SharedNote(props: SharedNoteProps) {
  return <SharedNoteView key={JSON.stringify([props.account?.id, props.reference])} {...props} />;
}
function SharedNoteView({ reference, podRoot, account }: SharedNoteProps) {
  const [granted, setGranted] = useState<{ fetch: typeof fetch; handle: SessionResourceGrant }>();
  const grant = granted?.fetch === account?.fetch ? granted : undefined;
  const [state, setState] = useState<{
    grant: typeof grant;
    result: Awaited<ReturnType<typeof readSharedNote>> | { error: Error };
  }>();
  useEffect(() => {
    let alive = true;
    void readSharedNote(reference, podRoot, undefined, grant?.fetch).then(
      (result) => {
        if (alive) setState({ grant, result });
      },
      (error: Error) => {
        if (error instanceof PrivateNoteError && error.reason === "denied") grant?.handle.revoke();
        if (alive) setState({ grant, result: { error } });
      },
    );
    return () => {
      alive = false;
    };
  }, [reference, podRoot, grant]);
  if (!state || state.grant !== grant) return <p role="status">Opening shared note…</p>;
  if ("error" in state.result) {
    const { error } = state.result;
    return (
      <div role="alert">
        <p>{error.message}</p>
        {account && error instanceof PrivateNoteError && error.reason === "private" && (
          <OpenWithAccount
            url={noteLink(reference, podRoot).url}
            kind="note"
            open={async () => {
              const handle = await account.grant(noteLink(reference, podRoot).url);
              setGranted({ fetch: account.fetch, handle });
            }}
          />
        )}
      </div>
    );
  }
  return <SharedBody {...state.result} />;
}
