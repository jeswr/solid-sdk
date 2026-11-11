// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { podScopedFetch } from "@jeswr/suite-sdk/pod-scoped-fetch";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from "@jeswr/suite-ui";
import { type Editor, EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import { ySyncPluginKey, yUndoPluginKey, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { baseExtensions } from "../editor/extensions";
import type { DocumentPersistence } from "../editor/persistence";
import { useDialogFocus } from "../hooks/use-dialog-focus";
import { suggestionAction } from "../lib/editor/suggestions";
import { versionDisabledReason } from "../lib/editor/versions";
import { docContainerUrls } from "../lib/model/layout";
import { type DocumentVersion, DocumentVersionStore, versionError } from "../lib/model/versions";
import { Hint } from "./common";
import { PageCanvas } from "./page-canvas";

export function VersionAction({
  reason,
  children,
  run,
  busy = false,
}: {
  reason: string | undefined;
  children: ReactNode;
  run: () => void;
  busy?: boolean;
}) {
  const id = useId();
  return (
    <>
      <Hint text={reason}>
        <Button
          aria-disabled={!!reason || busy}
          aria-describedby={reason ? id : undefined}
          onClick={() => {
            if (!reason && !busy) run();
          }}
        >
          {children}
        </Button>
      </Hint>
      {reason && (
        <span id={id} className="su-sr-only">
          {reason}
        </span>
      )}
    </>
  );
}

export function VersionPreview({ json, http }: { json: JSONContent; http: typeof fetch }) {
  const preview = useEditor(
    {
      immediatelyRender: false,
      extensions: baseExtensions(http),
      content: json,
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
    [json, http],
  );
  return <EditorContent editor={preview} />;
}

/** The preview owns an independent editor and never attaches a persistence provider. */
export function VersionHistory({
  runtime,
  editor,
  title,
  zoom,
  open,
  close,
  naming,
  closeNaming,
}: {
  runtime: DocumentPersistence;
  editor: Editor;
  title: string;
  zoom: number;
  open: boolean;
  close: () => void;
  naming: boolean;
  closeNaming: () => void;
}) {
  const namingFocus = useDialogFocus();
  const restoreFocus = useDialogFocus();
  const resource = runtime.stored?.url;
  const http = useMemo(
    () => podScopedFetch(runtime.session.fetch, runtime.session.storageUrl),
    [runtime.session],
  );
  const store = useMemo(
    () =>
      resource ? new DocumentVersionStore(docContainerUrls(resource).versions, http) : undefined,
    [resource, http],
  );
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [selected, setSelected] = useState<DocumentVersion>();
  const [preview, setPreview] = useState<JSONContent>();
  const [error, setError] = useState<string>();
  const [nameError, setNameError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const request = useRef(0);
  const reason = versionDisabledReason(!!resource, runtime.readOnly, runtime.online);
  const headingId = useId();
  const nameId = useId();
  useEffect(() => {
    if (!open) return;
    origin.current = document.activeElement as HTMLElement;
    heading.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    };
    addEventListener("keydown", onEscape);
    return () => {
      removeEventListener("keydown", onEscape);
      origin.current?.focus();
    };
  }, [open, close]);
  useEffect(() => {
    if (!open) {
      request.current++;
      setSelected(undefined);
      setPreview(undefined);
      setConfirm(false);
      return;
    }
    let active = true;
    setError(undefined);
    if (!store) {
      setError("Save this document to your pod to see its version history.");
      return;
    }
    setLoading(true);
    void store
      .list()
      .then(
        (entries) => {
          if (active) setVersions(entries);
        },
        (cause: unknown) => {
          if (active) setError(versionError(cause));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [store, open]);
  // Hide editing controls' target while history is open, including the current-version view.
  useEffect(() => {
    editor.setEditable(!runtime.readOnly && !open, false);
    return () => {
      if (!editor.isDestroyed) editor.setEditable(!runtime.readOnly, false);
    };
  }, [editor, open, runtime.readOnly]);
  const choose = async (version: DocumentVersion) => {
    const sequence = ++request.current;
    setSelected(version);
    setPreview(undefined);
    setError(undefined);
    setLoading(true);
    try {
      if (!store || !runtime.stored?.data.instanceId)
        throw new Error(
          "This document's identity is unavailable. Reopen it before previewing versions.",
        );
      const snapshot = await store.load(version, runtime.stored.data.instanceId);
      try {
        const json = yXmlFragmentToProsemirrorJSON(
          snapshot.getXmlFragment("prosemirror"),
        ) as JSONContent;
        editor.schema.nodeFromJSON(json).check();
        if (sequence === request.current) setPreview(json);
      } finally {
        snapshot.destroy();
      }
    } catch (cause) {
      if (sequence === request.current) setError(versionError(cause));
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  };
  const nameCurrent = async () => {
    if (reason || busy || !store || !name.trim()) return;
    setBusy(true);
    setNameError(undefined);
    try {
      const version = await store.create(runtime.doc, {
        kind: "named",
        name: name.trim(),
        creator: runtime.session.webId,
      });
      setVersions((prior) => [version, ...prior]);
      setName("");
      closeNaming();
    } catch (cause) {
      setNameError(versionError(cause));
    } finally {
      setBusy(false);
    }
  };
  const restore = async (versions: DocumentVersionStore, content: JSONContent) => {
    setBusy(true);
    setError(undefined);
    try {
      // A failed safety snapshot aborts restore without changing the live document.
      await versions.create(runtime.doc, {
        kind: "automatic",
        name: "Before restore",
        creator: runtime.session.webId,
      });
      // Recheck permissions/connectivity after the asynchronous write.
      if (versionDisabledReason(!!runtime.stored, runtime.readOnly, runtime.online))
        throw new Error("Reconnect with edit access before restoring this version.");
      // One Yjs transaction, so collaborators receive the restore atomically. It
      // carries ySyncPluginKey, the origin Collaboration's undo manager tracks
      // (an untagged outer transaction would retag the edit and leave it out of
      // the undo stack). stopCapturing keeps the restore its own undo step.
      yUndoPluginKey.getState(editor.state)?.undoManager.stopCapturing();
      // Tagged so suggesting mode neither blocks nor rewrites a restore.
      runtime.doc.transact(
        () => editor.chain().setMeta(suggestionAction, true).setContent(content).run(),
        ySyncPluginKey,
      );
      await runtime.flush();
      setConfirm(false);
      close();
    } catch (cause) {
      setConfirm(false);
      setError(versionError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageCanvas zoom={zoom} title={title}>
        <div hidden={open && !!selected}>
          <EditorContent editor={editor} />
        </div>
        {open &&
          selected &&
          (preview ? (
            <VersionPreview json={preview} http={http} />
          ) : (
            <p role="status">
              {loading ? "Loading version…" : "This version couldn't be previewed."}
            </p>
          ))}
      </PageCanvas>
      {open && (
        <aside className="docs-version-history" aria-labelledby={headingId}>
          <h2 id={headingId} ref={heading} tabIndex={-1}>
            Version history
          </h2>
          <Button variant="ghost" onClick={close}>
            Back to editing
          </Button>
          {error && <p role="alert">{error}</p>}
          {loading && <p role="status">Loading versions…</p>}
          <ul aria-label="Document versions">
            <li>
              <button
                type="button"
                aria-current={!selected ? "true" : undefined}
                onClick={() => {
                  request.current++;
                  setSelected(undefined);
                  setPreview(undefined);
                  setLoading(false);
                  setError(undefined);
                }}
              >
                Current version
              </button>
            </li>
            {versions.map((version) => (
              <li key={version.url}>
                <button
                  type="button"
                  aria-current={selected?.url === version.url ? "true" : undefined}
                  onClick={() => void choose(version)}
                >
                  <span>{version.name || new Date(version.created).toLocaleString()}</span>
                  <small>
                    {version.creator === runtime.session.webId
                      ? runtime.session.displayName
                      : version.creator || "Unknown author"}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <VersionAction reason={reason} busy={busy || !preview} run={() => setConfirm(true)}>
              Restore this version
            </VersionAction>
          )}
        </aside>
      )}
      <Dialog
        open={naming}
        onOpenChange={() => {
          setNameError(undefined);
          closeNaming();
        }}
      >
        <DialogContent {...namingFocus}>
          <DialogTitle>Name current version</DialogTitle>
          <DialogDescription>Save a named snapshot of this document.</DialogDescription>
          <label htmlFor={nameId}>Version name</label>
          <Input
            id={nameId}
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void nameCurrent();
            }}
          />
          {nameError && <p role="alert">{nameError}</p>}
          <VersionAction reason={reason} busy={busy || !name.trim()} run={() => void nameCurrent()}>
            Save version
          </VersionAction>
          <Button
            variant="outline"
            onClick={() => {
              setNameError(undefined);
              closeNaming();
            }}
          >
            Cancel
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent {...restoreFocus}>
          <DialogTitle>Restore this version?</DialogTitle>
          <DialogDescription>
            This replaces the current content for everyone. A “Before restore” version will save
            your current content first.
          </DialogDescription>
          {store && preview && (
            <VersionAction reason={reason} busy={busy} run={() => void restore(store, preview)}>
              Restore
            </VersionAction>
          )}
          <Button variant="outline" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
