// AUTHORED-BY Codex
"use client";
import {
  AppIcon,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
  Kbd,
  toast,
} from "@jeswr/suite-ui";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { ArrowLeft, ImagePlus, Share2, Star } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { encodeRef } from "@/lib/refs";
import type { PodSession } from "@/lib/session/pod-session";
import { editorActions } from "../editor/actions";
import { copyDocument } from "../editor/copy";
import { downloadDocument } from "../editor/export-document";
import { editorExtensions } from "../editor/extensions";
import { convertImport, uploadImportImage } from "../editor/import-document";
import type { DocumentPersistence } from "../editor/persistence";
import { printDocument } from "../editor/print-document";
import { podScopedFetch } from "../editor/private-image";
import { useDocument } from "../hooks/use-document";
import { useNow } from "../hooks/use-now";
import { useStarred } from "../hooks/use-starred";
import {
  deviceSaveStatus,
  editorShortcut,
  keyboardLabel,
  saveStatus,
  shortcuts,
  slashQuery,
  validateImage,
  wordCount,
} from "../lib/editor/logic";
import { DocsError, DocsSidebar, DocumentSkeleton, Hint } from "./common";
import { DeleteDialog } from "./delete-dialog";
import { CountPopover, LinkPopover } from "./editor-popovers";
import { BlockSelect, EditorToolbar, ToolButton } from "./editor-toolbar";
import { FileMenu } from "./file-menu";
import { FindBar } from "./find-bar";
import { ImageUpload } from "./image-upload";
import { ImportDialog } from "./import-dialog";
import { OutlinePane } from "./outline-pane";
import { SaveIndicator } from "./save-indicator";
import { SlashMenu, type SlashPosition } from "./slash-menu";
import { TableActions } from "./table-actions";
import { trashDocumentWithUndo } from "./trash-actions";
export function DocumentEditor({
  session,
  resource,
}: {
  session: PodSession;
  resource: string | undefined;
}) {
  const { runtime, error, recover } = useDocument(session, resource);
  if (error) {
    const forbidden = error instanceof Error && "status" in error && error.status === 403;
    const missing =
      error instanceof Error &&
      (("status" in error && error.status === 404) || error.message === "not-found");
    return (
      <SuiteFrame app="docs" sidebar={<DocsSidebar />} context="Docs">
        <DocsError
          title={
            missing
              ? "This document isn't here any more"
              : forbidden
                ? "You don't have access to this"
                : "We couldn't open this document"
          }
        >
          {!missing && !forbidden && <Button onClick={recover}>Open last saved copy</Button>}
          <Button asChild variant="outline">
            <Link href="/docs">Go to Documents</Link>
          </Button>
        </DocsError>
      </SuiteFrame>
    );
  }
  if (!runtime || runtime.switchingLog)
    return (
      <SuiteFrame app="docs" sidebar={<DocsSidebar />} context="Opening document…">
        <DocumentSkeleton message="Syncing…" />
      </SuiteFrame>
    );
  return <HydratedEditor key={runtime.doc.guid} runtime={runtime} />;
}
function HydratedEditor({ runtime }: { runtime: DocumentPersistence }) {
  const router = useRouter();
  const params = useSearchParams();
  const printed = useRef(false);
  const [importing, setImporting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLAnchorElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const userEdited = useRef(false);
  const [title, setTitle] = useState(runtime.title);
  const [revision, setRevision] = useState(0);
  const [, updateSelection] = useState(0);
  const [mac, setMac] = useState(false);
  const [find, setFind] = useState(false);
  const [link, setLink] = useState(false);
  const [count, setCount] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [help, setHelp] = useState(false);
  const [why, setWhy] = useState(false);
  const [outline, setOutline] = useState(true);
  const [slash, setSlash] = useState<SlashPosition | null>(null);
  const [image, setImage] = useState<{ file: File | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const handlers = useRef({
    image: (_file: File) => {},
    key: (_event: KeyboardEvent): boolean => false,
  });
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: editorExtensions(
        runtime.doc,
        podScopedFetch(runtime.session.fetch, runtime.session.storageUrl),
      ),
      editable: !runtime.readOnly,
      autofocus: runtime.stored ? false : "start",
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": "Document body",
          "aria-multiline": "true",
          spellcheck: "true",
        },
        handleKeyDown: (_view, event) => {
          if (
            !event.ctrlKey &&
            !event.metaKey &&
            (event.key.length === 1 || ["Enter", "Backspace", "Delete"].includes(event.key))
          )
            userEdited.current = true;
          return handlers.current.key(event);
        },
        handleTextInput: () => {
          userEdited.current = true;
          return false;
        },
        handlePaste: (_view, event) => {
          userEdited.current = true;
          const file = [...(event.clipboardData?.files ?? [])].find((file) =>
            file.type.startsWith("image/"),
          );
          if (!file) return false;
          event.preventDefault();
          handlers.current.image(file);
          return true;
        },
        handleDrop: (_view, event, _slice, moved) => {
          const file = event.dataTransfer?.files[0];
          if (moved || !file) return false;
          event.preventDefault();
          handlers.current.image(file);
          return true;
        },
      },
      onCreate: ({ editor }) => {
        runtime.capture(editor.getHTML(), editor.getJSON());
        void runtime.flush();
      },
      onUpdate: ({ editor, transaction }) => {
        if (runtime.readOnly) return;
        runtime.change(editor.getHTML(), editor.getJSON());
        setRevision((n) => n + 1);
        if (!transaction.getMeta("docsSlashClosed")) {
          const { $from } = editor.state.selection;
          if (editor.state.selection.empty && $from.parent.isTextblock) {
            const query = slashQuery($from.parent.textBetween(0, $from.parentOffset));
            if (query) {
              const coords = editor.view.coordsAtPos($from.pos);
              setSlash({
                from: $from.pos - query.length,
                to: $from.pos,
                left: Math.min(coords.left, window.innerWidth - 300),
                top: coords.bottom,
                query: query.query,
              });
            } else setSlash(null);
          }
        }
      },
      onSelectionUpdate: () => updateSelection((n) => n + 1),
      onTransaction: ({ transaction }) => {
        if (transaction.storedMarksSet) updateSelection((n) => n + 1);
      },
      onBlur: () => {
        void runtime.flush();
      },
    },
    [runtime],
  );
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  useEffect(() => {
    setTitle(runtime.title);
  }, [runtime.title]);
  useEffect(() => {
    document.title = `${title || "Untitled document"} · Docs · Solid Suite`;
  }, [title]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const adjust = () => {
      document.documentElement.dataset.docsKeyboard =
        window.innerHeight - (viewport?.height ?? window.innerHeight) > 100 ? "open" : "closed";
      document.documentElement.style.setProperty(
        "--docs-keyboard-inset",
        `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`,
      );
    };
    viewport?.addEventListener("resize", adjust);
    viewport?.addEventListener("scroll", adjust);
    adjust();
    return () => {
      viewport?.removeEventListener("resize", adjust);
      viewport?.removeEventListener("scroll", adjust);
      document.documentElement.style.removeProperty("--docs-keyboard-inset");
      delete document.documentElement.dataset.docsKeyboard;
    };
  }, []);
  useEffect(() => {
    const outsideKeys = (event: KeyboardEvent) => {
      if (
        event.key === "[" &&
        !(event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]")
      ) {
        event.preventDefault();
        setOutline((value) => !value);
      }
    };
    addEventListener("keydown", outsideKeys);
    return () => removeEventListener("keydown", outsideKeys);
  }, []);
  useEffect(() => {
    if (!editor || params.get("print") !== "1" || printed.current) return;
    printed.current = true;
    const abort = new AbortController();
    const frame = requestAnimationFrame(() => {
      void printDocument(editor.view.dom, abort.signal);
    });
    return () => {
      abort.abort();
      cancelAnimationFrame(frame);
      printed.current = false;
    };
  }, [editor, params]);
  handlers.current.image = (file) => {
    if (!runtime.online) {
      toast.error("Reconnect to add images");
      return;
    }
    const message = validateImage(file);
    if (message) toast.error(message);
    else setImage({ file });
  };
  handlers.current.key = (event) => {
    const action = editorShortcut(
      event.key,
      event.ctrlKey || event.metaKey,
      event.shiftKey,
      event.altKey,
    );
    if (action) {
      event.preventDefault();
      if (action === "save") void runtime.forceSave();
      if (action === "find") setFind(true);
      if (action === "link") setLink(true);
      if (action === "count") setCount(true);
      if (action === "help") setHelp(true);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      titleRef.current?.focus();
      return true;
    }
    return false;
  };
  const { starred, toggle } = useStarred();
  const now = useNow();
  const status = saveStatus(
    runtime.state,
    runtime.localState,
    runtime.online,
    runtime.lastSaved,
    now ?? runtime.lastSaved,
    runtime.readOnly,
  );
  const commitTitle = () => {
    const committed = title.trim() || "Untitled document";
    if (committed !== runtime.title) runtime.rename(committed);
    else void runtime.flush();
    setTitle(runtime.title);
  };
  const act = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch {
      toast.error("We couldn't complete that action. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const opens = {
    link: () => setLink(true),
    image: () => fileRef.current?.click(),
    find: () => setFind(true),
    count: () => setCount(true),
  };
  const actions = editor ? editorActions(editor, opens) : [];
  if (editor?.isActive("image"))
    actions.push({
      label: "Alt text",
      icon: ImagePlus,
      keys: "",
      run: () => setImage({ file: null }),
    });
  return (
    <div className="docs-editor-shell" data-outline={outline ? "open" : "closed"}>
      <SuiteFrame
        app="docs"
        sidebar={<OutlinePane editor={editor} revision={revision} />}
        context={
          <div className="docs-title-context">
            <Link ref={topRef} href="/docs" className="docs-back" aria-label="Back to documents">
              <ArrowLeft aria-hidden="true" size={20} />
            </Link>
            <span className="docs-title-icon">
              <AppIcon app="docs" size={32} decorative />
            </span>
            <Input
              ref={titleRef}
              aria-label="Document title"
              placeholder="Untitled document"
              maxLength={200}
              readOnly={runtime.readOnly}
              className="docs-title-input"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                runtime.stageTitle(event.target.value);
              }}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitTitle();
                  editor?.commands.focus();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  topRef.current?.focus();
                }
              }}
            />
            <IconButton
              label={
                runtime.stored && starred.includes(runtime.stored.url)
                  ? "Unstar document"
                  : "Star document"
              }
              variant="ghost"
              className="docs-star"
              aria-pressed={!!runtime.stored && starred.includes(runtime.stored.url)}
              disabled={!runtime.stored}
              onClick={() => runtime.stored && toggle(runtime.stored.url)}
            >
              <Star aria-hidden="true" />
            </IconButton>
          </div>
        }
        actions={
          <>
            <SaveIndicator
              status={
                runtime.trashed
                  ? `Moved to trash — ${deviceSaveStatus(runtime.localState)}`
                  : status
              }
            />
            {runtime.state === "failed" && !runtime.conflict && (
              <Button variant="link" onClick={() => setWhy(true)}>
                Why?
              </Button>
            )}
            <Hint text="Co-editing isn't available on this storage; changes merge when you reconnect.">
              <Badge className="docs-collab">
                Editing alone — changes merge when others reconnect
              </Badge>
            </Hint>
            <Hint text="Sharing arrives with sign-in">
              <Button disabled className="docs-share" aria-label="Share">
                <Share2 aria-hidden="true" />
                <span>Share</span>
              </Button>
            </Hint>
            <FileMenu
              download={(format) =>
                void act(async () => {
                  if (!editor) return;
                  const name = await downloadDocument(
                    editor.getJSON(),
                    title,
                    format,
                    runtime.session,
                  );
                  toast.success(`Downloaded ${name}`);
                })
              }
              print={() => editor && void printDocument(editor.view.dom)}
              importFile={() => setImporting(true)}
              draft={!runtime.stored}
              readOnly={runtime.readOnly}
              copy={() =>
                void act(async () => {
                  await runtime.flush();
                  if (!runtime.stored) return;
                  const copy = await copyDocument(
                    runtime.store,
                    runtime.stored,
                    runtime.session,
                    editor?.getJSON(),
                  );
                  router.push(`/docs/d/${encodeRef(copy.url)}`);
                })
              }
              rename={() => {
                titleRef.current?.focus();
                titleRef.current?.select();
              }}
              remove={() => setDeleting(true)}
              shortcuts={() => setHelp(true)}
            />
          </>
        }
      >
        {importing && editor && (
          <ImportDialog
            replace
            close={() => setImporting(false)}
            run={async (file, progress) => {
              const imported = await convertImport(
                file,
                runtime.session,
                async (data, type) => {
                  if (!runtime.online) throw new Error("Reconnect to import images");
                  if (!runtime.stored) {
                    runtime.change(editor.getHTML(), editor.getJSON());
                    await runtime.flush();
                  }
                  if (!runtime.stored)
                    throw new Error("Save this document before importing images");
                  return uploadImportImage(runtime.session, runtime.stored.url, data, type);
                },
                progress,
              );
              // setContent is one Yjs transaction and remains undoable through Collaboration.
              editor.commands.setContent(imported.json);
              return { skipped: imported.skipped, done: () => editor.commands.focus() };
            }}
          />
        )}
        {!runtime.online && <p className="docs-view-only">{status}</p>}
        {runtime.readOnly && (
          <p className="docs-view-only">View only — ask the owner for edit access</p>
        )}
        {editor && !runtime.readOnly && (
          <EditorToolbar editor={editor} actions={actions} mac={mac} online={runtime.online} />
        )}
        {find && editor && (
          <FindBar editor={editor} revision={revision} close={() => setFind(false)} />
        )}
        <div className="docs-page-wrap">
          <article className="docs-page" aria-label="Document page">
            <h1 className="sr-only">{title || "Untitled document"}</h1>
            {editor ? <EditorContent editor={editor} /> : <DocumentSkeleton message="Syncing…" />}
          </article>
        </div>
        {editor && !runtime.readOnly && (
          <BubbleMenu
            editor={editor}
            updateDelay={160}
            className="docs-bubble"
            options={{ placement: "top" }}
          >
            <div role="toolbar" aria-label="Selection formatting">
              {actions
                .filter((action) =>
                  ["Bold", "Italic", "Underline", "Strikethrough", "Highlight", "Link"].includes(
                    action.label,
                  ),
                )
                .map((action) => (
                  <ToolButton key={action.label} action={action} mac={mac} />
                ))}
              <BlockSelect editor={editor} label="Turn into" />
              {editor.isActive("table") && <TableActions editor={editor} />}
              {editor.isActive("image") && (
                <Button variant="ghost" onClick={() => setImage({ file: null })}>
                  Alt text
                </Button>
              )}
            </div>
          </BubbleMenu>
        )}
        {slash && editor && (
          <SlashMenu
            editor={editor}
            position={slash}
            close={() => setSlash(null)}
            image={opens.image}
          />
        )}
        {link && editor && <LinkPopover editor={editor} close={() => setLink(false)} />}
        {count && editor && (
          <CountPopover
            editor={editor}
            close={() => setCount(false)}
            pinned={pinned}
            setPinned={setPinned}
          />
        )}
        {image && editor && (
          <ImageUpload
            editor={editor}
            runtime={runtime}
            file={image.file}
            close={() => setImage(null)}
          />
        )}
        {pinned && editor && (
          <Button className="docs-word-pill" variant="secondary" onClick={() => setCount(true)}>
            {wordCount(editor.getJSON()).words} words
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label="Upload image"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handlers.current.image(file);
            event.target.value = "";
          }}
        />
        <Dialog open={help} onOpenChange={setHelp}>
          <DialogContent
            className="docs-shortcuts"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (editor && !editor.isDestroyed)
                editor.commands.focus(undefined, { scrollIntoView: false });
            }}
          >
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>These shortcuts work while you are writing.</DialogDescription>
            <dl>
              {shortcuts.map(([keys, action]) => (
                <div key={keys}>
                  <dt>{action}</dt>
                  <dd>
                    <Kbd>{keyboardLabel(keys, mac)}</Kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </DialogContent>
        </Dialog>
        {runtime.recoveredCopy && (
          <p role="status">
            This document was recovered in another tab. Your pending edits were saved in{" "}
            <Link href={`/docs/d/${encodeRef(runtime.recoveredCopy)}`}>a separate copy</Link>.
          </p>
        )}
        <Dialog open={!!runtime.conflict} onOpenChange={() => {}}>
          <DialogContent>
            <DialogTitle>This title changed somewhere else</DialogTitle>
            <DialogDescription>
              Choose the title to keep. {deviceSaveStatus(runtime.localState)}.
            </DialogDescription>
            <p>Yours: {runtime.conflict?.localTitle}</p>
            <p>Theirs: {runtime.conflict?.remoteTitle}</p>
            <Button onClick={() => void runtime.resolveTitle(true)}>Keep mine</Button>
            <Button variant="outline" onClick={() => void runtime.resolveTitle(false)}>
              Keep theirs
            </Button>
          </DialogContent>
        </Dialog>
        <Dialog open={why} onOpenChange={setWhy}>
          <DialogContent>
            <DialogTitle>Couldn't save</DialogTitle>
            <DialogDescription>
              {deviceSaveStatus(runtime.localState)}. Check your device storage, pod storage and
              edit access, then try again.
            </DialogDescription>
            <Button
              onClick={() => {
                setWhy(false);
                void runtime.flush();
              }}
            >
              Retry
            </Button>
          </DialogContent>
        </Dialog>
        <DeleteDialog
          open={deleting}
          busy={busy}
          onOpenChange={setDeleting}
          onConfirm={() =>
            void act(async () => {
              if (!runtime.stored) return;
              await runtime.flush();
              const url = runtime.stored.url;
              const complete = await trashDocumentWithUndo(url, runtime.session, () => {
                router.push(`/docs/d/${encodeRef(url)}`);
              });
              if (!complete) return;
              if (starred.includes(url)) toggle(url);
              setDeleting(false);
              router.push("/docs");
            })
          }
        />
      </SuiteFrame>
    </div>
  );
}
