// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@jeswr/suite-ui";
import { EditorContent, useEditor } from "@tiptap/react";
import { type RefObject, useId, useState } from "react";
import { DocumentVersionPanel } from "../../../components/document-version-panel";
import { notesExtensions } from "../editor/extensions";
import { NoteConflictError } from "../lib/model/errors";
import type { NoteRevision } from "../lib/model/note";

/** The same schema and URL/image sanitisation as the editor, with no draft writer. */
function NoteVersionPreview({
  title,
  body,
  http,
  podRoot,
}: {
  title: string;
  body: string;
  http: typeof fetch;
  podRoot: string;
}) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: notesExtensions(http, podRoot),
      content: body,
      editable: false,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": "Version preview",
          "aria-readonly": "true",
          tabindex: "0",
        },
      },
    },
    [body, http, podRoot],
  );
  return (
    <section className="notes-version-preview" aria-label="Version content">
      <h3>{title || "Untitled note"}</h3>
      <div className="notes-editor">
        <EditorContent editor={editor} />
      </div>
    </section>
  );
}

export function NoteVersionHistory({
  revisions,
  current,
  readOnly,
  restore,
  close,
  menu,
  http,
  podRoot,
}: {
  revisions: readonly NoteRevision[];
  current: { title: string; body: string };
  readOnly: boolean;
  restore: (revision: NoteRevision) => Promise<void>;
  close: () => void;
  menu: RefObject<HTMLButtonElement | null>;
  http: typeof fetch;
  podRoot: string;
}) {
  const headingId = useId();
  const [selected, setSelected] = useState<NoteRevision>();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const content = selected ?? current;
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent
        className="notes-version-history"
        aria-labelledby={headingId}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          menu.current?.focus();
        }}
      >
        <DialogDescription className="sr-only">
          Browse saved versions of this note. Restoring keeps a version of your current content.
        </DialogDescription>
        <DocumentVersionPanel
          className="notes-version-panel"
          headingId={headingId}
          heading={<DialogTitle id={headingId}>Version history</DialogTitle>}
          close={close}
          closeLabel="Close version history"
          listLabel="Note versions"
          selectedId={selected?.id}
          entries={[...revisions]
            .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
            .map((revision) => ({
              id: revision.id,
              created: revision.generatedAt,
              label: revision.label,
              author: revision.attributedTo,
            }))}
          choose={(id) => setSelected(revisions.find((revision) => revision.id === id))}
          emptyMessage="No saved versions yet."
          preview={
            <NoteVersionPreview
              title={content.title ?? current.title}
              body={content.body}
              http={http}
              podRoot={podRoot}
            />
          }
          restoreAction={
            <>
              <Button disabled={readOnly || busy} onClick={() => setConfirm(true)}>
                Restore this version
              </Button>
              {readOnly && <p>View only. You can browse versions.</p>}
            </>
          }
        />
        {error && <p role="alert">{error}</p>}
      </DialogContent>
      <Dialog open={confirm} onOpenChange={(open) => !busy && setConfirm(open)}>
        <DialogContent
          className="notes-confirm"
          showCloseButton={!busy}
          onEscapeKeyDown={(event) => busy && event.preventDefault()}
          onPointerDownOutside={(event) => busy && event.preventDefault()}
        >
          <DialogTitle>Restore this version?</DialogTitle>
          <DialogDescription>
            This replaces the note's title and body. Your current content is kept in version history
            so you can restore it again.
          </DialogDescription>
          <div className="notes-confirm-actions">
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              disabled={readOnly || busy}
              onClick={() => {
                if (!selected || readOnly || busy) return;
                setBusy(true);
                setError(undefined);
                void restore(selected)
                  .catch((cause) => {
                    setError(
                      cause instanceof NoteConflictError
                        ? "This note changed somewhere else. Close version history to review your changes."
                        : "Couldn't restore this version. Close version history to review or retry your changes.",
                    );
                  })
                  .finally(() => {
                    setBusy(false);
                    setConfirm(false);
                  });
              }}
            >
              {busy ? "Restoring…" : "Restore"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
