// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { refuseRedirects } from "@jeswr/guarded-fetch";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Toolbar,
  toast,
} from "@jeswr/suite-ui";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  Archive,
  ArchiveRestore,
  Bold,
  FileText,
  Heading,
  Italic,
  Link as LinkIcon,
  List,
  ListTodo,
  Pin,
  PinOff,
  Share2,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Hint } from "@/apps/docs/components/common";
import { validLink } from "@/apps/docs/lib/editor/logic";
import { buildDocument, parseDocument } from "@/apps/docs/lib/model/document";
import { ResourceWriteError } from "@/apps/docs/lib/model/errors";
import { writeRdf } from "@/apps/docs/lib/model/rdf-io";
import { createDocsStore, type StoredDocument } from "@/apps/docs/lib/model/store";
import { PREFIXES } from "@/apps/docs/lib/model/vocab";
import { encodeRef } from "@/lib/refs";
import { notesExtensions } from "../editor/extensions";
import type { StoredNote } from "../lib/model/store";
import { getPendingDrafts } from "../state/draft-registry";
import { useNotesContext } from "../state/notes-context";
import { useNoteDraft } from "../state/use-note-draft";
import { ColourPicker, ConfirmDialog, LabelChips, LabelPicker } from "./controls";

export function NoteDialog({ note }: { note: StoredNote }) {
  const { store, refresh, session, prefs, pin, colour, closeNote, opener, move } =
    useNotesContext();
  const { draft, change, flush, resolve, status, modified } = useNoteDraft(
    note,
    store,
    refresh,
    getPendingDrafts(session.webId),
  );
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  // Keep the destination across failed moves and dismissed confirmations.
  const conversions = useRef(
    new Map<string, { document: StoredDocument; title: string; body: string }>(),
  );
  const [confirmDocs, setConfirmDocs] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const titleInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const trashed = note.location === "trashed";
  const readOnly = trashed || busy;
  const handler = useRef(change);
  handler.current = change;
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: notesExtensions(),
      content: draft.body,
      editable: !readOnly,
      editorProps: {
        attributes: {
          "aria-label": "Note body",
          role: "textbox",
          "aria-multiline": "true",
          spellcheck: "true",
        },
      },
      onUpdate: ({ editor }) => {
        if (!actionPending.current) handler.current({ body: editor.getHTML() });
      },
    },
    [note.url],
  );
  useEffect(() => {
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);
  useEffect(() => {
    if (editor && draft.body !== editor.getHTML())
      editor.commands.setContent(draft.body, { emitUpdate: false });
  }, [draft.body, editor]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const lock = () => {
    if (actionPending.current) return false;
    actionPending.current = true;
    // Apply the DOM/editor lock synchronously, before flush can take its snapshot.
    if (titleInput.current) titleInput.current.readOnly = true;
    editor?.setEditable(false, false);
    setBusy(true);
    return true;
  };
  const unlock = () => {
    actionPending.current = false;
    if (titleInput.current) titleInput.current.readOnly = trashed;
    editor?.setEditable(!trashed, false);
    setBusy(false);
  };
  const close = async () => {
    if (!lock()) return;
    try {
      await flush();
      closeNote();
    } catch {
      unlock();
    }
  };
  const act = (work: (saved: StoredNote) => Promise<unknown>) => {
    if (!lock()) return Promise.resolve();
    return flush()
      .then(work)
      .catch(() => {
        toast.error("Couldn't complete that action. Your note is still here.");
        unlock();
      });
  };
  const review = async (keepMine: boolean) => {
    if (!lock()) return;
    try {
      await resolve(keepMine);
    } finally {
      unlock();
    }
  };
  const retry = async () => {
    if (!lock()) return;
    try {
      await flush();
    } catch {
      // The save status retains the error and draft for another retry.
    } finally {
      unlock();
    }
  };
  const age = Math.max(0, Math.floor((now - Date.parse(modified ?? "")) / 60_000));
  const relative =
    !Number.isFinite(age) || age < 1
      ? "just now"
      : age < 60
        ? `${age} minutes ago`
        : age < 1440
          ? `${Math.floor(age / 60)} hours ago`
          : `${Math.floor(age / 1440)} days ago`;
  const actions = editor
    ? [
        {
          id: "bold",
          label: "Bold",
          icon: <Bold size={16} />,
          onSelect: () => {
            editor.chain().focus().toggleBold().run();
          },
        },
        {
          id: "italic",
          label: "Italic",
          icon: <Italic size={16} />,
          onSelect: () => {
            editor.chain().focus().toggleItalic().run();
          },
        },
        {
          id: "heading",
          label: "Heading",
          icon: <Heading size={16} />,
          onSelect: () => {
            editor.chain().focus().toggleHeading({ level: 2 }).run();
          },
        },
        {
          id: "bullets",
          label: "Bullet list",
          icon: <List size={16} />,
          onSelect: () => {
            editor.chain().focus().toggleBulletList().run();
          },
        },
        {
          id: "checklist",
          label: "Checklist",
          icon: <ListTodo size={16} />,
          onSelect: () => {
            editor.chain().focus().toggleTaskList().run();
          },
        },
        {
          id: "link",
          label: "Link",
          icon: <LinkIcon size={16} />,
          onSelect: () => {
            setUrl(editor.getAttributes("link").href ?? "");
            setLinkOpen(true);
          },
        },
      ]
    : [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent
        className="notes-dialog"
        data-note-colour={prefs.colours[note.url] ?? "default"}
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleInput.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => {
            const target = opener.current;
            if (target?.isConnected) target.focus();
            else document.getElementById("main-content")?.focus();
          });
        }}
      >
        <DialogTitle className="sr-only">Edit note</DialogTitle>
        <DialogDescription className="sr-only">
          Your changes save automatically to your pod.
        </DialogDescription>
        <Input
          ref={titleInput}
          className="notes-title-input"
          aria-label="Note title"
          placeholder="Title"
          value={draft.title}
          readOnly={readOnly}
          onChange={(event) => {
            if (!actionPending.current) change({ title: event.target.value });
          }}
        />
        {!readOnly && <Toolbar label="Note formatting" actions={actions} />}
        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <PopoverAnchor asChild>
            <span className="sr-only" aria-hidden="true" />
          </PopoverAnchor>
          <PopoverContent
            className="notes-popover"
            aria-label="Insert link"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              editor?.commands.focus();
            }}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const href = validLink(url);
                if (!href) {
                  setLinkError(true);
                  return;
                }
                editor
                  ?.chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href, rel: "noopener noreferrer" })
                  .run();
                setLinkError(false);
                setLinkOpen(false);
              }}
            >
              <Input
                aria-label="Link URL"
                placeholder="https://"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
              {linkError && <p role="alert">Enter a valid web or email URL.</p>}
              <Button type="submit">Apply link</Button>
              <Button
                variant="ghost"
                onClick={() => {
                  editor?.chain().focus().unsetLink().run();
                  setLinkOpen(false);
                }}
              >
                Remove link
              </Button>
            </form>
          </PopoverContent>
        </Popover>
        <div className="notes-editor">
          {editor ? <EditorContent editor={editor} /> : <p role="status">Opening note…</p>}
        </div>
        {status === "conflict" && (
          <div role="alert" className="notes-conflict">
            <p>This note changed somewhere else</p>
            <Button variant="outline" disabled={busy} onClick={() => void review(false)}>
              Load latest
            </Button>
            <Button disabled={busy} onClick={() => void review(true)}>
              Keep mine
            </Button>
          </div>
        )}
        <footer className="notes-dialog-footer">
          <LabelChips links={false} labels={draft.labels} />
          <div className="notes-dialog-actions">
            {trashed ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  act(async (saved) => {
                    await move(saved, "restore");
                    closeNote();
                  })
                }
              >
                Restore note
              </Button>
            ) : (
              <>
                <LabelPicker
                  disabled={busy}
                  value={draft.labels}
                  onChange={(labels) => change({ labels })}
                />
                <IconButton
                  label={prefs.pinned.includes(note.url) ? "Unpin note" : "Pin note"}
                  variant="ghost"
                  disabled={busy}
                  aria-pressed={prefs.pinned.includes(note.url)}
                  onClick={() => pin(note.url)}
                >
                  {prefs.pinned.includes(note.url) ? (
                    <PinOff size={18} aria-hidden="true" />
                  ) : (
                    <Pin size={18} aria-hidden="true" />
                  )}
                </IconButton>
                <ColourPicker
                  disabled={busy}
                  value={prefs.colours[note.url] ?? "default"}
                  onChange={(value) => colour(note.url, value)}
                />
                <IconButton
                  label={note.location === "archived" ? "Unarchive note" : "Archive note"}
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    act(async (saved) => {
                      await move(saved, note.location === "archived" ? "unarchive" : "archive");
                      closeNote();
                    })
                  }
                >
                  {note.location === "archived" ? (
                    <ArchiveRestore size={18} aria-hidden="true" />
                  ) : (
                    <Archive size={18} aria-hidden="true" />
                  )}
                </IconButton>
                <IconButton
                  label="Move to trash"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    act(async (saved) => {
                      await move(saved, "trash");
                      closeNote();
                    })
                  }
                >
                  <Trash2 size={18} aria-hidden="true" />
                </IconButton>
                <Button
                  className="notes-open-docs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmDocs(true)}
                >
                  <FileText size={16} aria-hidden="true" />
                  Open in Docs
                </Button>
                <Hint text="Sharing arrives with the suite shell">
                  <Button variant="ghost" disabled>
                    <Share2 size={16} aria-hidden="true" />
                    Share
                  </Button>
                </Hint>
              </>
            )}
          </div>
          <div className="notes-dialog-status">
            <span role="status" aria-live="polite">
              {status === "saved"
                ? "Saved"
                : status === "saving"
                  ? "Saving…"
                  : status === "conflict"
                    ? "Changes need review"
                    : "Couldn't save — "}
              {status === "failed" && (
                <Button variant="link" disabled={busy} onClick={() => void retry()}>
                  Retry
                </Button>
              )}
            </span>
            <span>Edited {relative}</span>
            <Button variant="ghost" disabled={busy} onClick={() => void close()}>
              Close
            </Button>
          </div>
        </footer>
      </DialogContent>
      {confirmDocs && (
        <ConfirmDialog
          title="Open in Docs?"
          description="This note moves to Trash in Notes, and you can restore it from there."
          close={() => setConfirmDocs(false)}
          confirm={() =>
            act(async (saved) => {
              let conversion = conversions.current.get(saved.url);
              const input = {
                title: saved.title || "Untitled document",
                body: saved.body,
                format: "text/html",
              };
              if (
                conversion &&
                (conversion.title !== saved.title || conversion.body !== saved.body)
              ) {
                const { document } = conversion;
                const dataset = buildDocument(document.url, {
                  ...document.data,
                  ...input,
                  priorRevisions: document.data.revisions,
                  editor: session.webId,
                });
                try {
                  const { etag } = await writeRdf(document.url, dataset, {
                    etag: document.etag,
                    fetchImpl: refuseRedirects(session.fetch),
                    prefixes: PREFIXES,
                  });
                  conversion = {
                    document: {
                      url: document.url,
                      etag,
                      data: parseDocument(document.url, dataset) as StoredDocument["data"],
                    },
                    title: saved.title,
                    body: saved.body,
                  };
                } catch (error) {
                  if (!(error instanceof ResourceWriteError && error.status === 412)) throw error;
                  // Someone edited the created document. Preserve it and allocate a fresh one.
                  conversion = undefined;
                }
              }
              if (!conversion) {
                const docs = createDocsStore({
                  fetchImpl: session.fetch,
                  podRoot: session.storageUrl,
                  webId: session.webId,
                });
                conversion = {
                  document: await docs.create(input),
                  title: saved.title,
                  body: saved.body,
                };
              }
              conversions.current.set(saved.url, conversion);
              await move(saved, "trash");
              router.push(`/docs/d/${encodeRef(conversion.document.url)}`);
              conversions.current.delete(saved.url);
            })
          }
        />
      )}
    </Dialog>
  );
}
