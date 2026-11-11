// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Textarea, toast } from "@jeswr/suite-ui";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { plainTextLinks } from "@/lib/plain-text-links";
import { ModifiedTime } from "../../../docs/components/modified-time";
import type { TaskComment, TaskCommentThread } from "../../lib/model/comments";
import { classifyError } from "../../lib/model/errors";
import type { StoredProject, StoredTask } from "../../lib/model/store";
import { memberName } from "../../lib/views/member-name";
import { useTasks } from "../../state/tasks-context";
import "./comments.css";

function CommentForm({
  label,
  initial = "",
  submit,
  cancel,
}: {
  label: string;
  initial?: string;
  submit: (text: string) => Promise<boolean>;
  cancel?: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    if (cancel) input.current?.focus();
  }, [cancel]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || !text.trim()) return;
    pending.current = true;
    setBusy(true);
    try {
      if (await submit(text)) {
        setText("");
        if (cancel) cancel();
        else requestAnimationFrame(() => input.current?.focus());
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <form
      data-tsk-comment-form=""
      className="tsk-detail-stack"
      onSubmit={(event) => void save(event)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) {
            if (cancel) cancel();
            else {
              setText("");
              input.current?.blur();
            }
          }
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
    >
      <label htmlFor={id}>{label}</label>
      <Textarea
        id={id}
        ref={input}
        rows={3}
        value={text}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="tsk-detail-inline">
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {label === "Edit comment" ? "Save" : label === "Reply" ? "Reply" : "Comment"}
        </Button>
        {cancel && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
export function TaskComments({ stored, project }: { stored: StoredTask; project: StoredProject }) {
  const tasks = useTasks();
  const [store] = useState(() => tasks.cache.store.comments(project, stored));
  const id = useId();
  const [threads, setThreads] = useState<TaskCommentThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [writable, setWritable] = useState<boolean>();
  const [editing, setEditing] = useState<TaskComment>();
  const [replying, setReplying] = useState<TaskComment>();
  const origin = useRef<HTMLButtonElement | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  const live = useRef(true);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [rows, access] = await Promise.all([store.list(), store.canWrite()]);
      if (live.current && request === generation.current) {
        setThreads(rows);
        setWritable(access);
        setError(undefined);
      }
    } catch (cause) {
      if (live.current && request === generation.current)
        setError(cause instanceof Error ? cause.message : "Couldn't load comments");
    } finally {
      if (live.current && request === generation.current) setLoading(false);
    }
  }, [store]);
  useEffect(() => {
    live.current = true;
    void refresh();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      live.current = false;
      ++generation.current;
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  const act = async (operation: () => Promise<unknown>) => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    try {
      await operation();
      if (live.current) await refresh();
      return true;
    } catch (cause) {
      const message =
        classifyError(cause) === "forbidden" || classifyError(cause) === "reauth"
          ? "You don't have permission to do that"
          : classifyError(cause) === "conflict"
            ? "This comment changed; try again."
            : cause instanceof Error
              ? cause.message
              : "Couldn't save your comment";
      if (live.current) {
        await refresh();
        setError(message);
        toast.error(message);
      }
      return false;
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const cancel = useCallback(() => {
    setEditing(undefined);
    setReplying(undefined);
    requestAnimationFrame(() => origin.current?.focus());
  }, []);
  const visibleThreads = threads
    .map(({ root, replies }) => ({ root, replies: replies.filter((reply) => !reply.deleted) }))
    .filter(({ root, replies }) => !root.deleted || replies.length > 0);
  const conflict = error === "This comment changed; try again.";
  const message = (comment: TaskComment) => (
    <div key={comment.url} className="tsk-comment-message">
      <header>
        <span title={comment.creator}>
          {comment.creator === tasks.webId ? "You" : memberName(comment.creator)}
        </span>
        <ModifiedTime value={comment.created} />
      </header>
      {writable !== false && editing?.url === comment.url ? (
        <CommentForm
          label="Edit comment"
          initial={editing.text}
          submit={(text) => act(() => store.edit(editing, text))}
          cancel={cancel}
        />
      ) : (
        <p>{plainTextLinks(comment.text)}</p>
      )}
      {writable !== false && comment.creator === tasks.webId && !comment.deleted && (
        <div className="tsk-detail-inline">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || editing !== undefined}
            onClick={(event) => {
              origin.current = event.currentTarget;
              setReplying(undefined);
              setEditing(comment);
            }}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(() => store.delete(comment)).then((saved) => {
                if (saved) document.getElementById(`${id}-heading`)?.focus();
              })
            }
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  );
  return (
    <section className="tsk-comments" aria-labelledby={`${id}-heading`} aria-busy={busy || loading}>
      <h3 id={`${id}-heading`} tabIndex={-1}>
        Comments
      </h3>
      {loading && <p role="status">Loading comments…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              if (conflict) cancel();
              setLoading(true);
              void refresh();
            }}
          >
            {conflict ? "Reload" : "Retry"}
          </Button>
        </div>
      )}
      {!loading && !error && visibleThreads.length === 0 && <p>No comments yet</p>}
      <ol>
        {visibleThreads.map(({ root, replies }) => (
          <li key={root.url}>
            {message(root)}
            <ol>
              {replies.map((reply) => (
                <li key={reply.url}>{message(reply)}</li>
              ))}
            </ol>
            {writable !== false && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={(event) => {
                  origin.current = event.currentTarget;
                  setEditing(undefined);
                  setReplying(root);
                }}
              >
                Reply
              </Button>
            )}
            {writable !== false && replying?.url === root.url && (
              <CommentForm
                label="Reply"
                submit={(text) => act(() => store.reply(root, text))}
                cancel={cancel}
              />
            )}
          </li>
        ))}
      </ol>
      {!loading && writable !== false && (
        <CommentForm label="Comment" submit={(text) => act(() => store.create(text))} />
      )}
    </section>
  );
}
