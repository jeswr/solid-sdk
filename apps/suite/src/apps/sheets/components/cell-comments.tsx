// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@jeswr/suite-ui";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { usePodSessionState } from "@/lib/session/pod-session";
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
}: {
  container: string;
  engine: SheetEngine | null;
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
    />
  );
}

export function CellComments({
  store,
  engine,
  webId,
  local,
}: {
  store: CellCommentStore;
  engine: SheetEngine | null;
  webId: string;
  local: boolean;
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
    entry?: CellComment;
  }>();
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const live = useRef(false);
  const currentStore = useRef(store);
  currentStore.current = store;
  const isCurrent = () => live.current && currentStore.current === store;
  const lock = useRef(false);
  const queue = useRef(Promise.resolve());
  const input = useRef<HTMLTextAreaElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const refresh = async () => {
    const [rows, access] = await Promise.all([store.list(), store.permissions()]);
    if (isCurrent()) {
      setThreads(rows);
      setPermissions(local ? access : { append: false, write: false });
    }
  };
  // Store identity fences account/navigation changes; controls refresh on demand too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh belongs to this store's lifetime
  useEffect(() => {
    live.current = true;
    const load = () => {
      void refresh().catch((cause: Error) => {
        if (isCurrent()) setError(cause.message);
      });
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      live.current = false;
      window.removeEventListener("focus", load);
    };
  }, [store, local]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: event handlers belong to this engine/store lifetime
  useEffect(() => {
    setSelection(engine?.selectedCell?.());
    const unselect = engine?.onSelection?.(setSelection);
    const unstructure = engine?.onStructure?.((edit) => {
      queue.current = queue.current
        .then(async () => {
          await store.shift(edit);
          await refresh();
        })
        .catch((cause: Error) => {
          if (isCurrent())
            setError(
              `Couldn't move comment anchors: ${cause.message}. Reload comments before continuing.`,
            );
        });
    });
    return () => {
      unselect?.();
      unstructure?.();
    };
  }, [engine, store]);
  useEffect(() => {
    if (composer) input.current?.focus();
  }, [composer]);
  const reason = !navigator.onLine
    ? "Reconnect to comment."
    : !permissions.append
      ? "You need Append access to the comments container."
      : undefined;
  const start = (kind: "add" | "reply" | "edit", entry?: CellComment) => {
    if (reason || (kind === "add" && !selection)) return;
    setOpen(true);
    setText(kind === "edit" ? (entry as CellComment).text : "");
    setComposer({
      kind,
      ...(entry ? { entry } : {}),
      ...(selection ? { anchor: { ...selection } } : {}),
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
  const run = async (work: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await queue.current;
      await work();
      await refresh();
      if (isCurrent()) {
        setComposer(undefined);
        setText("");
        setError(undefined);
      }
    } catch (cause) {
      if (isCurrent())
        setError(cause instanceof Error ? cause.message : "Couldn't save this comment.");
    } finally {
      lock.current = false;
      if (isCurrent()) setBusy(false);
    }
  };
  const count = threads.filter(({ root }) => root.anchor?.sheetId === selection?.sheetId).length;
  const sheets = engine?.snapshot().sheets as Record<string, { name: string }> | undefined;
  return (
    <>
      <div className="sht-comment-tools" role="toolbar" aria-label="Cell comments">
        <CommentHint
          reason={
            reason ??
            (!selection ? "Select a cell first." : "Comment on the selected cell (Ctrl+Alt+M)")
          }
        >
          <Button variant="ghost" disabled={!!reason || !selection} onClick={() => start("add")}>
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
                setComposer(undefined);
                toggle.current?.focus();
              }}
            >
              Close comments
            </Button>
          </div>
          <Button variant="ghost" disabled={busy} onClick={() => void run(refresh)}>
            Refresh comments
          </Button>
          {error && <p role="alert">{error}</p>}
          <ul aria-label="Comment threads">
            {threads.map(({ root, replies }) => {
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
                  {comment.creator === webId && (
                    <div className="sht-comment-tools">
                      <Button
                        variant="ghost"
                        disabled={busy || !permissions.write}
                        title={
                          !permissions.write ? "You need Write access to edit comments." : undefined
                        }
                        onClick={() => start("edit", comment)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy || !permissions.write}
                        title={
                          !permissions.write
                            ? "You need Write access to delete comments."
                            : undefined
                        }
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
                      disabled={busy || !permissions.write}
                      title={
                        !permissions.write
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
                if (reason || !text.trim() || busy) return;
                void run(() =>
                  composer.kind === "add"
                    ? store.create(text, webId, composer.anchor as CellAnchor)
                    : composer.kind === "reply"
                      ? store.reply(composer.entry as CellComment, text, webId)
                      : store.edit(composer.entry as CellComment, text, webId),
                );
              }}
            >
              <label>
                {composer.kind === "add"
                  ? `Comment on ${composer.anchor?.cell}`
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
              <Button type="submit" disabled={busy || !!reason || !text.trim()} title={reason}>
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
