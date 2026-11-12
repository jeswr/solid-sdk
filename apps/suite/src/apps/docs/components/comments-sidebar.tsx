// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button } from "@jeswr/suite-ui";
import { Check, MessageSquare, MoreVertical, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import type { CommentAnchor, CommentThread, DocumentComment } from "../lib/model/comments";
import { ModifiedTime } from "./modified-time";
import { VersionAction } from "./version-history";

export function CommentComposer({
  label,
  initial = "",
  quote,
  reason,
  submit,
  cancel,
}: {
  label: string;
  initial?: string;
  quote?: string | undefined;
  reason: string | undefined;
  submit: (text: string) => Promise<boolean>;
  cancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => {
    input.current?.focus();
  }, []);
  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!text.trim() || reason || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (await submit(text.trim())) cancel();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(event) => void save(event)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) cancel();
        }
      }}
    >
      {quote && <blockquote>{quote}</blockquote>}
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        ref={input}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
      />
      <div className="docs-comment-actions">
        <VersionAction reason={reason} busy={busy || !text.trim()} run={() => void save()}>
          {label === "Edit comment" ? "Save" : label === "Reply" ? "Reply" : "Comment"}
        </VersionAction>
        <Button type="button" variant="ghost" disabled={busy} onClick={cancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
export interface CommentActions {
  reply: (root: DocumentComment, text: string) => Promise<boolean>;
  edit: (comment: DocumentComment, text: string) => Promise<boolean>;
  delete: (comment: DocumentComment) => Promise<boolean>;
  resolve: (root: DocumentComment, resolved: boolean) => Promise<boolean>;
}
function CommentMessage({
  comment,
  authorName,
  root,
  own,
  reason,
  actions,
}: {
  comment: DocumentComment;
  authorName: string;
  root: boolean;
  own: boolean;
  reason: string | undefined;
  actions: CommentActions;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeEdit = () => {
    setEditing(false);
    trigger.current?.focus();
  };
  return (
    <div className="docs-comment-message">
      <header>
        <span title={comment.creator} aria-description={comment.creator}>
          {authorName}
        </span>
        <ModifiedTime value={comment.created} />
        {(own || (root && comment.resolved)) && (
          <div
            className="docs-comment-menu"
            role="toolbar"
            aria-label="Comment menu"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setMenu(false);
                trigger.current?.focus();
              }
            }}
          >
            <Button
              ref={trigger}
              variant="ghost"
              aria-label="Comment options"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <MoreVertical aria-hidden="true" size={16} />
            </Button>
            {menu && (
              <div className="docs-comment-menu-items">
                {own && (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setMenu(false);
                        setEditing(true);
                      }}
                    >
                      Edit
                    </Button>
                    <VersionAction
                      reason={reason}
                      run={() => {
                        setMenu(false);
                        void actions.delete(comment);
                      }}
                    >
                      Delete
                    </VersionAction>
                  </>
                )}
                {root && comment.resolved && (
                  <VersionAction
                    reason={reason}
                    run={() => {
                      setMenu(false);
                      void actions.resolve(comment, false);
                    }}
                  >
                    Reopen
                  </VersionAction>
                )}
              </div>
            )}
          </div>
        )}
      </header>
      {editing ? (
        <CommentComposer
          label="Edit comment"
          initial={comment.text}
          reason={reason}
          submit={(text) => actions.edit(comment, text)}
          cancel={closeEdit}
        />
      ) : (
        <p>{comment.text}</p>
      )}
    </div>
  );
}
export function CommentsSidebar({
  threads,
  authorName,
  active,
  focusRequest,
  composer,
  reason,
  error,
  webId,
  showResolved,
  setShowResolved,
  select,
  close,
  cancel,
  create,
  actions,
  orphan,
}: {
  threads: CommentThread[];
  authorName: (webId: string) => string;
  active: string | undefined;
  focusRequest?: { url: string } | undefined;
  composer: CommentAnchor | undefined;
  reason: string | undefined;
  error: string | undefined;
  webId: string;
  showResolved: boolean;
  setShowResolved: (value: boolean) => void;
  select: (comment: DocumentComment) => void;
  close: () => void;
  cancel: () => void;
  create: (text: string) => Promise<boolean>;
  actions: CommentActions;
  orphan: (comment: DocumentComment) => boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [replying, setReplying] = useState<string>();
  useEffect(() => {
    if (!panel.current?.querySelector("textarea")) heading.current?.focus();
  }, []);
  useEffect(() => {
    const thread = [
      ...(panel.current as HTMLElement).querySelectorAll<HTMLElement>("article"),
    ].find((item) => item.dataset.thread === focusRequest?.url);
    thread?.scrollIntoView({ block: "nearest" });
    thread?.focus({ preventScroll: true });
  }, [focusRequest]);
  return (
    <aside
      ref={panel}
      className="docs-comments-sidebar"
      aria-label="Comments"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          if (composer) cancel();
          else close();
        }
      }}
    >
      <header>
        <h2 ref={heading} tabIndex={-1}>
          Comments
        </h2>
        <Button variant="ghost" aria-label="Close comments" onClick={close}>
          <X aria-hidden="true" />
        </Button>
      </header>
      <label className="docs-comment-resolved">
        <input
          type="checkbox"
          checked={showResolved}
          onChange={(event) => setShowResolved(event.target.checked)}
        />{" "}
        Show resolved
      </label>
      {error && <p role="alert">{error}</p>}
      {composer && (
        <CommentComposer
          label="Add comment"
          quote={composer.exact}
          reason={reason}
          submit={create}
          cancel={cancel}
        />
      )}
      {threads.length === 0 && <p>No comments yet</p>}
      {threads.map(({ root, replies }) => (
        <article
          key={root.url}
          data-thread={root.url}
          onClickCapture={(event) => {
            // The quote button provides the keyboard action; clicking a message
            // also selects its text without intercepting the thread's controls.
            if (!(event.target as HTMLElement).closest("button,input,textarea,label,form"))
              select(root);
          }}
          tabIndex={-1}
          className={
            active === root.url
              ? "docs-comment-thread docs-comment-thread-active"
              : "docs-comment-thread"
          }
          aria-label={`${authorName(root.creator)}: ${root.anchor?.exact}`}
        >
          <Button variant="ghost" className="docs-comment-quote" onClick={() => select(root)}>
            {root.anchor?.exact}
          </Button>
          {orphan(root) && <p className="docs-comment-orphan">Original text was deleted</p>}
          {root.resolved && <p>Resolved</p>}
          <CommentMessage
            comment={root}
            authorName={authorName(root.creator)}
            root
            own={root.creator === webId}
            reason={reason}
            actions={actions}
          />
          {replies.map((reply) => (
            <CommentMessage
              key={reply.url}
              comment={reply}
              authorName={authorName(reply.creator)}
              root={false}
              own={reply.creator === webId}
              reason={reason}
              actions={actions}
            />
          ))}
          {!root.resolved && (
            <div className="docs-comment-actions">
              <VersionAction reason={reason} run={() => void actions.resolve(root, true)}>
                <Check aria-hidden="true" size={16} /> Resolve
              </VersionAction>
              <VersionAction reason={reason} run={() => setReplying(root.url)}>
                Reply to thread
              </VersionAction>
            </div>
          )}
          {replying === root.url && (
            <CommentComposer
              label="Reply"
              reason={reason}
              submit={(text) => actions.reply(root, text)}
              cancel={() => {
                setReplying(undefined);
                panel.current?.querySelector<HTMLElement>("h2")?.focus();
              }}
            />
          )}
        </article>
      ))}
    </aside>
  );
}
export function CommentsControls({
  count,
  open,
  toggle,
  add,
  reason,
}: {
  count: number;
  open: boolean;
  toggle: () => void;
  add: () => void;
  reason: string | undefined;
}) {
  return (
    <div role="toolbar" aria-label="Comments controls" className="docs-comments-controls">
      <VersionAction reason={reason} run={add}>
        <MessageSquare aria-hidden="true" size={16} />
        Add comment
      </VersionAction>
      <Button
        variant="ghost"
        // A comma, not parentheses, so the name still contains the visible count (WCAG 2.5.3).
        aria-label={`Comments, ${count} open`}
        aria-expanded={open}
        onClick={toggle}
      >
        <MessageSquare aria-hidden="true" size={16} />
        {count}
      </Button>
    </div>
  );
}
