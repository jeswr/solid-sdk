// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex
"use client";
import {
  AppIcon,
  Avatar,
  AvatarFallback,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Kbd,
  toast,
} from "@jeswr/suite-ui";
import { useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { ArrowLeft, ImagePlus, Star } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { encodeRef } from "@/lib/refs";
import type { PodSession } from "@/lib/session/pod-session";
import { editorActions } from "../editor/actions";
import { copyDocument } from "../editor/copy";
import { downloadDocument } from "../editor/export-document";
import { editorExtensions } from "../editor/extensions";
import { focusDocument } from "../editor/focus";
import { imageTransfer, type RichImageTransfer } from "../editor/image-transfer";
import { convertImport, uploadImportImage } from "../editor/import-document";
import type { DocumentPersistence } from "../editor/persistence";
import { printDocument } from "../editor/print-document";
import { podScopedFetch } from "../editor/private-image";
import { useDialogFocus } from "../hooks/use-dialog-focus";
import { useDocument } from "../hooks/use-document";
import { useDocumentComments } from "../hooks/use-document-comments";
import { useDocumentSharing } from "../hooks/use-document-sharing";
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
import { suggestionAction, suggestionKey } from "../lib/editor/suggestions";
import { versionDisabledReason } from "../lib/editor/versions";
import { DocsError, DocsSidebar, DocumentSkeleton } from "./common";
import { DeleteDialog } from "./delete-dialog";
import { EditorMenubar } from "./editor-menubar";
import { CountPopover, LinkPopover } from "./editor-popovers";
import { BlockSelect, EditorToolbar, ToolButton } from "./editor-toolbar";
import { FindBar } from "./find-bar";
import { ImageUpload } from "./image-upload";
import { ImportDialog } from "./import-dialog";
import { InlineTitle } from "./inline-title";
import { OutlinePane } from "./outline-pane";
import { SaveIndicator } from "./save-indicator";
import { SlashMenu, type SlashPosition } from "./slash-menu";
import {
  ResolveAllSuggestions,
  SuggestionModeSwitch,
  SuggestionPopover,
} from "./suggestion-controls";
import { TableActions } from "./table-actions";
import { trashDocumentWithUndo } from "./trash-actions";
import { VersionHistory } from "./version-history";
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
  const conflictFocus = useDialogFocus();
  const saveErrorFocus = useDialogFocus();
  const router = useRouter();
  const params = useSearchParams();
  const printed = useRef(false);
  const printAbort = useRef<AbortController | null>(null);
  const [importing, setImporting] = useState(false);
  const [history, setHistory] = useState(false);
  // Local to this mounted document; never written to Yjs or shared preferences.
  const [suggesting, setSuggesting] = useState(false);
  const [resolveAll, setResolveAll] = useState<boolean | null>(null);
  const [namingVersion, setNamingVersion] = useState(false);
  const closeHistory = useCallback(() => setHistory(false), []);
  const closeNamingVersion = useCallback(() => setNamingVersion(false), []);
  const titleRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLAnchorElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const userEdited = useRef(false);
  const [title, setTitle] = useState(runtime.title);
  const sharing = useDocumentSharing(
    runtime.session,
    runtime.stored?.url,
    title,
    runtime.online,
    runtime.readOnly,
  );
  const [revision, setRevision] = useState(0);
  const [, updateSelection] = useState(0);
  const [mac, setMac] = useState(false);
  const [find, setFind] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);
  const openFind = () => {
    setFind(true);
    findRef.current?.focus();
  };
  const [link, setLink] = useState(false);
  const [count, setCount] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [help, setHelp] = useState(false);
  const [why, setWhy] = useState(false);
  const [outline, setOutline] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [slash, setSlash] = useState<SlashPosition | null>(null);
  const [image, setImage] = useState<{
    file: File | null;
    transfer?: RichImageTransfer;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const handlers = useRef({
    image: (_file: File, _transfer?: RichImageTransfer): boolean => false,
    transfer: (_transfer: DataTransfer | null, _position?: number): boolean => false,
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
          tabindex: "0",
          role: "textbox",
          "aria-label": "Document body",
          "aria-multiline": "true",
          spellcheck: "true",
        },
        // ProseMirror skips handleKeyDown when editable is false.
        handleDOMEvents: {
          keydown: (view, event) => !view.editable && handlers.current.key(event),
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
          if (!handlers.current.transfer(event.clipboardData)) return false;
          event.preventDefault();
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          if (!handlers.current.transfer(event.dataTransfer, position)) return false;
          event.preventDefault();
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
  const comments = useDocumentComments(runtime, editor);
  const changeSuggesting = (enabled: boolean) => {
    if (!editor?.isEditable || runtime.readOnly || history) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(suggestionKey, { enabled, author: runtime.session.webId }),
    );
    setSuggesting(enabled);
    focusDocument(editor);
  };
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    // On a phone the outline would take half the screen; it starts hidden there.
    if (window.matchMedia?.("(max-width: 767px)").matches) setOutline(false);
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
        (event.ctrlKey || event.metaKey) &&
        event.altKey &&
        event.shiftKey &&
        event.code === "KeyH"
      ) {
        event.preventDefault();
        setHistory(true);
      }
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
  const print = useCallback(() => {
    if (!editor) return;
    printAbort.current?.abort();
    const abort = new AbortController();
    printAbort.current = abort;
    void printDocument(editor.view.dom, abort.signal);
  }, [editor]);
  useEffect(() => {
    let frame: number | undefined;
    if (editor && params.get("print") === "1" && !printed.current) {
      printed.current = true;
      frame = requestAnimationFrame(print);
    }
    // Both entry points belong to this editor, including repeated menu actions.
    return () => {
      printAbort.current?.abort();
      if (frame !== undefined) cancelAnimationFrame(frame);
      printed.current = false;
    };
  }, [editor, params, print]);
  handlers.current.image = (file, transfer) => {
    if (!runtime.online) {
      toast.error("Reconnect to add images");
      return false;
    }
    const message = (transfer?.images.map((image) => image.file) ?? [file])
      .map(validateImage)
      .find(Boolean);
    if (message) {
      toast.error(message);
      return false;
    }
    setImage({ file, ...(transfer ? { transfer } : {}) });
    return true;
  };
  handlers.current.transfer = (transfer, position) => {
    try {
      const image = imageTransfer(transfer);
      if (!image) return false;
      if (position !== undefined) editor?.commands.setTextSelection(position);
      return handlers.current.image(image.file, image.rich);
    } catch {
      toast.error("Couldn't read an embedded image. Copy it again or add it as a file.");
      return false;
    }
  };
  handlers.current.key = (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.altKey &&
      event.code === "KeyM" &&
      // Windows reports AltGr as Ctrl+Alt; AltGr+M types a character (µ).
      !event.getModifierState("AltGraph") &&
      !history
    ) {
      event.preventDefault();
      comments.add();
      return true;
    }
    if (history) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeHistory();
        return true;
      }
      return false;
    }
    const action = editorShortcut(
      event.key,
      event.ctrlKey || event.metaKey,
      event.shiftKey,
      event.altKey,
    );
    if (runtime.readOnly && action === "link") return false;
    if (action) {
      event.preventDefault();
      if (action === "save") void runtime.forceSave();
      if (action === "find") openFind();
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
  const commitTitle = (value: string) => {
    const committed = value.trim() || "Untitled document";
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
    find: openFind,
    count: () => setCount(true),
  };
  const actions = editor ? editorActions(editor, opens) : [];
  if (editor?.isActive("image"))
    actions.push({
      label: "Alt text",
      icon: ImagePlus,
      keys: "",
      opensControl: true,
      run: () => setImage({ file: null }),
    });
  return (
    <div className="docs-editor-shell" data-outline={outline ? "open" : "closed"}>
      <SuiteFrame
        app="docs"
        sidebar={<DocsSidebar />}
        context={
          <div className="docs-title-context">
            <Link ref={topRef} href="/docs" className="docs-back" aria-label="Back to documents">
              <ArrowLeft aria-hidden="true" size={20} />
            </Link>
            <span className="docs-title-icon">
              <AppIcon app="docs" size={32} decorative />
            </span>
            <InlineTitle
              title={title}
              readOnly={runtime.readOnly || history}
              inputRef={titleRef}
              stage={(value) => {
                setTitle(value);
                runtime.stageTitle(value);
              }}
              commit={commitTitle}
              done={() => {
                if (editor) focusDocument(editor);
              }}
              cancel={() => topRef.current?.focus()}
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
              state={
                runtime.trashed || !runtime.online || runtime.localState !== "saved"
                  ? runtime.localState
                  : runtime.state
              }
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
            {sharing.button}
            <div
              className="docs-account"
              role="img"
              aria-label={`Account: ${runtime.session.displayName}`}
              title={`${runtime.session.displayName} · ${runtime.session.webId}`}
            >
              <Avatar>
                <AvatarFallback>
                  {runtime.session.displayName.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
          </>
        }
      >
        {editor && (
          <EditorMenubar
            editor={editor}
            actions={actions}
            mac={mac}
            online={runtime.online}
            outline={outline}
            setOutline={setOutline}
            zoom={zoom}
            setZoom={setZoom}
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
            print={print}
            importFile={() => setImporting(true)}
            draft={!runtime.stored}
            readOnly={runtime.readOnly || history}
            showHistory={() => setHistory(true)}
            nameVersion={() => setNamingVersion(true)}
            versionReason={versionDisabledReason(
              !!runtime.stored,
              runtime.readOnly,
              runtime.online,
            )}
            suggesting={suggesting}
            setSuggesting={changeSuggesting}
            resolveSuggestions={setResolveAll}
            addComment={comments.add}
            commentReason={comments.reason}
            share={sharing.open}
            shareDisabledReason={sharing.disabledReason}
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
            help={() => setHelp(true)}
          />
        )}
        {sharing.dialog}
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
              // Tagged so suggesting mode neither blocks nor rewrites a whole-document import.
              editor.chain().setMeta(suggestionAction, true).setContent(imported.json).run();
              return { skipped: imported.skipped, done: () => focusDocument(editor) };
            }}
          />
        )}
        {!runtime.online && <p className="docs-view-only">{status}</p>}
        {runtime.readOnly && (
          <p className="docs-view-only">View only — ask the owner for edit access</p>
        )}
        {editor && !runtime.readOnly && !history && (
          <EditorToolbar
            editor={editor}
            actions={actions}
            mac={mac}
            online={runtime.online}
            print={print}
            zoom={zoom}
            setZoom={setZoom}
            outline={outline}
            toggleOutline={() => setOutline((value) => !value)}
            modeControl={<SuggestionModeSwitch suggesting={suggesting} change={changeSuggesting} />}
          />
        )}
        {editor && !history && comments.controls}
        {find && editor && !history && (
          <FindBar
            editor={editor}
            revision={revision}
            close={() => setFind(false)}
            inputRef={findRef}
          />
        )}
        <div className="docs-writing-area">
          {outline && !history && (
            <aside className="docs-outline-pane" aria-label="Document outline pane">
              <OutlinePane
                editor={editor}
                revision={revision}
                close={() => {
                  setOutline(false);
                  // The pane's own button goes away: land on the toolbar's outline toggle,
                  // or the document when the toolbar is absent (view only).
                  const toggle = document.querySelector<HTMLElement>("[data-docs-outline-toggle]");
                  if (toggle) toggle.focus();
                  else if (editor) focusDocument(editor);
                }}
              />
            </aside>
          )}
          {editor ? (
            <VersionHistory
              runtime={runtime}
              editor={editor}
              title={title}
              zoom={zoom}
              open={history}
              close={closeHistory}
              naming={namingVersion}
              closeNaming={closeNamingVersion}
            />
          ) : (
            <DocumentSkeleton message="Syncing…" />
          )}
          {!history && comments.sidebar}
        </div>
        {editor && !runtime.readOnly && !history && (
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
        {slash && editor && !history && (
          <SlashMenu
            editor={editor}
            position={slash}
            close={() => setSlash(null)}
            image={opens.image}
          />
        )}
        {editor && !runtime.readOnly && !history && <SuggestionPopover editor={editor} />}
        {editor && resolveAll !== null && !runtime.readOnly && !history && (
          <ResolveAllSuggestions
            editor={editor}
            accept={resolveAll}
            close={() => setResolveAll(null)}
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
            {...(image.transfer ? { transfer: image.transfer } : {})}
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
              if (editor) focusDocument(editor, { scrollIntoView: false });
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
          <DialogContent {...conflictFocus}>
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
          <DialogContent {...saveErrorFocus}>
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
              const complete = await trashDocumentWithUndo(url, runtime.session, (restoredUrl) => {
                if (restoredUrl) router.push(`/docs/d/${encodeRef(restoredUrl)}`);
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
