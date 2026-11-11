// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@jeswr/suite-ui";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { usePodSessionState } from "@/lib/session/pod-session";
import { currentCommentAnchor, type DraftAnchor } from "../lib/comments/anchors";
import type { CellAnchor } from "../lib/comments/selector";
import {
  type CellComment,
  CellCommentStore,
  type CellThread,
  type CommentPermissions,
  MAX_COMMENT_LENGTH,
} from "../lib/comments/store";
import type { SheetEngine } from "../lib/contract";

function CommentHint({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: exposes the disabled button's reason to keyboard users */}
          <span tabIndex={0} title={reason}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function WorkbookComments({
  container,
  engine,
  onLoadingChange,
}: {
  container: string;
  engine: SheetEngine | null;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const state = usePodSessionState();
  const session = state.status === "ready" ? state.session : undefined;
  const store = useMemo(() => {
    if (!session) return undefined;
    let local = true;
    try {
      assertWithinPodScope(session.storageUrl, container);
    } catch {
      local = false;
    }
    const transport: typeof fetch = local
      ? session.fetch
      : (input, init) => {
          if (init?.method && !["GET", "HEAD"].includes(init.method))
            throw new Error("This shared spreadsheet is view only.");
          return (("publicFetch" in session && session.publicFetch) || globalThis.fetch)(input, {
            ...init,
            credentials: "omit",
          });
        };
    return { comments: new CellCommentStore(container, transport), local };
  }, [session, container]);
  if (!store || !session) return null;
  return (
    <CellComments
      key={container + session.webId}
      store={store.comments}
      engine={engine}
      webId={session.webId}
      local={store.local}
      onLoadingChange={onLoadingChange}
    />
  );
}

export function CellComments({
  store,
  engine,
  webId,
  local,
  onLoadingChange,
}: {
  store: CellCommentStore;
  engine: SheetEngine | null;
  webId: string;
  local: boolean;
  onLoadingChange?: ((loading: boolean) => void) | undefined;
}) {
  const [threads, setThreads] = useState<CellThread[]>([]);
  const [permissions, setPermissions] = useState<CommentPermissions>({
    append: false,
    write: false,
  });
  const [selection, setSelection] = useState<CellAnchor>();
  const [open, setOpen] = useState(false);
  const [composer, setComposer] = useState<{
    kind: "add" | "reply" | "edit";
    anchor?: CellAnchor;
    draft?: DraftAnchor | undefined;
    entry?: CellComment;
  }>();
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each identity change starts a new asynchronous lifetime
  const lifetime = useMemo(
    () => ({ active: false, locked: false, revision: 0 }),
    [store, webId, local, engine],
  );
  const currentLifetime = useRef(lifetime);
  currentLifetime.current = lifetime;
  const isCurrent = () => lifetime.active && currentLifetime.current === lifetime;
  const [, redraw] = useState(0);
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const refresh = async () => {
    const revision = ++lifetime.revision;
    setLoaded(false);
    engine?.setCommentsLoading?.(true);
    onLoadingChange?.(true);
    try {
      const [rows, access] = await Promise.all([store.list(), store.permissions()]);
      if (isCurrent() && revision === lifetime.revision) {
        engine?.registerCommentAnchors?.(
          Object.fromEntries(rows.map(({ root }) => [root.url, root.anchor as CellAnchor])),
        );
        setThreads(rows);
        setPermissions(local ? access : { append: false, write: false });
        setLoaded(true);
        setError(undefined);
      }
    } catch (cause) {
      if (isCurrent() && revision === lifetime.revision)
        setError(cause instanceof Error ? cause.message : "Couldn't load comments.");
    } finally {
      if (isCurrent() && revision === lifetime.revision) {
        engine?.setCommentsLoading?.(false);
        onLoadingChange?.(false);
      }
    }
  };
  // Store identity fences account/navigation changes; controls refresh on demand too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh belongs to this store's lifetime
  useEffect(() => {
    lifetime.active = true;
    setThreads([]);
    setComposer(undefined);
    setText("");
    setError(undefined);
    setSent(false);
    setBusy(false);
    setPermissions({ append: false, write: false });
    const load = () => {
      void refresh();
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      lifetime.active = false;
      window.removeEventListener("focus", load);
    };
  }, [lifetime]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: event handlers belong to this engine/store lifetime
  useEffect(() => {
    setSelection(engine?.selectedCell?.());
    const unselect = engine?.onSelection?.(setSelection);
    const unchange = engine?.onChange(() => redraw((value) => value + 1));
    return () => {
      unselect?.();
      unchange?.();
    };
  }, [engine, lifetime]);
  useEffect(() => () => composer?.draft?.dispose(), [composer]);
  useEffect(() => {
    if (composer) input.current?.focus();
  }, [composer]);
  const loadReason = !loaded ? "Refresh comments before making changes." : undefined;
  const reason = !navigator.onLine
    ? "Reconnect to comment."
    : (loadReason ??
      (!permissions.append ? "You need Append access to the comments container." : undefined));
  const start = (kind: "add" | "reply" | "edit", entry?: CellComment) => {
    if (lifetime.locked || !loaded) return;
    if (
      (kind === "edit"
        ? !navigator.onLine || !local || !entry?.writable || entry.creator !== webId
        : reason) ||
      (kind === "add" && !selection)
    )
      return;
    setOpen(true);
    setSent(false);
    setText(kind === "edit" ? (entry as CellComment).text : "");
    setComposer({
      kind,
      ...(entry ? { entry } : {}),
      ...(selection
        ? {
            anchor: { ...selection },
            ...(kind === "add" ? { draft: engine?.trackCommentDraft?.(selection) } : {}),
          }
        : {}),
    });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: update shortcut as selection/permission changes
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        start("add");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selection, reason]);
  const run = async (work?: () => Promise<unknown>, markSent = false) => {
    if (lifetime.locked) return;
    lifetime.locked = true;
    setBusy(true);
    try {
      if (work) {
        await work();
        if (!isCurrent()) return;
        setComposer(undefined);
        setText("");
        setSent(markSent);
      }
      setError(undefined);
      await refresh();
    } catch (cause) {
      if (isCurrent())
        setError(cause instanceof Error ? cause.message : "Couldn't save this comment.");
    } finally {
      lifetime.locked = false;
      if (isCurrent()) setBusy(false);
    }
  };
  const snapshot = engine?.snapshot() ?? {};
  const anchoredThreads = threads.map(({ root, replies }) => ({
    root: { ...root, anchor: currentCommentAnchor(snapshot, root.url, root.anchor as CellAnchor) },
    replies,
  }));
  const count = anchoredThreads.filter(
    ({ root }) => root.anchor.sheetId === selection?.sheetId,
  ).length;
  const sheets = snapshot.sheets as Record<string, { name: string }> | undefined;
  const composerAnchor = composer?.draft?.current() ?? composer?.anchor;
  const draftDeleted =
    composer?.kind === "add" &&
    (composerAnchor?.deleted || !sheets?.[composerAnchor?.sheetId as string]);
  const composerReason =
    loadReason ??
    (composer?.kind === "edit"
      ? !navigator.onLine
        ? "Reconnect to comment."
        : undefined
      : reason);
  return (
    <>
      <div className="sht-comment-tools" role="toolbar" aria-label="Cell comments">
        <CommentHint
          reason={
            reason ??
            (!selection ? "Select a cell first." : "Comment on the selected cell (Ctrl+Alt+M)")
          }
        >
          <Button
            variant="ghost"
            disabled={busy || !!reason || !selection}
            onClick={() => start("add")}
          >
            Comment
          </Button>
        </CommentHint>
        <Button ref={toggle} variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          Comments ({count} on this sheet)
        </Button>
      </div>
      {open && (
        <section className="sht-comments" aria-label="Comments">
          <div className="sht-comment-tools">
            <h2>Comments</h2>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                if (!busy) setComposer(undefined);
                toggle.current?.focus();
              }}
            >
              Close comments
            </Button>
          </div>
          <Button variant="ghost" disabled={busy} onClick={() => void run()}>
            {error && !loaded ? "Retry" : "Refresh comments"}
          </Button>
          {sent && <p role="status">Comment sent.</p>}
          {error && <p role="alert">{error}</p>}
          <ul aria-label="Comment threads">
            {anchoredThreads.map(({ root, replies }) => {
              const anchor = root.anchor as CellAnchor;
              const deleted = anchor.deleted || !sheets?.[anchor.sheetId];
              const active =
                !deleted &&
                anchor.sheetId === selection?.sheetId &&
                anchor.cell === selection?.cell;
              const entry = (comment: CellComment) => (
                <div key={comment.url} className="sht-comment-body">
                  <span>{comment.creator}</span>
                  <time dateTime={comment.created}>
                    {new Date(comment.created).toLocaleString()}
                  </time>
                  <p>{comment.text}</p>
                  {local && comment.creator === webId && comment.writable && (
                    <div className="sht-comment-tools">
                      <Button
                        variant="ghost"
                        disabled={busy || !loaded}
                        onClick={() => start("edit", comment)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy || !loaded}
                        onClick={() => void run(() => store.delete(comment, webId))}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              );
              return (
                <li
                  key={root.url}
                  className={active ? "sht-comment-active" : undefined}
                  aria-current={active ? "location" : undefined}
                >
                  <Button
                    variant="ghost"
                    disabled={deleted}
                    onClick={() => engine?.selectCell?.(anchor)}
                  >
                    {sheets?.[anchor.sheetId]?.name ?? anchor.sheetId}!{anchor.cell}
                  </Button>
                  {deleted && <p>Cell deleted</p>}
                  {root.resolved && <p>Resolved</p>}
                  {entry(root)}
                  <ul aria-label={`Replies to ${anchor.cell}`}>
                    {replies.map((reply) => (
                      <li key={reply.url}>{entry(reply)}</li>
                    ))}
                  </ul>
                  <div className="sht-comment-tools">
                    <CommentHint reason={reason ?? "Reply to this thread."}>
                      <Button
                        variant="ghost"
                        disabled={busy || !!reason}
                        title={reason}
                        onClick={() => start("reply", root)}
                      >
                        Reply
                      </Button>
                    </CommentHint>
                    <Button
                      variant="ghost"
                      disabled={busy || !loaded || !local || !root.writable}
                      title={
                        !local || !root.writable
                          ? "You need Write access to resolve comments."
                          : undefined
                      }
                      onClick={() => void run(() => store.resolve(root, !root.resolved))}
                    >
                      {root.resolved ? "Reopen" : "Resolve"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {threads.length === 0 && <p>No comments yet</p>}
          {composer && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (composerReason || !text.trim() || busy || draftDeleted) return;
                void run(
                  async () =>
                    composer.kind === "add"
                      ? await (async () => {
                          const created = await store.create(
                            text,
                            webId,
                            (composer.draft?.current() ?? composer.anchor) as CellAnchor,
                          );
                          if (isCurrent()) {
                            if (composer.draft) composer.draft.commit(created.url);
                            else
                              engine?.registerCommentAnchors?.({
                                [created.url]: composer.anchor as CellAnchor,
                              });
                          }
                        })()
                      : composer.kind === "reply"
                        ? store.reply(composer.entry as CellComment, text, webId)
                        : store.edit(composer.entry as CellComment, text, webId),
                  composer.kind !== "edit",
                );
              }}
            >
              <label>
                {composer.kind === "add"
                  ? `Comment on ${composerAnchor?.cell}`
                  : composer.kind === "reply"
                    ? "Reply text"
                    : "Edit comment"}
                <textarea
                  ref={input}
                  disabled={busy}
                  value={text}
                  maxLength={MAX_COMMENT_LENGTH}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              {draftDeleted && <p role="alert">Cell deleted</p>}
              <Button
                type="submit"
                disabled={busy || !!composerReason || !text.trim() || !!draftDeleted}
                title={composerReason}
              >
                Send
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setComposer(undefined);
                  toggle.current?.focus();
                }}
              >
                Cancel
              </Button>
            </form>
          )}
        </section>
      )}
    </>
  );
}
