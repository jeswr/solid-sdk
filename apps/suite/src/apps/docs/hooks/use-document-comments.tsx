// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommentsControls, CommentsSidebar } from "../components/comments-sidebar";
import { documentScopedFetch } from "../editor/document-fetch";
import type { DocumentPersistence } from "../editor/persistence";
import { captureCommentAnchor, resolveCommentAnchor } from "../lib/editor/comment-anchors";
import { commentKey } from "../lib/editor/comment-decorations";
import {
  type CommentAnchor,
  type CommentThread,
  commentDisabledReason,
  commentError,
  type DocumentComment,
  DocumentCommentStore,
} from "../lib/model/comments";
import { docContainerUrls } from "../lib/model/layout";
import { useCommentAuthors } from "./use-comment-authors";

export function useDocumentComments(runtime: DocumentPersistence, editor: Editor | null) {
  const resource = runtime.stored?.url;
  const store = useMemo(
    () =>
      resource
        ? new DocumentCommentStore(
            docContainerUrls(resource).comments,
            resource,
            documentScopedFetch(runtime.session, () => resource),
          )
        : undefined,
    [resource, runtime.session],
  );
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const authorName = useCommentAuthors(runtime.session, threads);
  const [active, setActive] = useState<string>();
  // A new object per highlight click, so re-clicking the active thread refocuses it.
  const [focusRequest, setFocusRequest] = useState<{ url: string }>();
  const [composer, setComposer] = useState<CommentAnchor>();
  const [error, setError] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [showResolved, setShowResolved] = useState(false);
  const [, redraw] = useState(0);
  const origin = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  const request = useRef(0);
  const reason = commentDisabledReason(!!resource, runtime.online);
  const selectionReason =
    reason ??
    (!editor ||
    editor.state.selection.empty ||
    !editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to).trim()
      ? "Select text to comment on."
      : undefined);
  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    if (!store || !editor) return;
    try {
      const rows = await store.list((comment) =>
        comment.anchor ? resolveCommentAnchor(editor.state, comment.anchor)?.from : undefined,
      );
      if (sequence === request.current) {
        setThreads(rows);
        setLoadError(undefined);
      }
    } catch (cause) {
      if (sequence === request.current) setLoadError(commentError(cause));
    }
  }, [store, editor]);
  useEffect(() => {
    setThreads([]);
    setComposer(undefined);
    setActive(undefined);
    void refresh();
    return () => {
      request.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (open) void refresh();
    const focus = () => void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", focus);
    const timer = open ? window.setInterval(tick, 30_000) : undefined;
    return () => {
      window.removeEventListener("focus", focus);
      window.clearInterval(timer);
      request.current++;
    };
  }, [open, refresh]);
  const activate = useCallback((url: string) => {
    setActive(url);
    setFocusRequest({ url });
    setOpen(true);
  }, []);
  const visible = threads
    .filter(({ root }) => showResolved || !root.resolved)
    .sort((a, b) => {
      const position = (comment: DocumentComment) =>
        editor && comment.anchor
          ? (resolveCommentAnchor(editor.state, comment.anchor)?.from ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
      return position(a.root) - position(b.root);
    });
  useEffect(() => {
    if (!editor) return;
    const decorate = () => {
      if (!editor.isDestroyed)
        editor.view.dispatch(
          editor.state.tr
            .setMeta(commentKey, {
              comments: threads
                .filter(({ root }) => showResolved || !root.resolved)
                .map(({ root }) => root),
              active,
              activate,
            })
            .setMeta("addToHistory", false),
        );
    };
    const update = () => {
      decorate();
      redraw((value) => value + 1);
    };
    decorate();
    editor.on("update", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("update", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor, threads, active, activate, showResolved]);
  const close = () => {
    setOpen(false);
    setComposer(undefined);
    origin.current?.focus();
  };
  const cancel = () => {
    setComposer(undefined);
    editor?.view.focus();
  };
  const add = () => {
    if (selectionReason || !editor) return;
    try {
      const anchor = captureCommentAnchor(editor.state);
      origin.current = document.activeElement as HTMLElement;
      setComposer(anchor);
      setOpen(true);
      setError(undefined);
    } catch (cause) {
      setError(commentError(cause));
      setOpen(true);
    }
  };
  const act = async (task: (store: DocumentCommentStore) => Promise<unknown>) => {
    if (reason || !store || pending.current) return false;
    pending.current = true;
    setError(undefined);
    try {
      await task(store);
      await refresh();
      return true;
    } catch (cause) {
      setError(commentError(cause));
      // Pick up fresh ETags, so "try again" after a concurrent change can succeed.
      await refresh();
      return false;
    } finally {
      pending.current = false;
    }
  };
  const select = (comment: DocumentComment) => {
    setActive(comment.url);
    const range = editor && comment.anchor && resolveCommentAnchor(editor.state, comment.anchor);
    if (range) {
      editor.commands.setTextSelection(range);
      editor.commands.scrollIntoView();
      editor.view.focus();
    }
  };
  return {
    add,
    reason: selectionReason,
    controls: (
      <CommentsControls
        count={threads.filter(({ root }) => !root.resolved).length}
        open={open}
        toggle={() => {
          if (open) close();
          else {
            origin.current = document.activeElement as HTMLElement;
            setOpen(true);
          }
        }}
        add={add}
        reason={selectionReason}
      />
    ),
    sidebar: open ? (
      <CommentsSidebar
        threads={visible}
        authorName={authorName}
        active={active}
        focusRequest={focusRequest}
        composer={composer}
        reason={reason}
        error={error ?? loadError}
        webId={runtime.session.webId}
        showResolved={showResolved}
        setShowResolved={setShowResolved}
        select={select}
        close={close}
        cancel={cancel}
        create={(text) =>
          act(async (current) => {
            if (!composer || !editor) return;
            // Retain the captured Yjs positions while typing in the sidebar.
            const root = await current.create(text, runtime.session.webId, composer);
            setActive(root.url);
          })
        }
        actions={{
          reply: (root, text) => act((current) => current.reply(root, text, runtime.session.webId)),
          edit: (comment, text) =>
            act((current) => current.edit(comment, text, runtime.session.webId)),
          delete: (comment) => act((current) => current.delete(comment, runtime.session.webId)),
          resolve: (root, resolved) =>
            act((current) => current.setResolved(root, resolved, runtime.session.webId)),
        }}
        orphan={(comment) =>
          !editor || !comment.anchor || !resolveCommentAnchor(editor.state, comment.anchor)
        }
      />
    ) : null,
  };
}
