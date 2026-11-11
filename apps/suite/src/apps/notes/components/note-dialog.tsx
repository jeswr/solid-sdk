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
  ImagePlus,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageUpload } from "@/apps/docs/components/image-upload";
import { imageTransfer, type RichImageTransfer } from "@/apps/docs/editor/image-transfer";
import { validateImage, validLink } from "@/apps/docs/lib/editor/logic";
import { buildDocument, parseDocument } from "@/apps/docs/lib/model/document";
import { ResourceWriteError } from "@/apps/docs/lib/model/errors";
import { writeRdf } from "@/apps/docs/lib/model/rdf-io";
import { createDocsStore, type StoredDocument } from "@/apps/docs/lib/model/store";
import { PREFIXES } from "@/apps/docs/lib/model/vocab";
import { encodeRef } from "@/lib/refs";
import { notesExtensions } from "../editor/extensions";
import { NoteMoveBlockedError } from "../lib/model/errors";
import type { StoredNote } from "../lib/model/store";
import { checklistItems } from "../lib/ui/checklist";
import { getPendingDrafts } from "../state/draft-registry";
import { useNotesContext } from "../state/notes-context";
import { offerReminderPermission } from "../state/reminders";
import { useNoteDraft } from "../state/use-note-draft";
import { ColourPicker, ConfirmDialog, LabelChips, LabelPicker } from "./controls";
import { ReminderChip, ReminderPicker } from "./reminder-picker";
import { hasOpenItems, SendToTasksDialog } from "./send-to-tasks";
import { ShareNote } from "./share-note";

export function NoteDialog({ note }: { note: StoredNote }) {
  const {
    store,
    refresh,
    session,
    prefs,
    pin,
    colour,
    closeNote,
    opener,
    move,
    mutations,
    refreshSharing,
    reportError,
  } = useNotesContext();
  const { draft, change, flush, resolve, accept, status, modified, viewOnly } = useNoteDraft(
    note,
    store,
    refresh,
    getPendingDrafts(session.webId),
  );
  const [, selectionChanged] = useState(0);
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  // Keep the destination across failed moves and dismissed confirmations.
  const conversions = useRef(
    new Map<string, { document: StoredDocument; title: string; body: string }>(),
  );
  const [sharing, setSharing] = useState<StoredNote>();
  const [confirmDocs, setConfirmDocs] = useState(false);
  const [sendingTasks, setSendingTasks] = useState(false);
  const checklist = useMemo(() => checklistItems(draft.body), [draft.body]);
  const [image, setImage] = useState<{ file: File | null; transfer?: RichImageTransfer }>();
  const imageInput = useRef<HTMLInputElement>(null);
  const transfers = useRef<(data: DataTransfer | null, position?: number) => boolean>(() => false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const titleInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const trashed = note.location === "trashed";
  const readOnly = trashed || busy || !!viewOnly;
  const handler = useRef(change);
  handler.current = change;
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: notesExtensions(session.fetch, session.storageUrl),
      content: draft.body,
      editable: !readOnly,
      editorProps: {
        handlePaste: (_view, event) => transfers.current(event.clipboardData),
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          return transfers.current(event.dataTransfer, position);
        },
        attributes: {
          "aria-label": "Note body",
          role: "textbox",
          "aria-multiline": "true",
          spellcheck: "true",
        },
      },
      onSelectionUpdate: () => selectionChanged((value) => value + 1),
      onUpdate: ({ editor }) => {
        if (!actionPending.current && !readOnly) handler.current({ body: editor.getHTML() });
      },
    },
    [note.url],
  );
  const chooseImage = (file: File, transfer?: RichImageTransfer) => {
    if (readOnly || image) return false;
    const error = (transfer?.images.map((item) => item.file) ?? [file])
      .map(validateImage)
      .find(Boolean);
    if (error) {
      toast.error(error);
      return false;
    }
    setImage({ file, ...(transfer ? { transfer } : {}) });
    return true;
  };
  transfers.current = (data, position) => {
    if (readOnly || image) return true;
    try {
      const incoming = imageTransfer(data);
      if (!incoming) return false;
      if (position !== undefined) editor?.commands.setTextSelection(position);
      // Consume rejected local images too: they must never fall through to HTML insertion.
      chooseImage(incoming.file, incoming.rich);
      return true;
    } catch {
      toast.error("Couldn't read this image. Add it as a file.");
      return true;
    }
  };
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
    if (image || actionPending.current) return false;
    actionPending.current = true;
    // Apply the DOM/editor lock synchronously, before flush can take its snapshot.
    if (titleInput.current) titleInput.current.readOnly = true;
    editor?.setEditable(false, false);
    setBusy(true);
    return true;
  };
  const unlock = () => {
    actionPending.current = false;
    const locked =
      trashed ||
      note.readOnly ||
      getPendingDrafts(session.webId).get(note.url)?.status === "read-only";
    if (titleInput.current) titleInput.current.readOnly = !!locked;
    editor?.setEditable(!locked, false);
    setBusy(false);
  };
  const close = async () => {
    if (!lock()) return;
    try {
      if (!viewOnly) await flush();
      closeNote();
    } catch {
      unlock();
    }
  };
  const act = (work: (saved: StoredNote) => Promise<unknown>) => {
    if (!lock()) return Promise.resolve();
    return flush()
      .then(work)
      .catch((error) => {
        if (error instanceof NoteMoveBlockedError) reportError(error);
        else toast.error("Couldn't complete that action. Your note is still here.");
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
          id: "image",
          label: "Add image",
          icon: <ImagePlus size={16} />,
          onSelect: () => imageInput.current?.click(),
        },
        ...(editor.isActive("image")
          ? [
              {
                id: "image-alt",
                label: "Edit alt text",
                icon: <ImagePlus size={16} />,
                onSelect: () => setImage({ file: null }),
              },
              {
                id: "image-remove",
                label: "Remove image",
                icon: <Trash2 size={16} />,
                onSelect: () => {
                  editor.chain().focus().deleteSelection().run();
                },
              },
            ]
          : []),
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
        <DialogTitle className="sr-only">{viewOnly ? "View note" : "Edit note"}</DialogTitle>
        <DialogDescription className="sr-only">
          {viewOnly
            ? "View only. Your local changes remain recoverable."
            : "Your changes save automatically to your pod."}
        </DialogDescription>
        <Input
          ref={titleInput}
          className="notes-title-input"
          aria-label="Note title"
          placeholder="Title"
          value={draft.title}
          readOnly={readOnly}
          onChange={(event) => {
            if (!actionPending.current && !readOnly) change({ title: event.target.value });
          }}
        />
        <input
          ref={imageInput}
          type="file"
          hidden
          aria-label="Choose note image"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) chooseImage(file);
            event.target.value = "";
          }}
        />
        {image && editor && (
          <ImageUpload
            editor={editor}
            className="notes-image-upload"
            file={image.file}
            transfer={image.transfer}
            uploadFile={(file) => store.uploadImage(file)}
            close={() => setImage(undefined)}
          />
        )}
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
        {status === "conflict" && !viewOnly && (
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
        {viewOnly && (
          <div className="notes-conflict">
            <p>View only. Your local changes are kept on this device.</p>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${draft.title}\n${draft.body}`);
                } catch {
                  toast.error("Couldn't copy. Download your changes instead.");
                }
              }}
            >
              Copy local changes
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([`${draft.title}\n${draft.body}`], { type: "text/plain" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = "note.txt";
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download local changes
            </Button>
          </div>
        )}
        <footer className="notes-dialog-footer">
          <LabelChips links={false} labels={draft.labels} />
          <ReminderChip value={note.reminder} now={new Date(now)} />
          <div className="notes-dialog-actions">
            {viewOnly ? null : trashed ? (
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
                <ReminderPicker
                  disabled={busy}
                  value={note.reminder}
                  onChange={(reminder) =>
                    void act(async (saved) => {
                      const updated = await mutations.save(saved, { reminder });
                      accept(updated);
                      if (reminder) offerReminderPermission(session.webId);
                      unlock();
                    })
                  }
                />
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
                {hasOpenItems(checklist) && (
                  <Button variant="ghost" disabled={busy} onClick={() => setSendingTasks(true)}>
                    <ListTodo size={16} aria-hidden="true" />
                    Add to Tasks
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(async (saved) => {
                      setSharing(saved);
                      unlock();
                    })
                  }
                >
                  <Share2 size={16} aria-hidden="true" />
                  Collaborator
                </Button>
              </>
            )}
          </div>
          <div className="notes-dialog-status">
            <span role="status" aria-live="polite">
              {viewOnly
                ? "View only — autosave stopped"
                : status === "saved"
                  ? "Saved"
                  : status === "saving"
                    ? "Saving…"
                    : status === "conflict"
                      ? "Changes need review"
                      : "Couldn't save — "}
              {status === "failed" && !viewOnly && (
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
      {sendingTasks && (
        <SendToTasksDialog
          items={checklist}
          noteKey={note.created ?? note.url}
          session={session}
          close={() => setSendingTasks(false)}
        />
      )}
      {confirmDocs && (
        <ConfirmDialog
          title="Open in Docs?"
          description="This note moves to Trash in Notes, and you can restore it from there."
          close={() => setConfirmDocs(false)}
          confirm={() =>
            act(async (saved) => {
              await store.assertMovable(saved);
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
